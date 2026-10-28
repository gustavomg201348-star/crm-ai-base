-- Preserve the pre-existing singleton for UPSERT and all other non-correction kinds.
-- The ordinary Prisma index models lookup only; partial uniques are managed here.
BEGIN;
DROP INDEX "OCOperation_company_scope_identity_kind_key";
CREATE UNIQUE INDEX "OCOperation_company_scope_identity_kind_key"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId", "operationKind")
WHERE "operationKind" <> 'CLIENT_PROFILE_CORRECTION';
CREATE INDEX "OCOperation_identity_kind_lookup_idx"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId", "operationKind");
-- An unresolved correction blocks all subsequent grants/intentions for that identity.
CREATE UNIQUE INDEX "OCOperation_correction_unresolved_key"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId")
WHERE "operationKind" = 'CLIENT_PROFILE_CORRECTION' AND "state" IN ('IN_FLIGHT', 'UNKNOWN');
-- Existing Company/scope/intentKey uniqueness still deduplicates each GRANTED event.
COMMIT;
