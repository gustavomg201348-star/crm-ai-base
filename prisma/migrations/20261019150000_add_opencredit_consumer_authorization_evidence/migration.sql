-- Additive operational evidence only: no DML or historical grants.
CREATE UNIQUE INDEX "InboundEvent_id_company_contact_key" ON "ConversationInboundEvent"("id", "companyId", "contactId");
CREATE TABLE "OpenCreditConsumerAuthorization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "remoteIdentityId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "evidenceInboundEventId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL,
  "changedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OCConsumerAuth_purpose_check" CHECK ("purpose" = 'CLIENT_PROFILE_UPSERT'),
  CONSTRAINT "OCConsumerAuth_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "OCConsumerAuth_company_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuth_contact_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuth_identity_fkey" FOREIGN KEY ("remoteIdentityId", "companyId", "providerScope") REFERENCES "OpenCreditRemoteIdentity"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuth_evidence_fkey" FOREIGN KEY ("evidenceInboundEventId", "companyId", "contactId") REFERENCES "ConversationInboundEvent"("id", "companyId", "contactId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuth_actor_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "OCConsumerAuth_company_scope_contact_purpose_key" ON "OpenCreditConsumerAuthorization"("companyId", "providerScope", "contactId", "purpose");
CREATE UNIQUE INDEX "OCConsumerAuth_id_company_scope_key" ON "OpenCreditConsumerAuthorization"("id", "companyId", "providerScope");
CREATE INDEX "OCConsumerAuth_identity_idx" ON "OpenCreditConsumerAuthorization"("remoteIdentityId");
CREATE INDEX "OCConsumerAuth_actor_idx" ON "OpenCreditConsumerAuthorization"("changedByUserId");
CREATE INDEX "OCConsumerAuth_scope_active_idx" ON "OpenCreditConsumerAuthorization"("companyId", "providerScope", "active");
CREATE INDEX "OCConsumerAuth_evidence_idx" ON "OpenCreditConsumerAuthorization"("evidenceInboundEventId");
CREATE TABLE "OpenCreditConsumerAuthorizationEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "authorizationId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "previousActive" BOOLEAN,
  "nextActive" BOOLEAN NOT NULL,
  "revision" INTEGER NOT NULL,
  "evidenceInboundEventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OCConsumerAuthEvent_action_check" CHECK ("action" IN ('GRANTED', 'REVOKED')),
  CONSTRAINT "OCConsumerAuthEvent_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "OCConsumerAuthEvent_transition_check" CHECK (("action" = 'GRANTED' AND "nextActive" = TRUE) OR ("action" = 'REVOKED' AND "previousActive" IS TRUE AND "nextActive" = FALSE)),
  CONSTRAINT "OCConsumerAuthEvent_authorization_fkey" FOREIGN KEY ("authorizationId", "companyId", "providerScope") REFERENCES "OpenCreditConsumerAuthorization"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuthEvent_actor_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "OCConsumerAuthEvent_evidence_fkey" FOREIGN KEY ("evidenceInboundEventId") REFERENCES "ConversationInboundEvent"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "OCConsumerAuthEvent_authorization_idx" ON "OpenCreditConsumerAuthorizationEvent"("authorizationId", "createdAt", "id");
CREATE INDEX "OCConsumerAuthEvent_actor_idx" ON "OpenCreditConsumerAuthorizationEvent"("actorUserId");
CREATE INDEX "OCConsumerAuthEvent_evidence_idx" ON "OpenCreditConsumerAuthorizationEvent"("evidenceInboundEventId");
