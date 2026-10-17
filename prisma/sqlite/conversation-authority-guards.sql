-- Explicit SQLite bootstrap after db push; Prisma does not install these triggers.
CREATE TRIGGER IF NOT EXISTS outbound_no_delete BEFORE DELETE ON "OutboundOperation"
BEGIN SELECT RAISE(ABORT, 'AUTHORITY_LEDGER_DELETE_FORBIDDEN'); END;
-- statement
CREATE TRIGGER IF NOT EXISTS authority_no_delete BEFORE DELETE ON "ConversationAuthority"
BEGIN SELECT RAISE(ABORT, 'AUTHORITY_LEDGER_DELETE_FORBIDDEN'); END;
-- statement
CREATE TRIGGER IF NOT EXISTS authority_event_no_delete BEFORE DELETE ON "AuthorityEvent"
BEGIN SELECT RAISE(ABORT, 'AUTHORITY_EVENT_APPEND_ONLY'); END;
-- statement
CREATE TRIGGER IF NOT EXISTS authority_event_no_update BEFORE UPDATE ON "AuthorityEvent"
BEGIN SELECT RAISE(ABORT, 'AUTHORITY_EVENT_APPEND_ONLY'); END;
