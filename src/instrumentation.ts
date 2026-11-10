export async function register() {
  const runtime = process.env.NEXT_RUNTIME;
  const edge = runtime === "edge";
  const event = {
    event: "opencredit_instrumentation_bootstrap",
    runtime: edge ? "edge" : runtime === "nodejs" || runtime === "node" ? "nodejs" : "unknown",
    attempted: !edge,
    skippedReason: edge ? "edge_runtime" : null,
  };
  // Diagnostic failures must not prevent the server bootstrap or leak exceptions.
  try { void Promise.resolve(console.info(JSON.stringify(event))).catch(() => {}); } catch {}
  // Keep the explicit runtime guard here, before importing any Node/Prisma dependencies.
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { startOpenCreditMaterializationWorkerFromRuntime } =
    await import("./lib/opencredit-materialization-worker");
  await startOpenCreditMaterializationWorkerFromRuntime();
}
