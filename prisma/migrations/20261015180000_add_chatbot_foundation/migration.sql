-- CreateTable
CREATE TABLE "ChatbotFlow" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "publishedVersionId" TEXT,
    "versionCounter" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatbotFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotFlowVersion" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "definition" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotFlowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotSession" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersionId" TEXT NOT NULL,
    "campaignId" TEXT,
    "campaignRecipientId" TEXT,
    "activeConversationId" TEXT,
    "currentStepId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "authority" TEXT NOT NULL DEFAULT 'CHATBOT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "suspensionReason" TEXT,
    "closureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ChatbotSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotEvent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sessionRevision" INTEGER,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "processedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatbotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatbotOutbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatbotOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatbotFlow_companyId_isActive_idx" ON "ChatbotFlow"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotFlow_companyId_id_key" ON "ChatbotFlow"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotFlowVersion_companyId_flowId_number_key" ON "ChatbotFlowVersion"("companyId", "flowId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotFlowVersion_companyId_flowId_id_key" ON "ChatbotFlowVersion"("companyId", "flowId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotSession_activeConversationId_key" ON "ChatbotSession"("activeConversationId");

-- CreateIndex
CREATE INDEX "ChatbotSession_companyId_conversationId_createdAt_idx" ON "ChatbotSession"("companyId", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatbotSession_status_expiresAt_idx" ON "ChatbotSession"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotSession_companyId_channelId_id_key" ON "ChatbotSession"("companyId", "channelId", "id");

-- CreateIndex
CREATE INDEX "ChatbotEvent_status_availableAt_idx" ON "ChatbotEvent"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotEvent_companyId_channelId_idempotencyKey_key" ON "ChatbotEvent"("companyId", "channelId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotEvent_companyId_channelId_sessionId_id_key" ON "ChatbotEvent"("companyId", "channelId", "sessionId", "id");

-- CreateIndex
CREATE INDEX "ChatbotOutbox_status_availableAt_idx" ON "ChatbotOutbox"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotOutbox_companyId_channelId_idempotencyKey_key" ON "ChatbotOutbox"("companyId", "channelId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_companyId_id_key" ON "Channel"("companyId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_id_contactId_channelId_key" ON "Conversation"("id", "contactId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_companyId_channelId_id_key" ON "Campaign"("companyId", "channelId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_id_contactId_conversationId_key" ON "CampaignRecipient"("campaignId", "id", "contactId", "conversationId");

-- AddForeignKey
ALTER TABLE "ChatbotFlow" ADD CONSTRAINT "ChatbotFlow_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatbotFlow" ADD CONSTRAINT "ChatbotFlow_companyId_id_publishedVersionId_fkey" FOREIGN KEY ("companyId", "id", "publishedVersionId") REFERENCES "ChatbotFlowVersion"("companyId", "flowId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotFlowVersion" ADD CONSTRAINT "ChatbotFlowVersion_companyId_flowId_fkey" FOREIGN KEY ("companyId", "flowId") REFERENCES "ChatbotFlow"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_companyId_channelId_fkey" FOREIGN KEY ("companyId", "channelId") REFERENCES "Channel"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_conversationId_contactId_channelId_fkey" FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_companyId_flowId_flowVersionId_fkey" FOREIGN KEY ("companyId", "flowId", "flowVersionId") REFERENCES "ChatbotFlowVersion"("companyId", "flowId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_companyId_channelId_campaignId_fkey" FOREIGN KEY ("companyId", "channelId", "campaignId") REFERENCES "Campaign"("companyId", "channelId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_campaignId_campaignRecipientId_contactId_co_fkey" FOREIGN KEY ("campaignId", "campaignRecipientId", "contactId", "conversationId") REFERENCES "CampaignRecipient"("campaignId", "id", "contactId", "conversationId") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotEvent" ADD CONSTRAINT "ChatbotEvent_companyId_channelId_sessionId_fkey" FOREIGN KEY ("companyId", "channelId", "sessionId") REFERENCES "ChatbotSession"("companyId", "channelId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotOutbox" ADD CONSTRAINT "ChatbotOutbox_companyId_channelId_sessionId_fkey" FOREIGN KEY ("companyId", "channelId", "sessionId") REFERENCES "ChatbotSession"("companyId", "channelId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotOutbox" ADD CONSTRAINT "ChatbotOutbox_companyId_channelId_sessionId_eventId_fkey" FOREIGN KEY ("companyId", "channelId", "sessionId", "eventId") REFERENCES "ChatbotEvent"("companyId", "channelId", "sessionId", "id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- Runtime invariants that Prisma 5 cannot represent as CHECK constraints.
ALTER TABLE "ChatbotFlowVersion" ADD CONSTRAINT "ChatbotFlowVersion_publication_check"
CHECK (("status" = 'DRAFT' AND "publishedAt" IS NULL) OR ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL));
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_active_slot_check"
CHECK (("status" IN ('ACTIVE', 'SUSPENDED') AND "activeConversationId" IS NOT NULL AND "activeConversationId" = "conversationId" AND "endedAt" IS NULL)
    OR ("status" IN ('CLOSED', 'EXPIRED') AND "activeConversationId" IS NULL AND "endedAt" IS NOT NULL));
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_authority_check" CHECK ("authority" IN ('CHATBOT', 'HUMAN'));
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_revision_check" CHECK ("revision" >= 0);
ALTER TABLE "ChatbotSession" ADD CONSTRAINT "ChatbotSession_campaign_pair_check"
CHECK (("campaignId" IS NULL) = ("campaignRecipientId" IS NULL));
ALTER TABLE "ChatbotEvent" ADD CONSTRAINT "ChatbotEvent_attempts_check"
CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 5 AND "attempts" <= "maxAttempts");
ALTER TABLE "ChatbotEvent" ADD CONSTRAINT "ChatbotEvent_status_check"
CHECK ("status" IN ('PENDING', 'PROCESSING', 'PROCESSED', 'ERROR', 'DEAD'));
ALTER TABLE "ChatbotOutbox" ADD CONSTRAINT "ChatbotOutbox_attempts_check"
CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 5 AND "attempts" <= "maxAttempts");
ALTER TABLE "ChatbotOutbox" ADD CONSTRAINT "ChatbotOutbox_status_check"
CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'UNCERTAIN', 'FAILED', 'CANCELED'));

CREATE FUNCTION qevora_chatbot_published_version_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published chatbot versions are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ChatbotFlowVersion_immutable"
BEFORE UPDATE OR DELETE ON "ChatbotFlowVersion"
FOR EACH ROW EXECUTE FUNCTION qevora_chatbot_published_version_immutable();
