type MaterializationLease = { id: string; leaseToken: string };

type Queue = {
  recover(limit?: number): Promise<unknown[]>;
  expire(limit?: number): Promise<unknown[]>;
  claim(limit?: number): Promise<MaterializationLease[]>;
};

type Materializer = {
  process(lease: MaterializationLease): Promise<unknown>;
};

type WorkerLogEvent =
  | { event: "opencredit_materialization_worker_cycle"; skipped: false; recovered: number; expired: number; claimed: number; processed: number; failed: number }
  | { event: "opencredit_materialization_worker_cycle_failed" };

type WorkerDependencies = {
  queue: Queue;
  materializer: Materializer;
  log?: (event: WorkerLogEvent) => void;
};

type WorkerOptions = {
  intervalMs?: number;
  batchSize?: number;
};

type WorkerEnvironment = {
  OPENCREDIT_MATERIALIZATION_WORKER_ENABLED?: string;
};

const defaultIntervalMs = 1_000;
const defaultBatchSize = 10;

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`INVALID_${name}`);
  return value;
}

export function isOpenCreditMaterializationWorkerEnabled(
  env: WorkerEnvironment = process.env as WorkerEnvironment
) {
  return env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED === "true";
}

export function createOpenCreditMaterializationWorker(
  deps: WorkerDependencies,
  options: WorkerOptions = {}
) {
  const intervalMs = positiveInteger(options.intervalMs ?? defaultIntervalMs, "MATERIALIZATION_WORKER_INTERVAL");
  const batchSize = positiveInteger(options.batchSize ?? defaultBatchSize, "MATERIALIZATION_WORKER_BATCH_SIZE");
  let running = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function runOnce() {
    if (inFlight) return { skipped: true as const };
    inFlight = true;
    try {
      const recovered = await deps.queue.recover(batchSize);
      const expired = await deps.queue.expire(batchSize);
      const leases = await deps.queue.claim(batchSize);
      let processed = 0;
      let failed = 0;
      for (const lease of leases) {
        try {
          await deps.materializer.process(lease);
          processed++;
        } catch {
          // A failed lease remains protected by its queue lease. A later cycle
          // recovers it after lease expiry; do not fan out failures or leak IDs.
          failed++;
        }
      }
      const outcome = {
        skipped: false as const,
        recovered: recovered.length,
        expired: expired.length,
        claimed: leases.length,
        processed,
        failed,
      };
      deps.log?.({ event: "opencredit_materialization_worker_cycle", ...outcome });
      return outcome;
    } finally {
      inFlight = false;
    }
  }

  function schedule(delayMs: number) {
    if (!running) return;
    timer = setTimeout(async () => {
      try {
        await runOnce();
      } catch {
        deps.log?.({ event: "opencredit_materialization_worker_cycle_failed" });
      } finally {
        schedule(intervalMs);
      }
    }, delayMs);
    timer.unref?.();
  }

  return {
    runOnce,
    start() {
      if (running) return false;
      running = true;
      schedule(0);
      return true;
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    isRunning() {
      return running;
    },
  };
}

type RuntimeWorker = ReturnType<typeof createOpenCreditMaterializationWorker>;
type WorkerRuntimeGlobal = typeof globalThis & {
  __openCreditMaterializationWorkerV1?: RuntimeWorker;
};

export async function startOpenCreditMaterializationWorkerFromRuntime(
  env: WorkerEnvironment = process.env as WorkerEnvironment
) {
  if (!isOpenCreditMaterializationWorkerEnabled(env)) {
    return { started: false as const, reason: "disabled" as const };
  }

  const runtime = globalThis as WorkerRuntimeGlobal;
  if (runtime.__openCreditMaterializationWorkerV1?.isRunning()) {
    return { started: false as const, reason: "already_running" as const };
  }

  const [{ prisma }, { createOpenCreditMaterializationQueue }, { createOpenCreditDomainMaterializer }] =
    await Promise.all([
      import("./db"),
      import("./opencredit-materialization-queue.service"),
      import("./opencredit-domain-materializer"),
    ]);

  const worker = createOpenCreditMaterializationWorker({
    queue: createOpenCreditMaterializationQueue(prisma),
    materializer: createOpenCreditDomainMaterializer(prisma),
    log: event => console.info(JSON.stringify(event)),
  });
  runtime.__openCreditMaterializationWorkerV1 = worker;
  worker.start();
  return { started: true as const };
}
