import type { MaterializationLease, MaterializationPilotTarget } from "../src/lib/opencredit-materialization-queue.service";

const argumentNames = new Map<string, keyof MaterializationPilotTarget>([
  ["--job-id", "id"], ["--company-id", "companyId"],
  ["--integration-id", "integrationId"], ["--provider-scope", "providerScope"]
]);

function parseTarget(args: readonly string[]): MaterializationPilotTarget | null {
  if (args.length !== 9 || args[0] !== "--pilot") return null;
  const target: Partial<MaterializationPilotTarget> = {};
  for (let i = 1; i < args.length; i += 2) {
    const key = argumentNames.get(args[i]);
    const value = args[i + 1];
    if (!key || target[key] !== undefined || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}(?![\s\S])/.test(value)) return null;
    target[key] = value;
  }
  return target as MaterializationPilotTarget;
}

type PilotRuntime = {
  claimPilotJob(target: MaterializationPilotTarget): Promise<MaterializationLease | null>;
  process(lease: MaterializationLease): Promise<{ id: string; state: string } | null>;
  close(): Promise<void>;
};

export function createPilotExecutor(loadRuntime: () => Promise<PilotRuntime>) {
  let consumed = false;
  return async (args: readonly string[], workerFlag?: string) => {
    if (consumed) return "PILOT_ALREADY_USED";
    if (workerFlag === "true") return "PILOT_WORKER_ENABLED";
    const target = parseTarget(args);
    if (!target) return "PILOT_INVALID_ARGUMENTS";
    consumed = true;

    let runtime: PilotRuntime | undefined;
    let failure = "PILOT_RUNTIME_FAILED";
    try {
      runtime = await loadRuntime();
      failure = "PILOT_CLAIM_FAILED";
      const lease = await runtime.claimPilotJob(target);
      if (!lease) return "PILOT_NOT_CLAIMED";
      if (lease.id !== target.id || !lease.leaseToken) return "PILOT_INVALID_LEASE";
      failure = "PILOT_PROCESS_FAILED";
      const outcome = await runtime.process(lease);
      if (outcome?.id !== target.id) return "PILOT_OUTCOME_UNCONFIRMED";
      switch (outcome.state) {
        case "COMPLETED": return "PILOT_COMPLETED";
        case "RETRY": return "PILOT_RETRY";
        case "NEEDS_REVIEW": return "PILOT_NEEDS_REVIEW";
        case "EXPIRED": return "PILOT_EXPIRED";
        default: return "PILOT_OUTCOME_UNCONFIRMED";
      }
    } catch {
      return failure;
    } finally {
      if (runtime) {
        try { await runtime.close(); }
        catch { /* Closing the dedicated client cannot change the recorded job outcome. */ }
      }
    }
  };
}

const execute = createPilotExecutor(async () => {
  const [{ PrismaClient }, { createOpenCreditMaterializationQueue }, { createOpenCreditDomainMaterializer }] =
    await Promise.all([
      import("@prisma/client"),
      import("../src/lib/opencredit-materialization-queue.service"),
      import("../src/lib/opencredit-domain-materializer")
    ]);
  const db = new PrismaClient({ log: [] });
  const queue = createOpenCreditMaterializationQueue(db);
  const materializer = createOpenCreditDomainMaterializer(db);
  return { claimPilotJob: queue.claimPilotJob, process: materializer.process, close: () => db.$disconnect() };
});

if (require.main === module) {
  void execute(process.argv.slice(2), process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED).then(code => {
    process.stdout.write(code + "\n");
    process.exitCode = code === "PILOT_COMPLETED" ? 0 : 1;
  });
}
