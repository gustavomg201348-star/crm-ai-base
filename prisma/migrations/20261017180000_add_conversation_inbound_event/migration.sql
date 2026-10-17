-- Additive capture only: no DML, historical Message backfill or processing state.
ALTER TABLE "Conversation" ADD COLUMN "inboundEventSequence" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_inbound_sequence_check" CHECK ("inboundEventSequence" >= 0);
CREATE UNIQUE INDEX "Conversation_id_contactId_key" ON "Conversation"("id", "contactId");

CREATE TABLE "ConversationInboundEvent" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channelId" TEXT,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "sequence" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationInboundEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InboundEvent_positive_sequence" CHECK ("sequence" > 0),
  CONSTRAINT "InboundEvent_company_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "InboundEvent_contact_fkey" FOREIGN KEY ("companyId","contactId") REFERENCES "Contact"("companyId","id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "InboundEvent_channel_fkey" FOREIGN KEY ("companyId","channelId") REFERENCES "Channel"("companyId","id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "InboundEvent_conversation_fkey" FOREIGN KEY ("conversationId","contactId") REFERENCES "Conversation"("id","contactId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "InboundEvent_channel_conversation_fkey" FOREIGN KEY ("conversationId","contactId","channelId") REFERENCES "Conversation"("id","contactId","channelId") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "InboundEvent_message_fkey" FOREIGN KEY ("messageId","conversationId") REFERENCES "Message"("id","conversationId") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "InboundEvent_message_key" ON "ConversationInboundEvent"("messageId");
-- Redundant logically, required by Prisma for the composite one-to-one relation.
CREATE UNIQUE INDEX "InboundEvent_message_conversation_key" ON "ConversationInboundEvent"("messageId","conversationId");
CREATE UNIQUE INDEX "InboundEvent_conversation_sequence_key" ON "ConversationInboundEvent"("conversationId","sequence");
CREATE INDEX "InboundEvent_scope_created_idx" ON "ConversationInboundEvent"("companyId","channelId","createdAt");

-- MATCH SIMPLE skips nullable FKs. Check exact nullable channel and inbound direction.
CREATE FUNCTION "check_conversation_inbound_event_scope"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Conversation" c JOIN "Contact" p ON p.id = c."contactId"
      JOIN "Message" m ON m.id = NEW."messageId" AND m."conversationId" = c.id
    WHERE c.id = NEW."conversationId" AND c."contactId" = NEW."contactId"
      AND p."companyId" = NEW."companyId"
      AND c."channelId" IS NOT DISTINCT FROM NEW."channelId"
      AND m.direction = 'inbound' AND NEW.sequence > 0
      AND NEW.sequence <= c."inboundEventSequence"
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INBOUND_EVENT_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConversationInboundEvent_scope_guard"
  BEFORE INSERT OR UPDATE ON "ConversationInboundEvent"
  FOR EACH ROW EXECUTE FUNCTION "check_conversation_inbound_event_scope"();

CREATE FUNCTION "preserve_inbound_event_message"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ConversationInboundEvent" e WHERE e."messageId" = OLD.id)
     AND (NEW.direction <> 'inbound' OR NEW."conversationId" <> OLD."conversationId") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INBOUND_EVENT_MESSAGE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Message_inbound_event_guard" BEFORE UPDATE OF direction, "conversationId" ON "Message"
  FOR EACH ROW EXECUTE FUNCTION "preserve_inbound_event_message"();
