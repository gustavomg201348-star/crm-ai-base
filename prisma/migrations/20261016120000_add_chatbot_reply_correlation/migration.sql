-- CreateTable
ALTER TABLE "Message" ADD COLUMN "metaReplySnapshot" TEXT;
ALTER TABLE "Message" ADD COLUMN "metaReplyConflictSnapshot" TEXT;
CREATE INDEX "Message_reply_snapshot_pending_idx" ON "Message"("conversationId","id") WHERE "metaReplySnapshot" IS NOT NULL;

CREATE TABLE "ChatbotReplyCorrelation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "contextProviderMessageId" TEXT,
    "interactionType" TEXT NOT NULL,
    "optionId" TEXT,
    "optionTitle" TEXT,
    "optionIdentity" TEXT NOT NULL,
    "sourceTimestamp" TIMESTAMP(3),
    "timestampRaw" TEXT,
    "senderIdentityHash" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "limitations" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'NOT_FOUND',
    "reason" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "templateName" TEXT,
    "templateLanguage" TEXT,
    "campaignId" TEXT,
    "campaignRecipientId" TEXT,
    "candidateFlowId" TEXT,
    "candidateVersionId" TEXT,
    "flowCandidateStatus" TEXT NOT NULL DEFAULT 'UNCONFIGURED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "ChatbotReplyCorrelation_pkey" PRIMARY KEY ("id")
);

-- Passive states only: these receipts do not authorize chatbot execution.
ALTER TABLE "ChatbotReplyCorrelation"
  ADD CONSTRAINT "ChatbotReplyCorrelation_status_check"
    CHECK ("status" IN ('CONFIRMED', 'AMBIGUOUS', 'NOT_FOUND', 'CONFLICT')),
  ADD CONSTRAINT "ChatbotReplyCorrelation_interaction_check"
    CHECK ("interactionType" IN ('TEMPLATE_BUTTON', 'INTERACTIVE_BUTTON', 'INTERACTIVE_LIST', 'TEXT', 'OTHER')),
  ADD CONSTRAINT "ChatbotReplyCorrelation_option_identity_check"
    CHECK ("optionIdentity" IN ('PROVIDER_ID', 'TITLE_ONLY', 'MISSING', 'NOT_APPLICABLE')),
  ADD CONSTRAINT "ChatbotReplyCorrelation_campaign_pair_check"
    CHECK (("campaignId" IS NULL) = ("campaignRecipientId" IS NULL)),
  ADD CONSTRAINT "ChatbotReplyCorrelation_confirmed_chain_check"
    CHECK ("status" <> 'CONFIRMED' OR
      ("contextProviderMessageId" IS NOT NULL AND "sourceMessageId" IS NOT NULL AND "campaignId" IS NOT NULL AND "campaignRecipientId" IS NOT NULL AND "confirmedAt" IS NOT NULL)),
  ADD CONSTRAINT "ChatbotReplyCorrelation_candidate_check"
    CHECK (
      ("flowCandidateStatus" IN ('UNCONFIGURED', 'AMBIGUOUS') AND "candidateFlowId" IS NULL AND "candidateVersionId" IS NULL)
      OR ("flowCandidateStatus" = 'IDENTIFIED' AND "candidateFlowId" IS NOT NULL AND "candidateVersionId" IS NOT NULL)
    );

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotReplyCorrelation_inboundMessageId_key" ON "ChatbotReplyCorrelation"("inboundMessageId");

