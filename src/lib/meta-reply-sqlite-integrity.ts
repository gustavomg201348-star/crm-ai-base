import type { PrismaClient } from "@prisma/client";

export const REPLY_IMMUTABLE_FIELDS = [
  "id", "companyId", "channelId", "conversationId", "contactId", "inboundMessageId", "providerMessageId",
  "contextProviderMessageId", "interactionType", "optionId", "optionTitle", "optionIdentity", "sourceTimestamp",
  "timestampRaw", "senderIdentityHash", "fingerprint", "limitations", "sourceMessageId", "templateName",
  "templateLanguage", "campaignId", "campaignRecipientId", "candidateFlowId", "candidateVersionId",
  "flowCandidateStatus", "createdAt", "confirmedAt"
] as const;
const different = REPLY_IMMUTABLE_FIELDS.map(field => 'OLD."' + field + '" IS NOT NEW."' + field + '"').join(" OR ");
export const REPLY_SQLITE_INTEGRITY = [
  `CREATE TRIGGER IF NOT EXISTS ChatbotReplyCorrelation_immutable BEFORE UPDATE ON ChatbotReplyCorrelation
  WHEN OLD.confirmedAt IS NOT NULL BEGIN
    SELECT RAISE(ABORT, 'IMMUTABLE_REPLY_EVIDENCE') WHERE ${different};
    SELECT RAISE(ABORT, 'INVALID_REPLY_STATE') WHERE NEW.status NOT IN ('CONFIRMED','CONFLICT')
      OR (OLD.status = 'CONFLICT' AND NEW.status <> 'CONFLICT')
      OR (NEW.status = 'CONFLICT' AND NEW.reason <> 'REPLAY_CONFLICT')
      OR (NEW.status = 'CONFIRMED' AND NEW.reason <> OLD.reason);
  END`,
  `CREATE TRIGGER IF NOT EXISTS ChatbotReplyCorrelation_confirmed_insert BEFORE INSERT ON ChatbotReplyCorrelation
  WHEN NEW.status = 'CONFIRMED' AND NEW.confirmedAt IS NULL BEGIN SELECT RAISE(ABORT, 'MISSING_REPLY_CONFIRMATION'); END`,
  `CREATE TRIGGER IF NOT EXISTS ChatbotReplyCorrelation_confirmed_update BEFORE UPDATE ON ChatbotReplyCorrelation
  WHEN NEW.status = 'CONFIRMED' AND NEW.confirmedAt IS NULL BEGIN SELECT RAISE(ABORT, 'MISSING_REPLY_CONFIRMATION'); END`,
  `CREATE TRIGGER IF NOT EXISTS Message_reply_snapshot_immutable BEFORE UPDATE ON Message BEGIN
    SELECT RAISE(ABORT, 'IMMUTABLE_REPLY_SNAPSHOT') WHERE OLD.metaReplySnapshot IS NOT NEW.metaReplySnapshot;
    SELECT RAISE(ABORT, 'IMMUTABLE_REPLY_CONFLICT') WHERE OLD.metaReplyConflictSnapshot IS NOT NULL AND OLD.metaReplyConflictSnapshot IS NOT NEW.metaReplyConflictSnapshot;
  END`,
  `CREATE TRIGGER IF NOT EXISTS Message_reply_conflict AFTER UPDATE OF metaReplyConflictSnapshot ON Message
  WHEN OLD.metaReplyConflictSnapshot IS NULL AND NEW.metaReplyConflictSnapshot IS NOT NULL BEGIN
    UPDATE ChatbotReplyCorrelation SET status = 'CONFLICT', reason = 'REPLAY_CONFLICT' WHERE inboundMessageId = NEW.id;
  END`,
  `CREATE INDEX IF NOT EXISTS Message_reply_snapshot_pending_idx ON Message(conversationId,id) WHERE metaReplySnapshot IS NOT NULL`
];
// Explicit local setup after db push, never called by webhook or processor.
export async function installReplySqliteIntegrity(db: PrismaClient, databaseUrl: string) {
  if (!databaseUrl.startsWith("file:")) throw new Error("SQLITE_DATABASE_REQUIRED");
  for (const sql of REPLY_SQLITE_INTEGRITY) await db.$executeRawUnsafe(sql);
}
