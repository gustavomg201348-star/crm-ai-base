import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { MaterializationConfigurationError } from "./opencredit-materialization-configuration.service";
import { createOpenCreditMaterializationQueue, RolloutClaimDenied } from "./opencredit-materialization-queue.service";
import { availableRolloutBudget } from "./opencredit-materialization-rollout-budget.service";
import { createOpenCreditDomainMaterializer } from "./opencredit-domain-materializer";
import { isOpenCreditMaterializationWorkerEnabled, materializationWorkerMode } from "./opencredit-materialization-worker";

type Db = Pick<PrismaClient, "$queryRaw" | "$transaction">;
type Input = { actor: SessionUser; companyId: string; integrationId: string; providerScope: string };
type Dependencies = {
  bootstrap(jobId: string): Promise<{ status: string } | undefined>;
  env?: Parameters<typeof materializationWorkerMode>[0];
  queue?: typeof createOpenCreditMaterializationQueue;
  materializer?: typeof createOpenCreditDomainMaterializer;
};
const bootstrapStatuses = ["SENT", "ALREADY_STARTED", "CONFIGURATION_MISSING", "CHANNEL_INVALID",
  "TEMPLATE_UNAVAILABLE", "IDENTITY_UNAVAILABLE", "AUTOMATION_NOT_ALLOWED", "SEND_FAILED", "UNKNOWN", "RATE_LIMITED"] as const;
const materializationStatuses = ["COMPLETED", "RETRY", "NEEDS_REVIEW", "EXPIRED"] as const;
const fail = (code: ConstructorParameters<typeof MaterializationConfigurationError>[0]): never => {
  throw new MaterializationConfigurationError(code);
};