-- CreateIndex
CREATE INDEX "ChatbotReplyCorrelation_companyId_channelId_status_createdA_idx" ON "ChatbotReplyCorrelation"("companyId", "channelId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ChatbotReplyCorrelation_companyId_campaignId_idx" ON "ChatbotReplyCorrelation"("companyId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatbotReplyCorrelation_companyId_channelId_providerMessage_key" ON "ChatbotReplyCorrelation"("companyId", "channelId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_id_conversationId_key" ON "Message"("id", "conversationId");

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_companyId_channelId_fkey" FOREIGN KEY ("companyId", "channelId") REFERENCES "Channel"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_companyId_contactId_fkey" FOREIGN KEY ("companyId", "contactId") REFERENCES "Contact"("companyId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_conversationId_contactId_channelId_fkey" FOREIGN KEY ("conversationId", "contactId", "channelId") REFERENCES "Conversation"("id", "contactId", "channelId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_inboundMessageId_conversationId_fkey" FOREIGN KEY ("inboundMessageId", "conversationId") REFERENCES "Message"("id", "conversationId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_sourceMessageId_conversationId_fkey" FOREIGN KEY ("sourceMessageId", "conversationId") REFERENCES "Message"("id", "conversationId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_companyId_channelId_campaignId_fkey" FOREIGN KEY ("companyId", "channelId", "campaignId") REFERENCES "Campaign"("companyId", "channelId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_campaignId_campaignRecipientId_con_fkey" FOREIGN KEY ("campaignId", "campaignRecipientId", "contactId", "conversationId") REFERENCES "CampaignRecipient"("campaignId", "id", "contactId", "conversationId") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ChatbotReplyCorrelation" ADD CONSTRAINT "ChatbotReplyCorrelation_companyId_candidateFlowId_candidat_fkey" FOREIGN KEY ("companyId", "candidateFlowId", "candidateVersionId") REFERENCES "ChatbotFlowVersion"("companyId", "flowId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

CREATE FUNCTION qevora_reply_evidence_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."confirmedAt" IS NOT NULL THEN
    IF (to_jsonb(OLD) - ARRAY['status','reason','updatedAt']) IS DISTINCT FROM
       (to_jsonb(NEW) - ARRAY['status','reason','updatedAt']) THEN
      RAISE EXCEPTION 'IMMUTABLE_REPLY_EVIDENCE' USING ERRCODE = '23514';
    END IF;
    IF NEW."status" NOT IN ('CONFIRMED','CONFLICT')
       OR (OLD."status" = 'CONFLICT' AND NEW."status" <> 'CONFLICT')
       OR (NEW."status" = 'CONFLICT' AND NEW."reason" <> 'REPLAY_CONFLICT')
       OR (NEW."status" = 'CONFIRMED' AND NEW."reason" <> OLD."reason") THEN
      RAISE EXCEPTION 'INVALID_REPLY_STATE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ChatbotReplyCorrelation_immutable" BEFORE UPDATE ON "ChatbotReplyCorrelation"
FOR EACH ROW EXECUTE FUNCTION qevora_reply_evidence_immutable();

CREATE FUNCTION qevora_reply_snapshot_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."metaReplySnapshot" IS DISTINCT FROM NEW."metaReplySnapshot"
    OR (OLD."metaReplyConflictSnapshot" IS NOT NULL AND OLD."metaReplyConflictSnapshot" IS DISTINCT FROM NEW."metaReplyConflictSnapshot") THEN
    RAISE EXCEPTION 'IMMUTABLE_REPLY_SNAPSHOT' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Message_reply_snapshot_immutable" BEFORE UPDATE ON "Message"
FOR EACH ROW EXECUTE FUNCTION qevora_reply_snapshot_immutable();

CREATE FUNCTION qevora_reply_conflict_quarantine() RETURNS trigger AS $$
BEGIN
  IF OLD."metaReplyConflictSnapshot" IS NULL AND NEW."metaReplyConflictSnapshot" IS NOT NULL THEN
    UPDATE "ChatbotReplyCorrelation" SET "status" = 'CONFLICT', "reason" = 'REPLAY_CONFLICT' WHERE "inboundMessageId" = NEW."id";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Message_reply_conflict" AFTER UPDATE OF "metaReplyConflictSnapshot" ON "Message"
FOR EACH ROW EXECUTE FUNCTION qevora_reply_conflict_quarantine();
