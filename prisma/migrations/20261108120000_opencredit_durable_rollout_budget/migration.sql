BEGIN;
CREATE UNIQUE INDEX "OCMaterialization_id_binding_key"
ON "OpenCreditLeadMaterialization"("id","companyId","integrationId","providerScope");
CREATE TABLE "OpenCreditMaterializationRolloutBudget" (
 "id" TEXT PRIMARY KEY, "companyId" TEXT NOT NULL, "integrationId" TEXT NOT NULL, "providerScope" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'ACTIVE', "maxAdmitted" INTEGER NOT NULL, "admittedCount" INTEGER NOT NULL DEFAULT 0,
 "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, "closedAt" TIMESTAMP(3), "releasedAt" TIMESTAMP(3),
 CONSTRAINT "OCRollout_state_check" CHECK ("state" IN ('ACTIVE','CLOSED')),
 CONSTRAINT "OCRollout_count_check" CHECK ("maxAdmitted" BETWEEN 1 AND 3 AND "admittedCount" BETWEEN 0 AND "maxAdmitted"),
 CONSTRAINT "OCRollout_closed_check" CHECK (
  ("state"='ACTIVE' AND "closedAt" IS NULL AND "releasedAt" IS NULL AND "admittedCount"<"maxAdmitted")
  OR ("state"='CLOSED' AND "closedAt" IS NOT NULL)),
 CONSTRAINT "OCRollout_dates_check" CHECK ("expiresAt">"createdAt" AND ("releasedAt" IS NULL OR "releasedAt">="closedAt")),
 CONSTRAINT "OCRollout_integration_fkey" FOREIGN KEY ("integrationId","companyId","providerScope")
 REFERENCES "OpenCreditIntegration"("id","companyId","providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "OCRollout_id_binding_key" ON "OpenCreditMaterializationRolloutBudget"("id","companyId","integrationId","providerScope");
-- CLOSED/expired budgets retain their reservation until explicit administrative release.
CREATE UNIQUE INDEX "OCRollout_unreleased_binding_key"
ON "OpenCreditMaterializationRolloutBudget"("companyId","integrationId","providerScope") WHERE "releasedAt" IS NULL;
CREATE TABLE "OpenCreditMaterializationRolloutAdmission" (
 "rolloutId" TEXT NOT NULL, "slot" INTEGER NOT NULL, "jobId" TEXT NOT NULL, "companyId" TEXT NOT NULL,
 "integrationId" TEXT NOT NULL, "providerScope" TEXT NOT NULL, "admissionAttempt" INTEGER NOT NULL,
 "leaseTokenHash" TEXT NOT NULL, "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reconciledAt" TIMESTAMP(3),
 PRIMARY KEY ("rolloutId","slot"),
 CONSTRAINT "OCAdmission_slot_check" CHECK ("slot" BETWEEN 1 AND 3 AND "admissionAttempt">0),
 CONSTRAINT "OCAdmission_hash_check" CHECK ("leaseTokenHash" ~ '^[0-9a-f]{64}$'),
 CONSTRAINT "OCAdmission_reconcile_date_check" CHECK ("reconciledAt" IS NULL OR "reconciledAt">="admittedAt"),
 CONSTRAINT "OCAdmission_budget_fkey" FOREIGN KEY ("rolloutId","companyId","integrationId","providerScope")
 REFERENCES "OpenCreditMaterializationRolloutBudget"("id","companyId","integrationId","providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION,
 CONSTRAINT "OCAdmission_job_fkey" FOREIGN KEY ("jobId","companyId","integrationId","providerScope")
 REFERENCES "OpenCreditLeadMaterialization"("id","companyId","integrationId","providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "OCAdmission_rollout_job_key" ON "OpenCreditMaterializationRolloutAdmission"("rolloutId","jobId");
CREATE UNIQUE INDEX "OCAdmission_unreconciled_job_key" ON "OpenCreditMaterializationRolloutAdmission"("jobId") WHERE "reconciledAt" IS NULL;
CREATE INDEX "OCAdmission_job_idx" ON "OpenCreditMaterializationRolloutAdmission"("jobId");
-- V1 deliberately uses atomic service transactions + CHECK/unique/FK constraints,
-- not a cross-table deferred trigger. Counter/ledger equality is revalidated by
-- every administrative/admission boundary and covered by rollback/concurrency tests.
COMMIT;
