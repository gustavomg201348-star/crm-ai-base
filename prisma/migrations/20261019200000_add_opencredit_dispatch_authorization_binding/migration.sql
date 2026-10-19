-- Additive binding. Historical reservations remain NULL; no inferred authorization.
CREATE UNIQUE INDEX "OCConsumerAuthEvent_authorization_revision_key"
  ON "OpenCreditConsumerAuthorizationEvent"("authorizationId", "revision");
CREATE UNIQUE INDEX "OCConsumerAuthEvent_id_company_scope_key"
  ON "OpenCreditConsumerAuthorizationEvent"("id", "companyId", "providerScope");
ALTER TABLE "OpenCreditCommercialOperationEvent" ADD COLUMN "dispatchAuthorizationEventId" TEXT;
CREATE INDEX "OCOperationEvent_dispatch_auth_idx"
  ON "OpenCreditCommercialOperationEvent"("dispatchAuthorizationEventId");
ALTER TABLE "OpenCreditCommercialOperationEvent" ADD CONSTRAINT "OCOperationEvent_dispatch_auth_fkey"
  FOREIGN KEY ("dispatchAuthorizationEventId", "companyId", "providerScope")
  REFERENCES "OpenCreditConsumerAuthorizationEvent"("id", "companyId", "providerScope")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialOperationEvent" ADD CONSTRAINT "OCOperationEvent_dispatch_auth_action_check"
  CHECK ("dispatchAuthorizationEventId" IS NULL OR "action" = 'RESERVED_FOR_DISPATCH');
