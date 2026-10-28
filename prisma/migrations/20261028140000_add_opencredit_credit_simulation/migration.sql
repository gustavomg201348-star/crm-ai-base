-- Structural-only extension: existing purposes, grants, operations and history are not rewritten.
BEGIN;
ALTER TABLE "OpenCreditConsumerAuthorization" DROP CONSTRAINT "OCConsumerAuth_purpose_check";
ALTER TABLE "OpenCreditConsumerAuthorization" ADD CONSTRAINT "OCConsumerAuth_purpose_check"
CHECK ("purpose" IN ('CLIENT_PROFILE_UPSERT', 'CLIENT_PROFILE_CORRECTION', 'CREDIT_SIMULATION'));
-- UPSERT and all unrelated kinds retain the singleton. Correction's index remains untouched.
DROP INDEX "OCOperation_company_scope_identity_kind_key";
CREATE UNIQUE INDEX "OCOperation_company_scope_identity_kind_key"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId", "operationKind")
WHERE "operationKind" NOT IN ('CLIENT_PROFILE_CORRECTION', 'CREDIT_SIMULATION');
CREATE UNIQUE INDEX "OCOperation_simulation_unresolved_key"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId")
WHERE "operationKind" = 'CREDIT_SIMULATION' AND "state" IN ('IN_FLIGHT', 'UNKNOWN');
COMMIT;
