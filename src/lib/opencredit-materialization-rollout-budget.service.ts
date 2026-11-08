import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";

export type RolloutBinding = { companyId: string; integrationId: string; providerScope: string };
export type RolloutBudget = RolloutBinding & {
  id: string; state: string; maxAdmitted: number; admittedCount: number; ledgerCount: number;
  expiresAt: Date; closedAt: Date | null; releasedAt: Date | null;
};
type Tx = Prisma.TransactionClient;
export const validRolloutId = (id: unknown): id is string => typeof id === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(id);
export const blockingAdmissionSql = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "OpenCreditMaterializationRolloutAdmission" a WHERE a."jobId"=q."id" AND a."reconciledAt" IS NULL)`;
export const unreservedScopeSql = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "OpenCreditMaterializationRolloutBudget" b
  WHERE b."companyId"=q."companyId" AND b."integrationId"=q."integrationId"
    AND b."providerScope"=q."providerScope" AND b."releasedAt" IS NULL)`;

export async function availableRolloutBudget(
  db: Pick<PrismaClient, "$queryRaw"> | Pick<Tx, "$queryRaw">, id: string, lock = false,
): Promise<RolloutBudget | null> {
  if (!validRolloutId(id)) return null;
  const rows = await db.$queryRaw<RolloutBudget[]>`
    SELECT b.*, (SELECT COUNT(*)::int FROM "OpenCreditMaterializationRolloutAdmission" a
      WHERE a."rolloutId"=b."id") AS "ledgerCount"
    FROM "OpenCreditMaterializationRolloutBudget" b
    WHERE b."id"=${id} AND b."state"='ACTIVE' AND b."releasedAt" IS NULL
      AND b."expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
      AND b."maxAdmitted" BETWEEN 1 AND 3 AND b."admittedCount">=0 AND b."admittedCount"<b."maxAdmitted"
    ${lock ? Prisma.sql`FOR UPDATE OF b SKIP LOCKED` : Prisma.empty}`;
  const row = rows[0];
  return row && row.ledgerCount === row.admittedCount ? row : null;
}

export function sameRolloutBinding(a: RolloutBinding, b: RolloutBinding) {
  return a.companyId === b.companyId && a.integrationId === b.integrationId && a.providerScope === b.providerScope;
}
export const rolloutLeaseHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Caller must hold the budget row lock and have granted this lease in THIS transaction. */
export async function consumeRolloutAdmission(tx: Tx, budget: RolloutBudget,
  lease: { id: string; leaseToken: string; attempts: number }) {
  await tx.openCreditMaterializationRolloutAdmission.create({ data: {
    rolloutId: budget.id, slot: budget.admittedCount + 1, jobId: lease.id,
    companyId: budget.companyId, integrationId: budget.integrationId, providerScope: budget.providerScope,
    admissionAttempt: lease.attempts, leaseTokenHash: rolloutLeaseHash(lease.leaseToken),
  } });
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "OpenCreditMaterializationRolloutBudget"
    SET "admittedCount"="admittedCount"+1,
      "state"=CASE WHEN "admittedCount"+1="maxAdmitted" THEN 'CLOSED' ELSE 'ACTIVE' END,
      "closedAt"=CASE WHEN "admittedCount"+1="maxAdmitted" THEN clock_timestamp() AT TIME ZONE 'UTC' ELSE NULL END,
      "updatedAt"=clock_timestamp() AT TIME ZONE 'UTC'
    WHERE "id"=${budget.id} AND "state"='ACTIVE' AND "releasedAt" IS NULL
      AND "admittedCount"=${budget.admittedCount} AND "admittedCount"<"maxAdmitted"
      AND "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC')
    RETURNING "id"`;
  if (rows.length !== 1) throw new Error("ROLLOUT_ADMISSION_ROLLBACK");
}

/** Plain reads only: never invert the budget -> job claim lock order. CLOSED permits admitted leases. */
export async function validateRolloutLease(tx: Tx, job: RolloutBinding & { id: string; attempts: number },
  lease: { leaseToken: string; rolloutId?: string; admissionAttempt?: number }) {
  const rows = await tx.openCreditMaterializationRolloutAdmission.findMany({
    where: { jobId: job.id, reconciledAt: null }, take: 2,
    include: { budget: true },
  });
  if (rows.length === 0) {
    if (lease.rolloutId !== undefined) return false;
    return await tx.openCreditMaterializationRolloutBudget.count({
      where: { companyId: job.companyId, integrationId: job.integrationId, providerScope: job.providerScope, releasedAt: null },
    }) === 0;
  }
  const a = rows[0];
  return rows.length === 1 && lease.rolloutId === a.rolloutId && lease.admissionAttempt === a.admissionAttempt
    && job.attempts === a.admissionAttempt && sameRolloutBinding(a, job) && sameRolloutBinding(a.budget, job)
    && a.budget.releasedAt === null && a.leaseTokenHash === rolloutLeaseHash(lease.leaseToken);
}
