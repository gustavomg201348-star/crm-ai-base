ALTER TABLE "OpenCreditIntegration"
  ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "OpenCreditLead"
  ADD COLUMN "held" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "OpenCreditLead_companyId_integrationId_held_idx"
  ON "OpenCreditLead"("companyId", "integrationId", "held");
