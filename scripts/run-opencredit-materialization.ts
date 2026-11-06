// Explicit standalone entry point. This version has no registered materializer.
const enabled = process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED === "true";
process.stdout.write(enabled ? "OPENCREDIT_NO_MATERIALIZER\n" : "OPENCREDIT_WORKER_DISABLED\n");
