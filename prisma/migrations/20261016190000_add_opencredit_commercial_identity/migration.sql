CREATE TABLE "OpenCreditCommercialAccess" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "changedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenCreditCommercialAccess_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpenCreditRemoteIdentity" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "normalizedCpf" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpenCreditRemoteIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OCCommercial_company_scope_key" ON "OpenCreditCommercialAccess"("companyId", "providerScope");
CREATE INDEX "OCCommercial_actor_idx" ON "OpenCreditCommercialAccess"("changedByUserId");
CREATE UNIQUE INDEX "OCRemote_scope_cpf_key" ON "OpenCreditRemoteIdentity"("providerScope", "normalizedCpf");
CREATE UNIQUE INDEX "OCRemote_company_scope_contact_key" ON "OpenCreditRemoteIdentity"("companyId", "providerScope", "contactId");
CREATE INDEX "OCRemote_company_contact_idx" ON "OpenCreditRemoteIdentity"("companyId", "contactId");
CREATE INDEX "OCRemote_actor_idx" ON "OpenCreditRemoteIdentity"("createdByUserId");

ALTER TABLE "OpenCreditCommercialAccess" ADD CONSTRAINT "OpenCreditCommercialAccess_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditCommercialAccess" ADD CONSTRAINT "OpenCreditCommercialAccess_changedByUserId_fkey"
  FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditRemoteIdentity" ADD CONSTRAINT "OpenCreditRemoteIdentity_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditRemoteIdentity" ADD CONSTRAINT "OpenCreditRemoteIdentity_companyId_contactId_fkey"
  FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditRemoteIdentity" ADD CONSTRAINT "OpenCreditRemoteIdentity_companyId_providerScope_fkey"
  FOREIGN KEY ("companyId", "providerScope") REFERENCES "OpenCreditCommercialAccess"("companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "OpenCreditRemoteIdentity" ADD CONSTRAINT "OpenCreditRemoteIdentity_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
