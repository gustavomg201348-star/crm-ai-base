CREATE UNIQUE INDEX "OCCommercial_id_company_scope_key"
  ON "OpenCreditCommercialAccess"("id", "companyId", "providerScope");

CREATE TABLE "OpenCreditCommercialAccessEvent" (
  "id" TEXT NOT NULL,
  "commercialAccessId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousEnabled" BOOLEAN,
  "nextEnabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenCreditCommercialAccessEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OCAccessEvent_access_created_id_idx"
  ON "OpenCreditCommercialAccessEvent"("commercialAccessId", "createdAt", "id");
CREATE INDEX "OCAccessEvent_actor_idx" ON "OpenCreditCommercialAccessEvent"("actorUserId");

ALTER TABLE "OpenCreditCommercialAccessEvent"
  ADD CONSTRAINT "OpenCreditCommercialAccessEvent_commercialAccessId_company_fkey"
  FOREIGN KEY ("commercialAccessId", "companyId", "providerScope")
  REFERENCES "OpenCreditCommercialAccess"("id", "companyId", "providerScope")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "OpenCreditCommercialAccessEvent"
  ADD CONSTRAINT "OpenCreditCommercialAccessEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
