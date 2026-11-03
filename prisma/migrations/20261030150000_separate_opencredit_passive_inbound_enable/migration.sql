-- Independent opt-in. Historical legacy flags and all other values are preserved.
-- No DML or activation backfill: every existing integration starts passive-disabled.
BEGIN;
ALTER TABLE "OpenCreditIntegration"
ADD COLUMN "passiveInboundEnabled" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
