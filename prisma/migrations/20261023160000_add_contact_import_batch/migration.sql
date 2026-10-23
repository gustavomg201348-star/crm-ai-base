CREATE TABLE "ContactImportBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "resultVersion" INTEGER NOT NULL DEFAULT 1,
    "resultJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContactImportBatch_companyId_idempotencyKey_key"
ON "ContactImportBatch"("companyId", "idempotencyKey");

CREATE INDEX "ContactImportBatch_companyId_completedAt_idx"
ON "ContactImportBatch"("companyId", "completedAt");

ALTER TABLE "ContactImportBatch"
ADD CONSTRAINT "ContactImportBatch_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE RESTRICT ON UPDATE NO ACTION;