export async function finalizeOpenCreditSingleAdmission(db: Db, input: Input,
  env: Parameters<typeof materializationWorkerMode>[0] = {
    OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED,
    OPENCREDIT_MATERIALIZATION_WORKER_MODE: process.env.OPENCREDIT_MATERIALIZATION_WORKER_MODE,
    OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: process.env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID,
  }) {
  const { actor, companyId, integrationId, providerScope } = input;
  if (!isPlatformAdmin(actor)) return fail("NOT_AUTHORIZED");
  if (isOpenCreditMaterializationWorkerEnabled(env)) return fail("GATES_INVALID");
  return db.$transaction(async tx => {
    const [currentActor] = await tx.$queryRaw<Array<SessionUser>>`
      SELECT "id","companyId","name","email","role" FROM "User" WHERE "id"=${actor.id} FOR SHARE`;
    if (!currentActor || !isPlatformAdmin(currentActor) || currentActor.companyId !== actor.companyId
      || currentActor.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) return fail("NOT_AUTHORIZED");
    const [gate] = await tx.$queryRaw<Array<{ valid: boolean }>>`
      SELECT (i."passiveInboundEnabled" AND i."materializationEnabled" AND NOT i."enabled" AND NOT i."paused"
        AND w."autoStartEnabled" AND c."aiMode"='OFF') AS valid
      FROM "OpenCreditIntegration" i
      JOIN "OpenCreditWhatsappConfig" w ON w."integrationId"=i."id" AND w."companyId"=i."companyId" AND w."providerScope"=i."providerScope"
      JOIN "Company" c ON c."id"=i."companyId"
      WHERE i."id"=${integrationId} AND i."companyId"=${companyId} AND i."providerScope"=${providerScope}
      FOR UPDATE OF i, w`;
    if (!gate?.valid) return fail("GATES_INVALID");
    const budgets = await tx.openCreditMaterializationRolloutBudget.findMany({
      where: { companyId, integrationId, providerScope, releasedAt: null }, take: 2,
      select: { id: true, state: true, admittedCount: true },
    });
    if (budgets.length !== 1 || budgets[0].state !== "CLOSED" || budgets[0].admittedCount !== 1) return fail("CONFLICT");
    const budget = budgets[0];
    const admissions = await tx.openCreditMaterializationRolloutAdmission.findMany({
      where: { rolloutId: budget.id },
      select: { admissionAttempt: true, job: { select: { state: true, attempts: true, leaseToken: true, leaseUntil: true } } },
    });
    if (admissions.length !== 1 || admissions[0].job.leaseToken || admissions[0].job.leaseUntil
      || admissions[0].job.attempts !== admissions[0].admissionAttempt
      || !["COMPLETED","NEEDS_REVIEW","EXPIRED"].includes(admissions[0].job.state)) return fail("CONFLICT");
    const active = await tx.openCreditLeadMaterialization.count({ where: {
      companyId, integrationId, providerScope,
      OR: [{ state: "PROCESSING" }, { leaseToken: { not: null } }, { leaseUntil: { not: null } }],
    } });
    if (active !== 0) return fail("CONFLICT");
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    if (!clock?.now) return fail("CONFLICT");
    await tx.openCreditMaterializationRolloutAdmission.updateMany({
      where: { rolloutId: budget.id, reconciledAt: null }, data: { reconciledAt: clock.now },
    });
    await tx.openCreditMaterializationRolloutBudget.update({
      where: { id: budget.id }, data: { releasedAt: clock.now },
    });
    return { status: "RELEASED" as const, admittedCount: 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 1000, timeout: 5000 });
}

export async function runOpenCreditSingleAdmission(db: Db, input: Input, deps: Dependencies) {
  const { actor, companyId, integrationId, providerScope } = input;
  function validateWorker(rolloutId?: string) {
    const env = deps.env ?? {
      OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED,
      OPENCREDIT_MATERIALIZATION_WORKER_MODE: process.env.OPENCREDIT_MATERIALIZATION_WORKER_MODE,
      OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: process.env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID,
    };
    if (!isOpenCreditMaterializationWorkerEnabled(env)) return;
    const mode = materializationWorkerMode(env);
    if (mode.kind !== "ROLLOUT" || mode.rolloutId === rolloutId) fail("GATES_INVALID");
  }
  async function validate(tx: Prisma.TransactionClient, rolloutId?: string) {
    validateWorker(rolloutId);
    const [currentActor] = await tx.$queryRaw<Array<SessionUser>>`
      SELECT "id", "companyId", "name", "email", "role" FROM "User"
      WHERE "id" = ${actor.id} FOR SHARE`;
    if (!currentActor || !isPlatformAdmin(currentActor) || currentActor.companyId !== actor.companyId
      || currentActor.email.trim().toLowerCase() !== actor.email.trim().toLowerCase()) return fail("NOT_AUTHORIZED");
    const [gate] = await tx.$queryRaw<Array<{ valid: boolean }>>`
      SELECT (i."passiveInboundEnabled" AND i."materializationEnabled" AND NOT i."enabled" AND NOT i."paused"
        AND w."autoStartEnabled" AND w."updatedAt" <= (clock_timestamp() AT TIME ZONE 'UTC')
        AND c."aiMode" = 'OFF') AS valid
      FROM "OpenCreditIntegration" i
      JOIN "OpenCreditWhatsappConfig" w ON w."companyId" = i."companyId"
        AND w."integrationId" = i."id" AND w."providerScope" = i."providerScope"
      JOIN "Company" c ON c."id" = i."companyId"
      WHERE i."id" = ${integrationId} AND i."companyId" = ${companyId} AND i."providerScope" = ${providerScope}
      FOR SHARE OF i, w, c SKIP LOCKED`;
    if (!gate?.valid) return fail("GATES_INVALID");
  }
  if (!isPlatformAdmin(actor)) return fail("NOT_AUTHORIZED");
  const rolloutId = await db.$transaction(async tx => {
    await validate(tx);
    await tx.$queryRaw`
      SELECT "id" FROM "OpenCreditIntegration"
      WHERE "id"=${integrationId} AND "companyId"=${companyId} AND "providerScope"=${providerScope}
      FOR UPDATE`;
    const budgets = await tx.openCreditMaterializationRolloutBudget.findMany({
      where: { companyId, integrationId, providerScope, releasedAt: null }, take: 2,
      select: { id: true, state: true, admittedCount: true, closedAt: true },
    });
    if (budgets.length !== 1) return fail("CONFLICT");
    const current = budgets[0];
    if (await availableRolloutBudget(tx, current.id)) {
      validateWorker(current.id);
      return current.id;
    }

    // A stale reservation may be rotated atomically only when every prior admission
    // is fully settled. RETRY/PROCESSING or any lease marker stays fail-closed so this
    // one-shot pilot can never resurrect partially processed work.
    const admissions = await tx.openCreditMaterializationRolloutAdmission.findMany({
      where: { rolloutId: current.id },
      select: {
        reconciledAt: true, admissionAttempt: true,
        job: { select: { state: true, attempts: true, leaseToken: true, leaseUntil: true } },
      },
    });
    if (current.admittedCount !== admissions.length) return fail("CONFLICT");
    const activeLeases = await tx.openCreditLeadMaterialization.count({ where: {
      companyId, integrationId, providerScope,
      OR: [{ state: "PROCESSING" }, { leaseToken: { not: null } }, { leaseUntil: { not: null } }],
    } });
    if (activeLeases !== 0 || admissions.some(a =>
      a.job.leaseToken || a.job.leaseUntil || a.job.attempts !== a.admissionAttempt
      || !["COMPLETED", "NEEDS_REVIEW", "EXPIRED"].includes(a.job.state))) return fail("CONFLICT");
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`
      SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
    if (!clock?.now) return fail("CONFLICT");
    if (current.state !== "CLOSED") {
      await tx.openCreditMaterializationRolloutBudget.update({
        where: { id: current.id }, data: { state: "CLOSED", closedAt: current.closedAt ?? clock.now },
      });
    }
    await tx.openCreditMaterializationRolloutAdmission.updateMany({
      where: { rolloutId: current.id, reconciledAt: null }, data: { reconciledAt: clock.now },
    });
    await tx.openCreditMaterializationRolloutBudget.update({
      where: { id: current.id }, data: { releasedAt: clock.now },
    });
    const fresh = await tx.openCreditMaterializationRolloutBudget.create({
      data: { companyId, integrationId, providerScope, maxAdmitted: 1,
        expiresAt: new Date(clock.now.getTime() + 15 * 60 * 1000) },
      select: { id: true },
    });
    validateWorker(fresh.id);
    return fresh.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 500, timeout: 2000 });
  const queue = (deps.queue ?? createOpenCreditMaterializationQueue)(db, Math.random, rolloutId, async (tx, binding) => {
    if (binding.companyId !== companyId || binding.integrationId !== integrationId || binding.providerScope !== providerScope) throw new RolloutClaimDenied();
    try { await validate(tx, rolloutId); }
    catch (error) {
      if (error instanceof MaterializationConfigurationError) throw new RolloutClaimDenied();
      throw error;
    }
  });

  const empty = (status: "NO_ELIGIBLE_JOB" | "RESULT_UNCONFIRMED") =>
    ({ status, outcome: null, bootstrapAttempted: false, bootstrapResult: null });
  let outcome;
  let jobId;
  try {
    let leases = await queue.claim(1);
    // claim(1) scans at most 100 waiting candidates per call. A second scan is safe
    // only after the first admitted nothing, so the pilot still cannot admit >1 lead.
    if (leases.length === 0) leases = await queue.claim(1);
    if (leases.length === 0) return empty("NO_ELIGIBLE_JOB");
    if (leases.length !== 1 || leases[0].rolloutId !== rolloutId) return empty("RESULT_UNCONFIRMED");
    jobId = leases[0].id;
    outcome = (await (deps.materializer ?? createOpenCreditDomainMaterializer)(db).process(leases[0]))?.state;
  } catch (error) {
    if (error instanceof RolloutClaimDenied) return fail("GATES_INVALID");
    return empty("RESULT_UNCONFIRMED");
  }
  if (!outcome || !materializationStatuses.includes(outcome)) return empty("RESULT_UNCONFIRMED");
  if (outcome !== "COMPLETED") return { status: "PROCESSED", outcome, bootstrapAttempted: false, bootstrapResult: null };
  let bootstrapResult = "UNKNOWN";
  try {
    const result = await deps.bootstrap(jobId);
    bootstrapResult = !result ? "SKIPPED" : bootstrapStatuses.find(status => status === result.status) ?? "UNKNOWN";
  } catch { /* A delivery may have been attempted. Do not retry. */ }
  return { status: "PROCESSED", outcome, bootstrapAttempted: true, bootstrapResult };
}
