ALTER TABLE "ChatbotSession" ADD COLUMN "runtimeState" TEXT,
  ADD COLUMN "runtimeActorId" TEXT, ADD COLUMN "lastPromptKey" TEXT;
ALTER TABLE "ChatbotEvent" ADD COLUMN "inboundSequence" BIGINT;
ALTER TABLE "CltChatbotCampaignBinding" ADD COLUMN "enabledAt" TIMESTAMP(3), ADD COLUMN "activatedByUserId" TEXT;
UPDATE "CltChatbotCampaignBinding" SET "enabled" = false WHERE "enabled" AND "enabledAt" IS NULL;
CREATE INDEX "ChatbotSession_campaign_recipient_idx" ON "ChatbotSession"("companyId","channelId","campaignId","campaignRecipientId");
CREATE INDEX "OutboundOperation_origin_status_created_idx" ON "OutboundOperation"("origin","status","createdAt");

ALTER TABLE "ConversationAuthority" DROP CONSTRAINT "authority_state_check", ADD CONSTRAINT "authority_state_check"
  CHECK ("state" IN ('HUMAN_QUEUE','HUMAN','AI','CLOSED','CHATBOT') AND ("state" <> 'CHATBOT' OR "generation" > 0));
ALTER TABLE "OutboundOperation" DROP CONSTRAINT "outbound_origin_check", ADD CONSTRAINT "outbound_origin_check"
  CHECK ("origin" IN ('HUMAN','AI','CAMPAIGN','CHATBOT') AND (("origin" IN ('AI','CHATBOT')) = ("actorUserId" IS NULL)));

CREATE OR REPLACE FUNCTION qevora_authority_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."id",NEW."companyId",NEW."channelId",NEW."conversationId",NEW."contactId",NEW."createdAt",NEW."policyVersion")
     IS DISTINCT FROM ROW(OLD."id",OLD."companyId",OLD."channelId",OLD."conversationId",OLD."contactId",OLD."createdAt",OLD."policyVersion") THEN
    RAISE EXCEPTION 'AUTHORITY_SCOPE_IMMUTABLE'; END IF;
  IF NOT (CASE OLD."state"
    WHEN 'HUMAN_QUEUE' THEN NEW."state" IN ('HUMAN_QUEUE','HUMAN','AI','CLOSED','CHATBOT')
    WHEN 'CHATBOT' THEN NEW."state" IN ('HUMAN','HUMAN_QUEUE','CLOSED')
    WHEN 'HUMAN' THEN NEW."state" IN ('HUMAN','HUMAN_QUEUE','AI','CLOSED')
    WHEN 'AI' THEN NEW."state" IN ('AI','HUMAN','HUMAN_QUEUE','CLOSED')
    WHEN 'CLOSED' THEN NEW."state" IN ('CLOSED','HUMAN_QUEUE','HUMAN')
    ELSE FALSE END) THEN RAISE EXCEPTION 'AUTHORITY_INVALID_TRANSITION'; END IF;
  IF NEW."state" = 'CHATBOT' AND NOT EXISTS (
    SELECT 1 FROM "ChatbotSession" s WHERE s."companyId" = NEW."companyId" AND s."channelId" = NEW."channelId"
      AND s."activeConversationId" = NEW."conversationId" AND s."runtimeActorId" IS NOT NULL AND s."status" = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'AUTHORITY_CHATBOT_SESSION_REQUIRED'; END IF;
  IF ROW(NEW."state",NEW."ownerUserId",NEW."policyVersion") IS DISTINCT FROM ROW(OLD."state",OLD."ownerUserId",OLD."policyVersion") THEN
    IF OLD."generation" = 9223372036854775807 OR NEW."generation" <> OLD."generation" + 1 THEN
      RAISE EXCEPTION 'AUTHORITY_GENERATION_CONFLICT'; END IF;
  ELSIF NEW."generation" <> OLD."generation" THEN RAISE EXCEPTION 'AUTHORITY_GENERATION_CONFLICT'; END IF;
  RETURN NEW;
END $$;
