import type { Prisma, PrismaClient } from "@prisma/client";

const maxBatchSize = 10;
const maxAttempts = 10;
const retryErrors = ["TRANSIENT_FAILURE", "KEY_UNAVAILABLE", "SERIALIZATION_CONFLICT", "LEASE_EXPIRED"] as const;
const reviewReasons = ["ENVELOPE_INVALID", "BINDING_MISMATCH", "IDENTITY_INSUFFICIENT"] as const;

type RetryError = typeof retryErrors[number];
type ReviewReason = typeof reviewReasons[number];
type QueueDb = Pick<PrismaClient, "$queryRaw" | "$transaction">;
type Lease = { id: string; leaseToken: string };
type ClaimedJob = Lease & { attempts: number; leaseUntil: Date };
type FinalState = "RETRY" | "NEEDS_REVIEW" | "COMPLETED" | "EXPIRED";
type Outcome = { id: string; state: FinalState };
type Transition = { state: Exclude<FinalState, "EXPIRED">; delayMs: number; error: RetryError | null; review: ReviewReason | "RETRY_EXHAUSTED" | null };

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
        "protectedEnvelope" = CASE WHEN q."expiresAt" <= t.now OR ${next.state} = 'COMPLETED'
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

  return {
    async claim(limit = maxBatchSize) {
      // A single statement acquires, updates and releases row locks before returning.
      return db.$queryRaw<ClaimedJob[]>`
        WITH t AS (SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now),
        candidates AS (
          SELECT q."id", COALESCE(q."availableAt", q."createdAt") AS ready
          FROM "OpenCreditLeadMaterialization" AS q
          JOIN "OpenCreditIntegration" AS i ON i."id" = q."integrationId"
            AND i."companyId" = q."companyId" AND i."providerScope" = q."providerScope"
          CROSS JOIN t
          WHERE q."state" IN ('PENDING', 'RETRY') AND q."expiresAt" > t.now
            AND (q."availableAt" <= t.now OR (q."state" = 'PENDING' AND q."availableAt" IS NULL))
            AND q."attempts" < ${maxAttempts} AND i."materializationEnabled" = true
          ORDER BY ready, q."id" LIMIT ${batchSize(limit)}
          FOR UPDATE OF q SKIP LOCKED
        ), claimed AS (
          UPDATE "OpenCreditLeadMaterialization" AS q
          SET "state" = 'PROCESSING', "availableAt" = NULL, "leaseToken" = gen_random_uuid()::text,
              "leaseUntil" = t.now + INTERVAL '60 seconds', "attempts" = q."attempts" + 1, "updatedAt" = t.now
          FROM candidates, t WHERE q."id" = candidates."id"
          RETURNING q."id", q."leaseToken", q."leaseUntil", q."attempts"
        )
        SELECT claimed.* FROM claimed JOIN candidates USING ("id") ORDER BY candidates.ready, claimed."id"`;
    },

    retry(lease: Lease, error: RetryError) {
      if (!retryErrors.includes(error)) throw new Error("INVALID_MATERIALIZATION_RETRY_CODE");
      return withLease(lease, attempts => retryTransition(attempts, error));
    },

    review(lease: Lease, reason: ReviewReason) {
      if (!reviewReasons.includes(reason)) throw new Error("INVALID_MATERIALIZATION_REVIEW_CODE");
      return withLease(lease, () => ({ state: "NEEDS_REVIEW", delayMs: 0, error: null, review: reason }));
    },

    // Technical transition for state-machine tests. A future materializer must
    // complete in the same transaction as its domain writes.
    complete(lease: Lease) {
      return withLease(lease, () => ({ state: "COMPLETED", delayMs: 0, error: null, review: null }));
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
