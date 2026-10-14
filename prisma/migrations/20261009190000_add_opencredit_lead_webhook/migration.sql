CREATE TABLE "OpenCreditIntegration" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "publicWebhookId" TEXT NOT NULL,
  "webhookSecret" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenCreditIntegration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OpenCreditLead" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "externalLeadId" TEXT NOT NULL,
  "contactId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenCreditLead_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OpenCreditEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "integrationId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalLeadId" TEXT NOT NULL,
  "contractVersion" INTEGER NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  "processingStatus" TEXT NOT NULL,
  "errorCode" TEXT,
  CONSTRAINT "OpenCreditEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Contact_companyId_id_key" ON "Contact"("companyId", "id");
CREATE UNIQUE INDEX "OpenCreditIntegration_publicWebhookId_key" ON "OpenCreditIntegration"("publicWebhookId");
CREATE UNIQUE INDEX "OpenCreditIntegration_companyId_id_key" ON "OpenCreditIntegration"("companyId", "id");
CREATE UNIQUE INDEX "OpenCreditLead_companyId_integrationId_externalLeadId_key" ON "OpenCreditLead"("companyId", "integrationId", "externalLeadId");
CREATE INDEX "OpenCreditLead_companyId_contactId_idx" ON "OpenCreditLead"("companyId", "contactId");
CREATE UNIQUE INDEX "OpenCreditEvent_integrationId_eventId_key" ON "OpenCreditEvent"("integrationId", "eventId");
CREATE INDEX "OpenCreditEvent_companyId_receivedAt_idx" ON "OpenCreditEvent"("companyId", "receivedAt");
ALTER TABLE "OpenCreditIntegration" ADD CONSTRAINT "OpenCreditIntegration_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditLead" ADD CONSTRAINT "OpenCreditLead_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditLead" ADD CONSTRAINT "OpenCreditLead_companyId_integrationId_fkey"
  FOREIGN KEY ("companyId", "integrationId") REFERENCES "OpenCreditIntegration"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditLead" ADD CONSTRAINT "OpenCreditLead_companyId_contactId_fkey"
  FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditEvent" ADD CONSTRAINT "OpenCreditEvent_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditEvent" ADD CONSTRAINT "OpenCreditEvent_companyId_integrationId_fkey"
  FOREIGN KEY ("companyId", "integrationId") REFERENCES "OpenCreditIntegration"("companyId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpenCreditEvent" ADD CONSTRAINT "OpenCreditEvent_companyId_integrationId_externalLeadId_fkey"
  FOREIGN KEY ("companyId", "integrationId", "externalLeadId") REFERENCES "OpenCreditLead"("companyId", "integrationId", "externalLeadId") ON DELETE RESTRICT ON UPDATE CASCADE;
