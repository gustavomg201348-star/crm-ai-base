-- Explicit SQLite bootstrap after db push, never executed by application runtime.
-- Mirror the existing PostgreSQL baseline's partial provider-ID uniqueness.
-- Fail closed on preexisting duplicates; never silently delete or rewrite them.
CREATE UNIQUE INDEX IF NOT EXISTS Message_providerMessageId_unique
  ON Message(providerMessageId) WHERE providerMessageId IS NOT NULL;
-- statement
CREATE TRIGGER IF NOT EXISTS ConversationInboundEvent_scope_insert
BEFORE INSERT ON ConversationInboundEvent BEGIN
  SELECT RAISE(ABORT, 'INBOUND_EVENT_SCOPE_MISMATCH') WHERE NOT EXISTS (
    SELECT 1 FROM Conversation c JOIN Contact p ON p.id = c.contactId
      JOIN Message m ON m.id = NEW.messageId AND m.conversationId = c.id
    WHERE c.id = NEW.conversationId AND c.contactId = NEW.contactId AND p.companyId = NEW.companyId
      AND c.channelId IS NEW.channelId AND m.direction = 'inbound'
      AND NEW.sequence > 0 AND NEW.sequence <= c.inboundEventSequence
  );
END;
-- statement
CREATE TRIGGER IF NOT EXISTS ConversationInboundEvent_scope_update
BEFORE UPDATE ON ConversationInboundEvent BEGIN
  SELECT RAISE(ABORT, 'INBOUND_EVENT_SCOPE_MISMATCH') WHERE NOT EXISTS (
    SELECT 1 FROM Conversation c JOIN Contact p ON p.id = c.contactId
      JOIN Message m ON m.id = NEW.messageId AND m.conversationId = c.id
    WHERE c.id = NEW.conversationId AND c.contactId = NEW.contactId AND p.companyId = NEW.companyId
      AND c.channelId IS NEW.channelId AND m.direction = 'inbound'
      AND NEW.sequence > 0 AND NEW.sequence <= c.inboundEventSequence
  );
END;
-- statement
CREATE TRIGGER IF NOT EXISTS Message_inbound_event_guard
BEFORE UPDATE OF direction, conversationId ON Message BEGIN
  SELECT RAISE(ABORT, 'INBOUND_EVENT_MESSAGE_MISMATCH')
    WHERE EXISTS (SELECT 1 FROM ConversationInboundEvent e WHERE e.messageId = OLD.id)
      AND (NEW.direction <> 'inbound' OR NEW.conversationId <> OLD.conversationId);
END;
