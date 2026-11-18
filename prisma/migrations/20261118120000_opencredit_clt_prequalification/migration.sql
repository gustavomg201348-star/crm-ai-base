CREATE TABLE "OpenCreditCltPrequalification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "inboundEventId" TEXT NOT NULL,
  "providerScope" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "protectedResult" TEXT,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CltPrequal_contact" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltPrequal_conversation" FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltPrequal_evidence" FOREIGN KEY ("inboundEventId", "companyId", "contactId") REFERENCES "ConversationInboundEvent"("id", "companyId", "contactId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "CltPrequal_state" CHECK ("state" IN ('PENDING','PROCESSING','COMPLETED','FAILED')),
  CONSTRAINT "CltPrequal_attempts" CHECK ("attempts" BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX "CltPrequal_inbound_key" ON "OpenCreditCltPrequalification"("companyId", "conversationId", "inboundEventId");
CREATE INDEX "CltPrequal_state_available_idx" ON "OpenCreditCltPrequalification"("state", "availableAt", "id");
CREATE INDEX "CltPrequal_conversation_created_idx" ON "OpenCreditCltPrequalification"("companyId", "conversationId", "createdAt", "id");
