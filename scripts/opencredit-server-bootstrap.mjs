import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const reasons = new Set(["started", "disabled", "invalid_mode", "already_running", "configuration_changed"]);

export async function bootstrapOpenCreditServer({
  loadWorker = async () => require("../.next/opencredit-worker.cjs"),
  log = event => console.info(JSON.stringify(event)),
} = {}) {
  const emit = (phase, workerResultReason) => {
    try { void Promise.resolve(log({ event: "opencredit_server_bootstrap", phase, attempted: true, workerResultReason })).catch(() => {}); } catch {}
  };
  emit("worker_start", null);
  let reason = "startup_error";
  try {
    const { startOpenCreditMaterializationWorkerFromRuntime } = await loadWorker();
    const result = await startOpenCreditMaterializationWorkerFromRuntime();
    if (reasons.has(result?.reason)) reason = result.reason;
  } catch {
    // The auxiliary worker must not take down the CRM. Never log the exception.
  }
  emit("next_start", reason);
  return { workerResultReason: reason };
}
