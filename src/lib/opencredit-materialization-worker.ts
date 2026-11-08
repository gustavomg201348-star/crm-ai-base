type MaterializationLease = { id: string; leaseToken: string };
type MaterializationOutcome = { state: "COMPLETED" | "NEEDS_REVIEW" | "RETRY" | "EXPIRED" } | null;
type Queue = {
  recover(limit?: number): Promise<unknown[]>;
  expire(limit?: number): Promise<unknown[]>;
  claim(limit?: number): Promise<MaterializationLease[]>;
};
type Materializer = { process(lease: MaterializationLease): Promise<MaterializationOutcome> };
type CycleCounts = {
  recovered: number; expired: number; claimed: number; processed: number;
  completed: number; needsReview: number; retry: number; failed: number;
};
type WorkerLogEvent = CycleCounts & {
  event: "opencredit_materialization_worker_cycle";
  phase: "started" | "completed" | "failed";
  batchLimit: number; workerEnabled: boolean; skipped: boolean; durationMs: number;
};
type WorkerDependencies = {
  queue: Queue;
  materializer: Materializer;
  log?: (event: WorkerLogEvent) => void | Promise<void>;
};
type WorkerEnvironment = {
  OPENCREDIT_MATERIALIZATION_WORKER_ENABLED?: string;
  OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT?: string;
  OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS?: string;
  OPENCREDIT_MATERIALIZATION_WORKER_MODE?: string;
  OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID?: string;
};
export type MaterializationWorkerMode = { kind: "NORMAL" } | { kind: "ROLLOUT"; rolloutId: string } | { kind: "INVALID" };
export function materializationWorkerMode(env: WorkerEnvironment): MaterializationWorkerMode {
  const id = env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID;
  if (env.OPENCREDIT_MATERIALIZATION_WORKER_MODE === "NORMAL" && id === undefined) return { kind: "NORMAL" };
  if (env.OPENCREDIT_MATERIALIZATION_WORKER_MODE === "ROLLOUT" && typeof id === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(id)) return { kind: "ROLLOUT", rolloutId: id };
  return { kind: "INVALID" };
}
type WorkerOptions = { intervalMs?: number; batchSize?: number; env?: WorkerEnvironment };
const defaultIntervalMs = 1_000;
const maxBatchSize = 10;

function boundedInteger(value: string | number | undefined, minimum: number, maximum: number, fallback: number) {
  if (typeof value === "string" && !/^[1-9]\d*$/.test(value)) return fallback;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : fallback;
}

export function isOpenCreditMaterializationWorkerEnabled(env: WorkerEnvironment = process.env as WorkerEnvironment) {
  return env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED === "true";
}

export function openCreditMaterializationWorkerConfig(env: WorkerEnvironment = process.env as WorkerEnvironment) {
  return {
    batchLimit: boundedInteger(env.OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT, 1, maxBatchSize, 1),
    intervalMs: boundedInteger(env.OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS, defaultIntervalMs, 2_147_483_647, defaultIntervalMs),
  };
}

