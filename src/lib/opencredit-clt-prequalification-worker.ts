import "server-only";
import { createCltPrequalificationQueue, isCltPrequalificationEnabled } from "./opencredit-clt-prequalification-queue.service";
import { processCltPrequalification } from "./opencredit-clt-prequalification.service";

type RuntimeWorker = ReturnType<typeof createCltPrequalificationWorker>;
type RuntimeGlobal = typeof globalThis & { __openCreditCltPrequalificationWorkerV1?: RuntimeWorker };

export function createCltPrequalificationWorker(
  deps: {
    recover(limit?: number): Promise<unknown[]>;
    claim(limit?: number): Promise<Array<{ id: string; leaseToken: string; attempts: number }>>;
    process(lease: { id: string; leaseToken: string; attempts: number }): Promise<unknown>;
    log?(event: { event: "opencredit_clt_prequalification_worker"; phase: "started" | "completed" | "failed"; claimed: number; processed: number; result?: string }): unknown;
  },
  intervalMs = 2000
) {
  let running = false, inFlight = false, timer: ReturnType<typeof setTimeout> | null = null;
  const log = (event: Parameters<NonNullable<typeof deps.log>>[0]) => { try { void Promise.resolve(deps.log?.(event)).catch(() => {}); } catch {} };
  async function runOnce() {
    if (inFlight || !isCltPrequalificationEnabled()) return { skipped: true as const };
    inFlight = true;
    let claimed = 0, processed = 0;
    try {
      await deps.recover(5);
      const leases = await deps.claim(1);
      claimed = leases.length;
      for (const lease of leases) {
        if (!isCltPrequalificationEnabled()) break;
        const result = await deps.process(lease);
        processed++;
        log({ event: "opencredit_clt_prequalification_worker", phase: "completed", claimed, processed, result: typeof result === "string" ? result : "UNKNOWN" });
      }
      log({ event: "opencredit_clt_prequalification_worker", phase: "completed", claimed, processed });
      return { skipped: claimed === 0, claimed, processed };
    } catch {
      log({ event: "opencredit_clt_prequalification_worker", phase: "failed", claimed, processed });
      return { skipped: false, claimed, processed };
    } finally { inFlight = false; }
  }
  function schedule() {
    if (!running) return;
    timer = setTimeout(async () => { await runOnce(); schedule(); }, intervalMs);
    timer.unref?.();
  }
  return {
    runOnce,
    start() {
      if (running || !isCltPrequalificationEnabled()) return false;
      running = true;
      log({ event: "opencredit_clt_prequalification_worker", phase: "started", claimed: 0, processed: 0 });
      void runOnce().finally(schedule);
      return true;
    },
    stop() { running = false; if (timer) clearTimeout(timer); timer = null; },
    isRunning() { return running; },
  };
}

export async function startCltPrequalificationWorkerFromRuntime() {
  if (!isCltPrequalificationEnabled()) return { started: false, reason: "disabled" as const };
  const runtime = globalThis as RuntimeGlobal;
  if (runtime.__openCreditCltPrequalificationWorkerV1?.isRunning()) return { started: false, reason: "already_running" as const };
  try {
    const { prisma } = await import("./db");
    const queue = createCltPrequalificationQueue(prisma);
    const worker = createCltPrequalificationWorker({
      recover: queue.recover,
      claim: queue.claim,
      process: lease => processCltPrequalification(prisma, queue, lease),
      log: event => console.info(JSON.stringify(event)),
    });
    runtime.__openCreditCltPrequalificationWorkerV1 = worker;
    const started = worker.start();
    return { started, reason: started ? "started" as const : "disabled" as const };
  } catch {
    return { started: false, reason: "startup_error" as const };
  }
}
