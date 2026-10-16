CREATE UNIQUE INDEX "OCRemoteIdentity_id_company_scope_key"
  ON "OpenCreditRemoteIdentity"("id", "companyId", "providerScope");

CREATE TABLE "OpenCreditRemoteIdentityEvent" (
  "id" TEXT NOT NULL,
  "remoteIdentityId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousEnabled" BOOLEAN,
  "nextEnabled" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpenCreditRemoteIdentityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OCRemoteEvent_identity_created_id_idx"
  ON "OpenCreditRemoteIdentityEvent"("remoteIdentityId", "createdAt", "id");
CREATE INDEX "OCRemoteEvent_actor_idx" ON "OpenCreditRemoteIdentityEvent"("actorUserId");

ALTER TABLE "OpenCreditRemoteIdentityEvent"
  ADD CONSTRAINT "OpenCreditRemoteIdentityEvent_remoteIdentityId_companyId_p_fkey"
  FOREIGN KEY ("remoteIdentityId", "companyId", "providerScope")
  REFERENCES "OpenCreditRemoteIdentity"("id", "companyId", "providerScope")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "OpenCreditRemoteIdentityEvent"
  ADD CONSTRAINT "OpenCreditRemoteIdentityEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
