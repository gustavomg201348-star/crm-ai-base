CREATE TABLE "OpenCreditAiSimulation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL, "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "inboundEventId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL, "authorizationId" TEXT NOT NULL,
  "authorizationRevision" INTEGER NOT NULL, "authorityGeneration" BIGINT NOT NULL,
  "decisionVersion" INTEGER NOT NULL DEFAULT 1, "intent" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'RUNNING', "tokenHash" TEXT NOT NULL,
  "deadlineAt" TIMESTAMP(3) NOT NULL, "pollCount" INTEGER NOT NULL DEFAULT 0,
  "operationId" TEXT, "protectedFacts" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CltAi_contact" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltAi_conversation" FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltAi_evidence" FOREIGN KEY ("inboundEventId", "companyId", "contactId") REFERENCES "ConversationInboundEvent"("id", "companyId", "contactId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltAi_authorization" FOREIGN KEY ("authorizationId", "companyId", "providerScope") REFERENCES "OpenCreditConsumerAuthorization"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltAi_operation" FOREIGN KEY ("operationId", "companyId", "providerScope") REFERENCES "OpenCreditCommercialOperation"("id", "companyId", "providerScope") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltAi_bounded" CHECK ("pollCount" BETWEEN 0 AND 3 AND "authorizationRevision" >= 0 AND "authorityGeneration" >= 0 AND "decisionVersion" = 1),
  CONSTRAINT "CltAi_state" CHECK ("state" IN ('RUNNING','COMPLETED','PENDING','WAITING_AUTHORIZATION','UNKNOWN','CANCELLED'))
);
CREATE UNIQUE INDEX "OpenCreditAiSimulation_operationId_key" ON "OpenCreditAiSimulation"("operationId");
CREATE UNIQUE INDEX "CltAi_inbound_key" ON "OpenCreditAiSimulation"("companyId", "conversationId", "inboundEventId");
CREATE UNIQUE INDEX "CltAi_grant_key" ON "OpenCreditAiSimulation"("companyId", "conversationId", "authorizationId", "authorizationRevision");
CREATE INDEX "CltAi_scope_idx" ON "OpenCreditAiSimulation"("companyId", "providerScope", "state");
