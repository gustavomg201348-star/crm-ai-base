-- Additive only: historical integrations remain unbound (NULL). No backfill/DML.
BEGIN;
ALTER TABLE "OpenCreditIntegration" ADD COLUMN "providerScope" TEXT;
ALTER TABLE "OpenCreditIntegration" ADD CONSTRAINT "OCIntegration_scope_check"
CHECK ("providerScope" IS NULL OR (length("providerScope") BETWEEN 1 AND 64
  AND "providerScope" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
  AND "providerScope" !~ '[^a-z0-9-]' AND "providerScope" !~ '[0-9]{11}'));
CREATE UNIQUE INDEX "OCIntegration_id_company_scope_key"
ON "OpenCreditIntegration"("id", "companyId", "providerScope");
CREATE TABLE "OpenCreditInboundEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalLeadId" TEXT NOT NULL,
  "contractVersion" INTEGER,
  "provenanceKind" TEXT NOT NULL,
  "provenanceVersion" INTEGER NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingState" TEXT NOT NULL DEFAULT 'RECEIVED',
  CONSTRAINT "OCInbound_contract_check" CHECK (
    "eventType" = 'lead.assigned' AND ("contractVersion" IS NULL OR "contractVersion" = 2)
    AND "provenanceKind" = 'OPENCREDIT_HMAC_SHA256_VERIFIED' AND "provenanceVersion" = 1
    AND "processingState" = 'RECEIVED'
    AND length("eventId") BETWEEN 3 AND 257 AND length("externalLeadId") BETWEEN 1 AND 128),
  CONSTRAINT "OCInbound_integration_scope_fkey"
    FOREIGN KEY ("integrationId", "companyId", "providerScope")
    REFERENCES "OpenCreditIntegration"("id", "companyId", "providerScope")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "OCInbound_company_scope_event_key"
ON "OpenCreditInboundEvent"("companyId", "providerScope", "eventId");
CREATE INDEX "OCInbound_company_scope_received_idx"
ON "OpenCreditInboundEvent"("companyId", "providerScope", "receivedAt");
COMMIT;
