export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startOpenCreditMaterializationWorkerFromRuntime } =
    await import("./lib/opencredit-materialization-worker");
  await startOpenCreditMaterializationWorkerFromRuntime();
}
