import { Prisma, type PrismaClient } from "@prisma/client";
import { evaluateMaterializationReadiness, type ReadinessJob } from "./opencredit-materialization-readiness";

const maxBatchSize = 10;
const maxAttempts = 10;
const retryErrors = ["TRANSIENT_FAILURE", "KEY_UNAVAILABLE", "SERIALIZATION_CONFLICT", "LEASE_EXPIRED", "MODE_UNAVAILABLE"] as const;
const reviewReasons = [
  "ENVELOPE_INVALID", "BINDING_MISMATCH", "IDENTITY_INSUFFICIENT",
  "CONTACT_IDENTITY_CONFLICT", "CONTACT_ARCHIVED_MATCH", "CONTACT_DATA_INCOMPLETE",
  "CHANNEL_CONFIGURATION_CONFLICT", "CONVERSATION_CONFIGURATION_CONFLICT"
] as const;

type RetryError = typeof retryErrors[number];
export type MaterializationReviewReason = typeof reviewReasons[number];
type QueueDb = Pick<PrismaClient, "$queryRaw" | "$transaction">;
export type MaterializationLease = { id: string; leaseToken: string };
type Lease = MaterializationLease;
type ClaimedJob = Lease & { attempts: number; leaseUntil: Date };
export type MaterializationPilotTarget = {
  id: string;
  companyId: string;
  integrationId: string;
  providerScope: string;
};
type FinalState = "RETRY" | "NEEDS_REVIEW" | "COMPLETED" | "EXPIRED";
type Outcome = { id: string; state: FinalState };
type Transition = { state: "RETRY" | "NEEDS_REVIEW"; delayMs: number; error: RetryError | null; review: MaterializationReviewReason | "RETRY_EXHAUSTED" | null };

export class MaterializationLeaseLostError extends Error {
  constructor() { super("OPENCREDIT_MATERIALIZATION_LEASE_LOST"); }
}

export async function completeInTransaction(
  tx: Prisma.TransactionClient,
  lease: Lease,
  outcome: { contactId: string; channelId: string; conversationId: string }
) {
  const [result] = await tx.$queryRaw<Array<{ id: string; state: "COMPLETED" }>>`
    WITH locked AS MATERIALIZED (
      SELECT "id" FROM "OpenCreditLeadMaterialization"
      WHERE "id" = ${lease.id} AND "state" = 'PROCESSING' AND "leaseToken" = ${lease.leaseToken}
      FOR UPDATE
    ), t AS MATERIALIZED (
      SELECT "id", clock_timestamp() AT TIME ZONE 'UTC' AS now FROM locked
    )
    UPDATE "OpenCreditLeadMaterialization" AS q
    SET "state" = 'COMPLETED', "contactId" = ${outcome.contactId}, "channelId" = ${outcome.channelId},
        "conversationId" = ${outcome.conversationId}, "protectedEnvelope" = NULL, "availableAt" = NULL,
        "leaseToken" = NULL, "leaseUntil" = NULL, "lastErrorCode" = NULL, "reviewCode" = NULL, "updatedAt" = t.now
    FROM t
    WHERE q."id" = t."id" AND q."leaseUntil" > t.now AND q."expiresAt" > t.now
    RETURNING q."id", q."state"`;
  if (!result) throw new MaterializationLeaseLostError();
  return result;
}

function batchSize(requested: number) {
  if (!Number.isInteger(requested) || requested < 1) throw new Error("INVALID_MATERIALIZATION_BATCH_SIZE");
  return Math.min(requested, maxBatchSize);
}

// Equal jitter above the 5 s floor, with the entire window bounded by 5 min.
export function materializationRetryDelayMs(attempt: number, random: () => number = Math.random) {
  const ceiling = Math.min(300_000, 5_000 * 2 ** (Math.max(1, attempt) - 1));
  const floor = Math.max(5_000, ceiling / 2);
  return Math.floor(floor + (ceiling - floor) * random());
}

async function transitionLease(tx: Prisma.TransactionClient, lease: Lease, next: Transition, recovering = false) {
  const [result] = await tx.$queryRaw<Outcome[]>`
    WITH t AS (SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now)
    UPDATE "OpenCreditLeadMaterialization" AS q
    SET "state" = CASE WHEN q."expiresAt" <= t.now THEN 'EXPIRED' ELSE ${next.state} END,
        "availableAt" = CASE WHEN q."expiresAt" > t.now AND ${next.state} = 'RETRY'
                             THEN t.now + ${next.delayMs}::integer * INTERVAL '1 millisecond' ELSE NULL END,
        "leaseToken" = NULL,
        "leaseUntil" = NULL,
        "lastErrorCode" = CASE WHEN q."expiresAt" <= t.now THEN NULL ELSE ${next.error}::text END,
        "reviewCode" = CASE WHEN q."expiresAt" <= t.now THEN q."reviewCode" ELSE ${next.review}::text END,
        "protectedEnvelope" = CASE WHEN q."expiresAt" <= t.now
                                   THEN NULL ELSE q."protectedEnvelope" END,
        "updatedAt" = t.now
    FROM t
    WHERE q."id" = ${lease.id} AND q."state" = 'PROCESSING' AND q."leaseToken" = ${lease.leaseToken}
      AND CASE WHEN ${recovering} THEN q."leaseUntil" <= t.now ELSE q."leaseUntil" > t.now END
    RETURNING q."id", q."state"`;
  return result ?? null;
}

