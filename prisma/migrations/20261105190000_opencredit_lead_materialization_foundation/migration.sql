ALTER TABLE "OpenCreditIntegration"
ADD COLUMN "materializationEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "OCInbound_id_company_scope_integration_lead_key"
ON "OpenCreditInboundEvent"("id", "companyId", "providerScope", "integrationId", "externalLeadId");

CREATE TABLE "OpenCreditLeadMaterialization" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "externalLeadId" TEXT NOT NULL,
  "inboundEventId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "protectedEnvelope" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "reviewCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenCreditLeadMaterialization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OCMaterialization_state_check" CHECK (
    "state" IN ('PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'NEEDS_REVIEW', 'EXPIRED')
  ),
  CONSTRAINT "OCMaterialization_inbound_binding_fkey"
    FOREIGN KEY ("inboundEventId", "companyId", "providerScope", "integrationId", "externalLeadId")
    REFERENCES "OpenCreditInboundEvent"("id", "companyId", "providerScope", "integrationId", "externalLeadId")
    ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "OCMaterialization_company_scope_lead_key"
ON "OpenCreditLeadMaterialization"("companyId", "providerScope", "externalLeadId");
CREATE UNIQUE INDEX "OCMaterialization_inbound_event_key"
ON "OpenCreditLeadMaterialization"("inboundEventId");
CREATE INDEX "OCMaterialization_expires_idx"
ON "OpenCreditLeadMaterialization"("expiresAt");
