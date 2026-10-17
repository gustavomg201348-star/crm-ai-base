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
CREATE TRIGGER IF NOT EXISTS InboundEvent_provenance_insert
BEFORE INSERT ON ConversationInboundEvent BEGIN
  SELECT RAISE(ABORT, 'INVALID_INBOUND_PROVENANCE') WHERE NOT (
    (NEW.provenanceKind IS NULL AND NEW.provenanceVersion IS NULL)
    OR (NEW.provenanceKind IS NOT NULL AND NEW.provenanceVersion IS NOT NULL
      AND NEW.provenanceKind = 'META_WEBHOOK_HMAC_SHA256_VERIFIED' AND NEW.provenanceVersion = 1
      AND NEW.channelId IS NOT NULL)
  );
  SELECT RAISE(ABORT, 'INVALID_INBOUND_PROVENANCE') WHERE NEW.provenanceKind IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM Message m WHERE m.id = NEW.messageId AND m.conversationId = NEW.conversationId
      AND m.direction = 'inbound' AND m.providerMessageId IS NOT NULL AND length(trim(m.providerMessageId)) > 0
      AND m.metaReplySnapshot IS NOT NULL AND length(m.metaReplySnapshot) > 0
  );
END;
-- statement
CREATE TRIGGER IF NOT EXISTS InboundEvent_provenance_update
BEFORE UPDATE ON ConversationInboundEvent BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_INBOUND_PROVENANCE') WHERE
    OLD.provenanceKind IS NOT NEW.provenanceKind OR OLD.provenanceVersion IS NOT NEW.provenanceVersion
    OR (OLD.provenanceKind IS NOT NULL AND (
      OLD.id IS NOT NEW.id OR OLD.companyId IS NOT NEW.companyId OR OLD.contactId IS NOT NEW.contactId
      OR OLD.channelId IS NOT NEW.channelId OR OLD.conversationId IS NOT NEW.conversationId
      OR OLD.messageId IS NOT NEW.messageId OR OLD.sequence IS NOT NEW.sequence OR OLD.createdAt IS NOT NEW.createdAt
    ));
END;
-- statement
CREATE TRIGGER IF NOT EXISTS Message_verified_inbound_guard
BEFORE UPDATE ON Message WHEN EXISTS (
  SELECT 1 FROM ConversationInboundEvent e WHERE e.messageId = OLD.id AND e.provenanceKind IS NOT NULL
) BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_VERIFIED_INBOUND_MESSAGE') WHERE
    OLD.id IS NOT NEW.id OR OLD.conversationId IS NOT NEW.conversationId OR OLD.direction IS NOT NEW.direction
    OR OLD.providerMessageId IS NOT NEW.providerMessageId OR OLD.body IS NOT NEW.body OR OLD.type IS NOT NEW.type
    OR OLD.mediaId IS NOT NEW.mediaId OR OLD.mediaUrl IS NOT NEW.mediaUrl OR OLD.fileName IS NOT NEW.fileName
    OR OLD.mimeType IS NOT NEW.mimeType OR OLD.replyToProviderMessageId IS NOT NEW.replyToProviderMessageId
    OR OLD.replyToMessageId IS NOT NEW.replyToMessageId OR OLD.metaReplySnapshot IS NOT NEW.metaReplySnapshot
    OR OLD.senderType IS NOT NEW.senderType OR OLD.createdAt IS NOT NEW.createdAt OR OLD.templateName IS NOT NEW.templateName
    OR OLD.templateLanguage IS NOT NEW.templateLanguage OR OLD.templateVariables IS NOT NEW.templateVariables
    OR OLD.replyPreviewType IS NOT NEW.replyPreviewType OR OLD.replyPreviewBody IS NOT NEW.replyPreviewBody
    OR OLD.replyPreviewFileName IS NOT NEW.replyPreviewFileName;
  SELECT RAISE(ABORT, 'IMMUTABLE_REPLY_CONFLICT') WHERE OLD.metaReplyConflictSnapshot IS NOT NULL
    AND OLD.metaReplyConflictSnapshot IS NOT NEW.metaReplyConflictSnapshot;
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