export function createOpenCreditMaterializationQueue(db: QueueDb, random: () => number = Math.random) {
  function retryTransition(attempts: number, error: RetryError): Transition {
    return attempts >= maxAttempts
      ? { state: "NEEDS_REVIEW", delayMs: 0, error, review: "RETRY_EXHAUSTED" }
      : { state: "RETRY", delayMs: materializationRetryDelayMs(attempts, random), error, review: null };
  }

  async function withLease(lease: Lease, next: (attempts: number) => Transition) {
    return db.$transaction(async tx => {
      const [job] = await tx.$queryRaw<Array<{ attempts: number }>>`
        SELECT "attempts" FROM "OpenCreditLeadMaterialization"
        WHERE "id" = ${lease.id} AND "state" = 'PROCESSING' AND "leaseToken" = ${lease.leaseToken}
          AND "leaseUntil" > (statement_timestamp() AT TIME ZONE 'UTC')
        FOR UPDATE`;
      return job ? transitionLease(tx, lease, next(job.attempts)) : null;
    });
  }

  // The process-local keyset cursor advances across waiting jobs, at most 100 per call.
  let cursor: { ready: Date; id: string } | null = null;
  let ceiling: { ready: Date; id: string } | null = null;
  async function claimReady(target: MaterializationPilotTarget, pilot: boolean): Promise<ClaimedJob | null> {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`LOCK TABLE "Contact" IN SHARE MODE NOWAIT`;
        const [job] = await tx.$queryRaw<Array<ReadinessJob>>`
          SELECT "id", "companyId", "integrationId", "providerScope", "externalLeadId", "inboundEventId", "protectedEnvelope"
          FROM "OpenCreditLeadMaterialization"
          WHERE "id" = ${target.id} AND "companyId" = ${target.companyId}
            AND "integrationId" = ${target.integrationId} AND "providerScope" = ${target.providerScope}
            AND "state" IN ('PENDING', 'RETRY') AND "attempts" < ${maxAttempts}
            AND (NOT ${pilot} OR ("state" = 'PENDING' AND "attempts" = 0))
            AND "expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
            AND ("availableAt" <= (clock_timestamp() AT TIME ZONE 'UTC') OR ("state" = 'PENDING' AND "availableAt" IS NULL))
          FOR UPDATE SKIP LOCKED`;
        if (!job) return null;
        const [integration] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "OpenCreditIntegration"
          WHERE "id" = ${job.integrationId} AND "companyId" = ${job.companyId} AND "providerScope" = ${job.providerScope}
            AND NOT "enabled" AND NOT "paused" AND "materializationEnabled"
          FOR SHARE SKIP LOCKED`;
        if (!integration) return null;
        // Protect absence predicates as well as matching rows against all Contact writers.
        // NOWAIT avoids waiting on unrelated writes; held only for this candidate's claim.
        const readiness = await evaluateMaterializationReadiness(tx, job);
        if (readiness !== "READY_EXISTING_CONTACT" && readiness !== "READY_NEW_CONTACT") return null;
        const [lease] = await tx.$queryRaw<ClaimedJob[]>`
          WITH t AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now)
          UPDATE "OpenCreditLeadMaterialization" q
          SET "state" = 'PROCESSING', "availableAt" = NULL, "leaseToken" = gen_random_uuid()::text,
              "leaseUntil" = t.now + INTERVAL '60 seconds', "attempts" = q."attempts" + 1, "updatedAt" = t.now
          FROM t WHERE q."id" = ${job.id} AND q."expiresAt" > t.now
            AND q."state" IN ('PENDING', 'RETRY') AND q."attempts" < ${maxAttempts}
            AND (NOT ${pilot} OR (q."state" = 'PENDING' AND q."attempts" = 0))
            AND (q."availableAt" <= t.now OR (q."state" = 'PENDING' AND q."availableAt" IS NULL))
          RETURNING q."id", q."leaseToken", q."leaseUntil", q."attempts"`;
        return lease ?? null;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 150, timeout: 2000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === "P2034" || error.code === "P2010" &&
            ["55P03", "40001", "40P01"].includes(String(error.meta?.code)))) return null;
      throw new Error("MATERIALIZATION_CLAIM_UNAVAILABLE");
    }
  }

  return {
    claimPilotJob(target: MaterializationPilotTarget) { return claimReady(target, true); },

    async claim(limit = maxBatchSize) {
      const wanted = batchSize(limit);
      const claimed: ClaimedJob[] = [];
      for (let page = 0; page < 4 && claimed.length < wanted; page++) {
        if (ceiling === null) {
          const [last] = await db.$queryRaw<Array<{ ready: Date; id: string }>>`
            SELECT COALESCE("availableAt", "createdAt") AS ready, "id"
            FROM "OpenCreditLeadMaterialization"
            WHERE "state" IN ('PENDING', 'RETRY') AND "attempts" < ${maxAttempts}
              AND "expiresAt" > (statement_timestamp() AT TIME ZONE 'UTC')
              AND ("availableAt" <= (statement_timestamp() AT TIME ZONE 'UTC') OR ("state" = 'PENDING' AND "availableAt" IS NULL))
            ORDER BY ready DESC, "id" DESC LIMIT 1`;
          if (!last) break;
          ceiling = last;
        }
        const after: Prisma.Sql = cursor
          ? Prisma.sql`AND (COALESCE(q."availableAt", q."createdAt"), q."id") > (${cursor.ready}, ${cursor.id})`
          : Prisma.empty;
        const candidates = await db.$queryRaw<Array<MaterializationPilotTarget & { ready: Date }>>`
          SELECT q."id", q."companyId", q."integrationId", q."providerScope", COALESCE(q."availableAt", q."createdAt") AS ready
          FROM "OpenCreditLeadMaterialization" q
          JOIN "OpenCreditIntegration" i ON i."id" = q."integrationId" AND i."companyId" = q."companyId" AND i."providerScope" = q."providerScope"
          WHERE q."state" IN ('PENDING', 'RETRY') AND q."attempts" < ${maxAttempts}
            AND q."expiresAt" > (statement_timestamp() AT TIME ZONE 'UTC')
            AND (q."availableAt" <= (statement_timestamp() AT TIME ZONE 'UTC') OR (q."state" = 'PENDING' AND q."availableAt" IS NULL))
            AND NOT i."enabled" AND NOT i."paused" AND i."materializationEnabled" ${after}
            AND (COALESCE(q."availableAt", q."createdAt"), q."id") <= (${ceiling.ready}, ${ceiling.id})
          ORDER BY ready, q."id" LIMIT 25`;
        if (!candidates.length) {
          if (cursor !== null) { cursor = null; ceiling = null; continue; }
          ceiling = null;
          break;
        }
        for (const candidate of candidates) {
          cursor = { ready: candidate.ready, id: candidate.id };
          const lease = await claimReady(candidate, false);
          if (lease) claimed.push(lease);
          if (claimed.length === wanted) break;
        }
      }
      return claimed;
    },

    retry(lease: Lease, error: RetryError) {
      if (!retryErrors.includes(error)) throw new Error("INVALID_MATERIALIZATION_RETRY_CODE");
      return withLease(lease, attempts => retryTransition(attempts, error));
    },

    review(lease: Lease, reason: MaterializationReviewReason) {
      if (!reviewReasons.includes(reason)) throw new Error("INVALID_MATERIALIZATION_REVIEW_CODE");
      return withLease(lease, () => ({ state: "NEEDS_REVIEW", delayMs: 0, error: null, review: reason }));
    },

    async recover(limit = maxBatchSize) {
      return db.$transaction(async tx => {
        const jobs = await tx.$queryRaw<Array<Lease & { attempts: number }>>`
          SELECT "id", "leaseToken", "attempts" FROM "OpenCreditLeadMaterialization"
          WHERE "state" = 'PROCESSING' AND "leaseUntil" <= (statement_timestamp() AT TIME ZONE 'UTC')
          ORDER BY "leaseUntil", "id" LIMIT ${batchSize(limit)} FOR UPDATE SKIP LOCKED`;
        const outcomes: Outcome[] = [];
        for (const job of jobs) {
          const outcome = await transitionLease(tx, job, retryTransition(job.attempts, "LEASE_EXPIRED"), true);
          if (outcome) outcomes.push(outcome);
        }
        return outcomes;
      });
    },

    async expire(limit = maxBatchSize) {
      return db.$queryRaw<Outcome[]>`
        WITH t AS (SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now),
        candidates AS (
          SELECT q."id" FROM "OpenCreditLeadMaterialization" AS q, t
          WHERE q."state" IN ('PENDING', 'RETRY', 'PROCESSING', 'NEEDS_REVIEW') AND q."expiresAt" <= t.now
          ORDER BY q."expiresAt", q."id" LIMIT ${batchSize(limit)}
          FOR UPDATE OF q SKIP LOCKED
        )
        UPDATE "OpenCreditLeadMaterialization" AS q
        SET "state" = 'EXPIRED', "protectedEnvelope" = NULL, "availableAt" = NULL,
            "leaseToken" = NULL, "leaseUntil" = NULL, "lastErrorCode" = NULL, "updatedAt" = t.now
        FROM candidates, t WHERE q."id" = candidates."id"
        RETURNING q."id", q."state"`;
    },
  };
}
