import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { validRolloutId, type RolloutBinding } from "./opencredit-materialization-rollout-budget.service";

type Code = "NOT_AUTHORIZED" | "INVALID_REQUEST" | "CONFLICT" | "UNAVAILABLE";
export class RolloutAdminError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_ROLLOUT_" + code); }
}
export type RolloutAdminCommand = { companyId: string; integrationId: string } & (
  { action: "CREATE"; maxAdmitted: number; expiresAt: string }
  | { action: "CLOSE"; rolloutId: string }
  | { action: "RELEASE"; rolloutId: string; confirmReconciled: true; expectedAdmittedCount: number }
);
const fail = (code: Code): never => { throw new RolloutAdminError(code); };
export function parseRolloutCommand(value: unknown): RolloutAdminCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!validRolloutId(v.companyId) || !validRolloutId(v.integrationId)) return null;
  const common = ["action", "companyId", "integrationId"];
  const extra = v.action === "CREATE" ? ["maxAdmitted", "expiresAt"]
    : v.action === "CLOSE" ? ["rolloutId"] : v.action === "RELEASE"
      ? ["rolloutId", "confirmReconciled", "expectedAdmittedCount"] : [];
  if (!extra.length || Object.keys(v).length !== common.length + extra.length
      || Object.keys(v).some(k => ![...common, ...extra].includes(k))) return null;
  if (v.action === "CREATE") {
    if (!Number.isInteger(v.maxAdmitted) || Number(v.maxAdmitted) < 1 || Number(v.maxAdmitted) > 3
      || typeof v.expiresAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v.expiresAt)
      || !Number.isFinite(new Date(v.expiresAt).getTime()) || new Date(v.expiresAt).toISOString().replace(".000Z", "Z") !== v.expiresAt.replace(".000Z", "Z")) return null;
  } else if (!validRolloutId(v.rolloutId)) return null;
  if (v.action === "RELEASE" && (v.confirmReconciled !== true || !Number.isInteger(v.expectedAdmittedCount)
    || Number(v.expectedAdmittedCount) < 0 || Number(v.expectedAdmittedCount) > 3)) return null;
  return v as RolloutAdminCommand;
}

export async function executeRolloutAdminCommand(db: Pick<PrismaClient, "$transaction">,
  input: { actor: SessionUser; providerScope: string; command: RolloutAdminCommand }) {
  try {
    if (!parseRolloutCommand(input.command)) return fail("INVALID_REQUEST");
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id },
        select: { id: true, companyId: true, name: true, email: true, role: true } });
      if (!actor || actor.role !== "ADMIN" || actor.companyId !== input.actor.companyId
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase()
        || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      const cmd = input.command;
      if (cmd.action !== "CLOSE" && process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED === "true") return fail("CONFLICT");
      const binding: RolloutBinding = { companyId: cmd.companyId, integrationId: cmd.integrationId, providerScope: input.providerScope };
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
      // Creating/releasing a reservation is an explicitly authorized, quiescent operation.
      // Integration lock + SERIALIZABLE predicates serialize it against ordinary claims.
      const [integration] = await tx.$queryRaw<Array<{ enabled: boolean; paused: boolean; materializationEnabled: boolean }>>`
        SELECT "enabled","paused","materializationEnabled" FROM "OpenCreditIntegration"
        WHERE "id"=${binding.integrationId} AND "companyId"=${binding.companyId} AND "providerScope"=${binding.providerScope}
        FOR UPDATE`;
      if (!integration || (cmd.action !== "CLOSE" && (integration.enabled || integration.paused || !integration.materializationEnabled))) return fail("CONFLICT");
      if (cmd.action === "CREATE") {
        const expiresAt = new Date(cmd.expiresAt);
        if (expiresAt <= clock.now || await tx.openCreditLeadMaterialization.count({
          where: { ...binding, OR: [{ state: "PROCESSING" }, { leaseToken: { not: null } }, { leaseUntil: { not: null } }] },
        })) return fail("CONFLICT");
        const b = await tx.openCreditMaterializationRolloutBudget.create({ data: { ...binding, maxAdmitted: cmd.maxAdmitted, expiresAt } });
        return { rolloutId: b.id, state: b.state, maxAdmitted: b.maxAdmitted, admittedCount: b.admittedCount, releasedAt: null };
      }
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OpenCreditMaterializationRolloutBudget" WHERE "id"=${cmd.rolloutId}
          AND "companyId"=${binding.companyId} AND "integrationId"=${binding.integrationId} AND "providerScope"=${binding.providerScope}
        FOR UPDATE`;
      if (!locked) return fail("CONFLICT");
      const b = await tx.openCreditMaterializationRolloutBudget.findUniqueOrThrow({ where: { id: locked.id } });
      const admissions = await tx.openCreditMaterializationRolloutAdmission.findMany({ where: { rolloutId: b.id },
        select: { admissionAttempt: true, job: { select: { state: true, attempts: true, leaseToken: true, leaseUntil: true } } } });
      if (admissions.length !== b.admittedCount) return fail("CONFLICT");
      if (cmd.action === "CLOSE") {
        await tx.openCreditMaterializationRolloutBudget.update({ where: { id: b.id },
          data: { state: "CLOSED", closedAt: b.closedAt ?? clock.now } });
      } else {
        if (b.state !== "CLOSED" || cmd.expectedAdmittedCount !== b.admittedCount) return fail("CONFLICT");
        if (!b.releasedAt) {
          if (await tx.openCreditLeadMaterialization.count({ where: { ...binding,
            OR: [{ state: "PROCESSING" }, { leaseToken: { not: null } }, { leaseUntil: { not: null } }] } })) return fail("CONFLICT");
          if (admissions.some(a => a.job.leaseToken || a.job.leaseUntil || a.job.attempts !== a.admissionAttempt
            || !["COMPLETED", "RETRY", "NEEDS_REVIEW", "EXPIRED"].includes(a.job.state))) return fail("CONFLICT");
          await tx.openCreditMaterializationRolloutAdmission.updateMany({
            where: { rolloutId: b.id, reconciledAt: null }, data: { reconciledAt: clock.now },
          });
          await tx.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { releasedAt: clock.now } });
        }
      }
      const end = await tx.openCreditMaterializationRolloutBudget.findUniqueOrThrow({ where: { id: b.id } });
      return { rolloutId: end.id, state: end.state, maxAdmitted: end.maxAdmitted, admittedCount: end.admittedCount,
        releasedAt: end.releasedAt?.toISOString() ?? null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 8000 });
  } catch (error) {
    if (error instanceof RolloutAdminError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return fail("CONFLICT");
    return fail("UNAVAILABLE");
  }
}
