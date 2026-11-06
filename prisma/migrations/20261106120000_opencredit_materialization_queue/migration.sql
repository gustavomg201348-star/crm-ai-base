BEGIN;

ALTER TABLE "OpenCreditLeadMaterialization"
  ADD COLUMN "availableAt" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT,
  ADD CONSTRAINT "OCMaterialization_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "OCMaterialization_lease_check" CHECK (
    ("state" = 'PROCESSING' AND "leaseToken" IS NOT NULL AND "leaseUntil" IS NOT NULL)
    OR ("state" <> 'PROCESSING' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL)
  ),
  ADD CONSTRAINT "OCMaterialization_retry_schedule_check" CHECK (
    "state" <> 'RETRY' OR "availableAt" IS NOT NULL
  ),
  ADD CONSTRAINT "OCMaterialization_expired_envelope_check" CHECK (
    "state" <> 'EXPIRED' OR "protectedEnvelope" IS NULL
  ),
  ADD CONSTRAINT "OCMaterialization_last_error_check" CHECK (
    "lastErrorCode" IN ('TRANSIENT_FAILURE', 'KEY_UNAVAILABLE', 'SERIALIZATION_CONFLICT', 'LEASE_EXPIRED')
  );

CREATE INDEX "OCMaterialization_queue_ready_idx"
ON "OpenCreditLeadMaterialization" (COALESCE("availableAt", "createdAt"), "id")
WHERE "state" IN ('PENDING', 'RETRY');

CREATE INDEX "OCMaterialization_queue_lease_idx"
ON "OpenCreditLeadMaterialization" ("leaseUntil", "id")
WHERE "state" = 'PROCESSING';

COMMIT;