export function createOpenCreditMaterializationWorker(deps: WorkerDependencies, options: WorkerOptions = {}) {
  // Retain the environment reference: the enabled flag is never snapshotted at boot.
  const env = options.env ?? process.env as WorkerEnvironment;
  const intervalMs = boundedInteger(options.intervalMs ?? openCreditMaterializationWorkerConfig(env).intervalMs,
    defaultIntervalMs, 2_147_483_647, defaultIntervalMs);
  const mode = materializationWorkerMode(env);
  const enabled = () => isOpenCreditMaterializationWorkerEnabled(env) && mode.kind !== "INVALID"
    && JSON.stringify(materializationWorkerMode(env)) === JSON.stringify(mode);
  let running = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function log(event: WorkerLogEvent) {
    // Logging is best-effort; neither synchronous errors nor rejected promises escape.
    try { void Promise.resolve(deps.log?.(event)).catch(() => {}); } catch {}
  }

  async function runOnce() {
    if (inFlight) return { skipped: true as const };
    inFlight = true;
    const started = Date.now();
    const batchLimit = boundedInteger(options.batchSize ?? openCreditMaterializationWorkerConfig(env).batchLimit, 1, maxBatchSize, 1);
    const counts: CycleCounts = { recovered: 0, expired: 0, claimed: 0, processed: 0,
      completed: 0, needsReview: 0, retry: 0, failed: 0 };
    let failed = false;
    const outcome = () => ({ skipped: counts.claimed === 0, ...counts });
    const emit = (phase: WorkerLogEvent["phase"]) => log({
      event: "opencredit_materialization_worker_cycle", phase, batchLimit,
      workerEnabled: enabled(), ...outcome(), durationMs: Math.max(0, Date.now() - started),
    });
    emit("started");
    try {
      if (!enabled()) return outcome();
      if (mode.kind === "NORMAL") {
        counts.recovered = (await deps.queue.recover(batchLimit)).length;
        if (!enabled()) return outcome();
        counts.expired = (await deps.queue.expire(batchLimit)).length;
      }
      if (!enabled()) return outcome();
      const leases = await deps.queue.claim(batchLimit);
      counts.claimed = leases.length;
      if (leases.length > batchLimit) throw new Error("MATERIALIZATION_WORKER_BATCH_EXCEEDED");
      for (const lease of leases) {
        if (!enabled()) break;
        // The materializer owns typed retry/review transitions. Unexpected exceptions
        // escape runOnce after a sanitized failure event; never refill the batch.
        const result = await deps.materializer.process(lease);
        if (result === null) { counts.failed++; continue; } // Lost lease, no fallback.
        switch (result.state) {
          case "COMPLETED": counts.completed++; break;
          case "NEEDS_REVIEW": counts.needsReview++; break;
          case "RETRY": counts.retry++; break;
          case "EXPIRED": counts.expired++; break;
          default: throw new Error("MATERIALIZATION_WORKER_INVALID_OUTCOME");
        }
        counts.processed++;
      }
      return outcome();
    } catch (error) {
      failed = true;
      counts.failed++;
      emit("failed");
      throw error;
    } finally {
      // A failed cycle emits only its failure event, never a misleading success.
      if (!failed) emit("completed");
      inFlight = false;
    }
  }

  function schedule(delayMs: number) {
    if (!running) return;
    timer = setTimeout(async () => {
      try { await runOnce(); }
      catch {
        // Already logged as failure, with no free-form exception or success signal.
        // Remaining leases stay protected until normal recovery; wait a full interval.
      } finally { schedule(intervalMs); }
    }, delayMs);
    timer.unref?.();
  }

  return {
    runOnce,
    start() {
      if (running || !enabled()) return false;
      running = true;
      schedule(0);
      return true;
    },
    stop() { running = false; if (timer) clearTimeout(timer); timer = null; },
    isRunning() { return running; },
  };
}

type RuntimeWorker = ReturnType<typeof createOpenCreditMaterializationWorker>;
type WorkerRuntimeGlobal = typeof globalThis & { __openCreditMaterializationWorkerV1?: RuntimeWorker };

export async function startOpenCreditMaterializationWorkerFromRuntime(env: WorkerEnvironment = process.env as WorkerEnvironment) {
  const mode = materializationWorkerMode(env);
  if (!isOpenCreditMaterializationWorkerEnabled(env) || mode.kind === "INVALID") return { started: false as const, reason: "disabled" as const };
  const runtime = globalThis as WorkerRuntimeGlobal;
  if (runtime.__openCreditMaterializationWorkerV1?.isRunning()) return { started: false as const, reason: "already_running" as const };
  const [{ prisma }, { createOpenCreditMaterializationQueue }, { createOpenCreditDomainMaterializer }] = await Promise.all([
    import("./db"), import("./opencredit-materialization-queue.service"), import("./opencredit-domain-materializer"),
  ]);
  const worker = createOpenCreditMaterializationWorker({
    queue: createOpenCreditMaterializationQueue(prisma, Math.random, mode.kind === "ROLLOUT" ? mode.rolloutId : undefined),
    materializer: {
      async process(lease) {
        const result = await createOpenCreditDomainMaterializer(prisma).process(lease);
        if (result?.state === "COMPLETED") {
          try {
            const { bootstrapNewlyCompletedOpenCreditJob } = await import("./opencredit-whatsapp-runtime");
            const bootstrap = await bootstrapNewlyCompletedOpenCreditJob(lease.id);
            if (bootstrap) { try { console.info(JSON.stringify({ event: "opencredit_whatsapp_bootstrap", outcome: bootstrap.status })); } catch {} }
          } catch { try { console.warn(JSON.stringify({ event: "opencredit_whatsapp_bootstrap", outcome: "SEND_FAILED" })); } catch {} }
        }
        return result;
      },
    },
    log: event => console.info(JSON.stringify(event)),
  }, { env });
  runtime.__openCreditMaterializationWorkerV1 = worker;
  return { started: worker.start() };
}
