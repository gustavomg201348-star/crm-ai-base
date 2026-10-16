CREATE TABLE "OpenCreditCommercialOperation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "remoteIdentityId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "operationKind" TEXT NOT NULL,
  "intentKey" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PREPARED',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenCreditCommercialOperation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpenCreditCommercialOperationEvent" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousState" TEXT,
  "nextState" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenCreditCommercialOperationEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OCOperation_company_scope_intent_key" ON "OpenCreditCommercialOperation"("companyId", "providerScope", "intentKey");
CREATE UNIQUE INDEX "OCOperation_id_company_scope_key" ON "OpenCreditCommercialOperation"("id", "companyId", "providerScope");
CREATE INDEX "OCOperation_identity_created_id_idx" ON "OpenCreditCommercialOperation"("remoteIdentityId", "createdAt", "id");
CREATE INDEX "OCOperation_scope_state_created_id_idx" ON "OpenCreditCommercialOperation"("companyId", "providerScope", "state", "createdAt", "id");
CREATE INDEX "OCOperation_actor_idx" ON "OpenCreditCommercialOperation"("createdByUserId");
CREATE INDEX "OCOperationEvent_operation_created_id_idx" ON "OpenCreditCommercialOperationEvent"("operationId", "createdAt", "id");
CREATE INDEX "OCOperationEvent_actor_idx" ON "OpenCreditCommercialOperationEvent"("actorUserId");

ALTER TABLE "OpenCreditCommercialOperation" ADD CONSTRAINT "OpenCreditCommercialOperation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialOperation" ADD CONSTRAINT "OpenCreditCommercialOperation_remoteIdentityId_companyId_p_fkey"
  FOREIGN KEY ("remoteIdentityId", "companyId", "providerScope")
  REFERENCES "OpenCreditRemoteIdentity"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialOperation" ADD CONSTRAINT "OpenCreditCommercialOperation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialOperationEvent" ADD CONSTRAINT "OpenCreditCommercialOperationEvent_operationId_companyId_p_fkey"
  FOREIGN KEY ("operationId", "companyId", "providerScope")
  REFERENCES "OpenCreditCommercialOperation"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialOperationEvent" ADD CONSTRAINT "OpenCreditCommercialOperationEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
