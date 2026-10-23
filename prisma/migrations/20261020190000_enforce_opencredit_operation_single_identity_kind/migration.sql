DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OpenCreditCommercialOperation"
    GROUP BY "companyId", "providerScope", "remoteIdentityId", "operationKind"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'OPENCREDIT_OPERATION_IDENTITY_KIND_DUPLICATES_EXIST';
  END IF;
END $$;

CREATE UNIQUE INDEX "OCOperation_company_scope_identity_kind_key"
ON "OpenCreditCommercialOperation"("companyId", "providerScope", "remoteIdentityId", "operationKind");
