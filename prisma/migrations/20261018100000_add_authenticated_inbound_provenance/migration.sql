-- Additive evidence only. Existing events remain NULL/NULL; no historical inference.
ALTER TABLE "ConversationInboundEvent" ADD COLUMN "provenanceKind" TEXT;
ALTER TABLE "ConversationInboundEvent" ADD COLUMN "provenanceVersion" INTEGER;
ALTER TABLE "ConversationInboundEvent" ADD CONSTRAINT "InboundEvent_provenance_check" CHECK (
  ("provenanceKind" IS NULL AND "provenanceVersion" IS NULL)
  OR ("provenanceKind" IS NOT NULL AND "provenanceVersion" IS NOT NULL
    AND "provenanceKind" = 'META_WEBHOOK_HMAC_SHA256_VERIFIED'
    AND "provenanceVersion" = 1 AND "channelId" IS NOT NULL)
);
CREATE FUNCTION "check_inbound_provenance"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."provenanceKind" IS DISTINCT FROM NEW."provenanceKind"
      OR OLD."provenanceVersion" IS DISTINCT FROM NEW."provenanceVersion"
      OR (OLD."provenanceKind" IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'IMMUTABLE_INBOUND_PROVENANCE';
    END IF;
  END IF;
  IF NEW."provenanceKind" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Message" m WHERE m.id = NEW."messageId" AND m."conversationId" = NEW."conversationId"
      AND m.direction = 'inbound' AND m."providerMessageId" IS NOT NULL
      AND length(btrim(m."providerMessageId")) > 0
      AND m."metaReplySnapshot" IS NOT NULL AND length(m."metaReplySnapshot") > 0
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_INBOUND_PROVENANCE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConversationInboundEvent_provenance_guard" BEFORE INSERT OR UPDATE ON "ConversationInboundEvent"
  FOR EACH ROW EXECUTE FUNCTION "check_inbound_provenance"();
-- Preserve authenticated content/binding, not operational status/readAt/conflict.
CREATE FUNCTION "preserve_verified_inbound_message"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ConversationInboundEvent" e WHERE e."messageId" = OLD.id AND e."provenanceKind" IS NOT NULL)
    AND ROW(NEW.id, NEW."conversationId", NEW.direction, NEW."providerMessageId", NEW.body, NEW.type,
      NEW."mediaId", NEW."mediaUrl", NEW."fileName", NEW."mimeType", NEW."replyToProviderMessageId", NEW."replyToMessageId",
      NEW."metaReplySnapshot", NEW."senderType", NEW."createdAt", NEW."templateName", NEW."templateLanguage", NEW."templateVariables",
      NEW."replyPreviewType", NEW."replyPreviewBody", NEW."replyPreviewFileName")
    IS DISTINCT FROM ROW(OLD.id, OLD."conversationId", OLD.direction, OLD."providerMessageId", OLD.body, OLD.type,
      OLD."mediaId", OLD."mediaUrl", OLD."fileName", OLD."mimeType", OLD."replyToProviderMessageId", OLD."replyToMessageId",
      OLD."metaReplySnapshot", OLD."senderType", OLD."createdAt", OLD."templateName", OLD."templateLanguage", OLD."templateVariables",
      OLD."replyPreviewType", OLD."replyPreviewBody", OLD."replyPreviewFileName") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'IMMUTABLE_VERIFIED_INBOUND_MESSAGE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Message_verified_inbound_guard" BEFORE UPDATE ON "Message"
  FOR EACH ROW EXECUTE FUNCTION "preserve_verified_inbound_message"();
