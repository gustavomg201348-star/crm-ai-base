import { Prisma, type PrismaClient } from "@prisma/client";
import { readReplySnapshot, replyFingerprint, replyPhoneHash, requireReplyId, requireReplyScope, type ReplyScope, type ReplySnapshot } from "./meta-reply-snapshot";
import { replyTransaction, type ReplyProvider } from "./meta-reply-storage";

type Tx = Prisma.TransactionClient;
type Resolution = {
  status: "CONFIRMED" | "AMBIGUOUS" | "NOT_FOUND" | "CONFLICT"; reason: string;
  sourceMessageId?: string; templateName?: string | null; templateLanguage?: string | null;
  campaignId?: string; campaignRecipientId?: string; candidateFlowId?: string; candidateVersionId?: string;
  flowCandidateStatus?: "IDENTIFIED" | "AMBIGUOUS" | "UNCONFIGURED";
};

async function resolve(tx: Tx, input: ReplySnapshot): Promise<Resolution> {
  if (!input.contextProviderMessageId) return { status: "NOT_FOUND", reason: "NO_CONTEXT" };
  const sources = await tx.message.findMany({
    where: { providerMessageId: input.contextProviderMessageId, direction: "outbound",
      conversation: { channelId: input.channelId, contact: { companyId: input.companyId } } }, take: 2
  });
  if (sources.length > 1) return { status: "AMBIGUOUS", reason: "MULTIPLE_SOURCE_MESSAGES" };
  if (!sources.length) return { status: "NOT_FOUND", reason: "SOURCE_NOT_FOUND" };
  const source = sources[0];
  if (source.conversationId !== input.conversationId) return { status: "CONFLICT", reason: "SOURCE_CONVERSATION_MISMATCH" };
  const sourceFields = { sourceMessageId: source.id, templateName: source.templateName, templateLanguage: source.templateLanguage };
  const recipients = await tx.campaignRecipient.findMany({
    where: { providerMessageId: input.contextProviderMessageId, campaign: { companyId: input.companyId, channelId: input.channelId } }, take: 2
  });
  if (recipients.length > 1) return { ...sourceFields, status: "AMBIGUOUS", reason: "MULTIPLE_CAMPAIGN_RECIPIENTS" };
  if (!recipients.length) return { ...sourceFields, status: "NOT_FOUND", reason: "NO_CAMPAIGN" };
  const recipient = recipients[0];
  if (recipient.contactId !== input.contactId || recipient.conversationId !== input.conversationId) return { ...sourceFields, status: "CONFLICT", reason: "RECIPIENT_SCOPE_MISMATCH" };
  let destination: string;
  try { destination = replyPhoneHash(input, recipient.phone); }
  catch { return { ...sourceFields, status: "CONFLICT", reason: "MISSING_DESTINATION_PHONE" }; }
  if (destination !== input.senderIdentityHash) return { ...sourceFields, status: "CONFLICT", reason: "DESTINATION_PHONE_MISMATCH" };
  // A historical version is a candidate only, never permission to resume/execute.
  const versions = await tx.chatbotSession.groupBy({
    by: ["flowId", "flowVersionId"],
    where: { companyId: input.companyId, channelId: input.channelId, contactId: input.contactId,
      conversationId: input.conversationId, campaignId: recipient.campaignId, campaignRecipientId: recipient.id },
    orderBy: [{ flowId: "asc" }, { flowVersionId: "asc" }], take: 2
  });
  return { ...sourceFields, status: "CONFIRMED", reason: "EXACT_PROVIDER_CHAIN",
    campaignId: recipient.campaignId, campaignRecipientId: recipient.id,
    flowCandidateStatus: versions.length > 1 ? "AMBIGUOUS" : versions.length === 1 ? "IDENTIFIED" : "UNCONFIGURED",
    ...(versions.length === 1 ? { candidateFlowId: versions[0].flowId, candidateVersionId: versions[0].flowVersionId } : {}) };
}

export function createMetaReplyCorrelation(db: PrismaClient, options: { provider: ReplyProvider }) {
  if (!options || !["sqlite", "postgresql"].includes(options.provider)) throw new Error("INVALID_REPLY_DATABASE_PROVIDER");
  const provider = options.provider;
  async function transaction<T>(operation: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await replyTransaction(db, provider, operation); }
      catch (error) {
        // One serialization/unique retry only; never retry a timeout or expired transaction.
        if (attempt >= 1 || !(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code)) throw error;
      }
    }
  }

  async function processInTransaction(tx: Tx, input: ReplyScope & { messageId: string }) {
    if (provider === "postgresql") {
      const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT m.id FROM "Message" m
        JOIN "Conversation" c ON c.id = m."conversationId" JOIN "Contact" p ON p.id = c."contactId"
        WHERE m.id = ${input.messageId} AND p."companyId" = ${input.companyId} AND c."channelId" = ${input.channelId}
        FOR UPDATE OF m SKIP LOCKED`);
      if (!locked.length) return null;
    }
    const message = await tx.message.findFirst({
      where: { id: input.messageId, direction: "inbound", senderType: "customer",
        conversation: { channelId: input.channelId, contact: { companyId: input.companyId } } },
      include: { conversation: { select: { contactId: true } } }
    });
    if (!message) return null;
    if (!message.metaReplySnapshot) throw new Error("MISSING_REPLY_SNAPSHOT");
    const snapshot = readReplySnapshot(message.metaReplySnapshot);
    if (snapshot.companyId !== input.companyId || snapshot.channelId !== input.channelId || snapshot.conversationId !== message.conversationId
      || snapshot.contactId !== message.conversation.contactId || snapshot.providerMessageId !== message.providerMessageId) throw new Error("REPLY_SNAPSHOT_SCOPE_MISMATCH");
    const fingerprint = replyFingerprint(snapshot);
    const existing = await tx.chatbotReplyCorrelation.findUnique({
      where: { companyId_channelId_providerMessageId: { companyId: input.companyId, channelId: input.channelId, providerMessageId: snapshot.providerMessageId } }
    });
    const conflict = Boolean(message.metaReplyConflictSnapshot) || Boolean(existing && existing.fingerprint !== fingerprint);
    if (existing && conflict) return tx.chatbotReplyCorrelation.update({ where: { id: existing.id }, data: { status: "CONFLICT", reason: "REPLAY_CONFLICT" } });
    if (existing && existing.status !== "NOT_FOUND") return existing;
    const result = conflict ? { status: "CONFLICT" as const, reason: "REPLAY_CONFLICT" } : await resolve(tx, snapshot);
    const resolved = { ...result, ...(result.status === "CONFIRMED" ? { confirmedAt: new Date() } : {}) };
    if (existing) return tx.chatbotReplyCorrelation.update({ where: { id: existing.id }, data: resolved });
    const { metadata } = snapshot;
    return tx.chatbotReplyCorrelation.create({
      data: { companyId: snapshot.companyId, channelId: snapshot.channelId, conversationId: snapshot.conversationId,
        contactId: snapshot.contactId, providerMessageId: snapshot.providerMessageId, contextProviderMessageId: snapshot.contextProviderMessageId,
        senderIdentityHash: snapshot.senderIdentityHash, ...metadata, sourceTimestamp: metadata.sourceTimestamp ? new Date(metadata.sourceTimestamp) : null,
        limitations: JSON.stringify(metadata.limitations), fingerprint, inboundMessageId: message.id, ...resolved }
    });
  }

  async function processMessage(input: ReplyScope & { messageId: string }) {
    requireReplyScope(input); requireReplyId(input.messageId);
    const selection = { companyId: input.companyId, channelId: input.channelId, messageId: input.messageId };
    return transaction(tx => processInTransaction(tx, selection));
  }

  async function refresh(input: ReplyScope & { id: string }) {
    requireReplyScope(input); requireReplyId(input.id);
    const selection = { companyId: input.companyId, channelId: input.channelId, id: input.id };
    return transaction(async tx => {
      const receipt = await tx.chatbotReplyCorrelation.findFirst({ where: selection });
      if (!receipt || receipt.status !== "NOT_FOUND") return receipt;
      return processInTransaction(tx, { ...selection, messageId: receipt.inboundMessageId });
    });
  }

  async function processBatch(input: ReplyScope & { limit?: number; afterId?: string; reconcile?: boolean; timeBudgetMs?: number }) {
    requireReplyScope(input);
    if (input.afterId !== undefined) requireReplyId(input.afterId);
    const limit = input.limit ?? 20;
    const budget = input.timeBudgetMs ?? 3000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(budget) || budget < 100 || budget > 5000
      || (input.reconcile !== undefined && typeof input.reconcile !== "boolean")) throw new Error("INVALID_REPLY_BATCH");
    const selection = { companyId: input.companyId, channelId: input.channelId };
    const afterId = input.afterId;
    const reconcile = input.reconcile === true;
    const deadline = Date.now() + budget;
    const candidates = await transaction(tx => tx.message.findMany({
      where: { ...(afterId ? { id: { gt: afterId } } : {}), direction: "inbound", senderType: "customer", metaReplySnapshot: { not: null },
        conversation: { channelId: selection.channelId, contact: { companyId: selection.companyId } },
        OR: [{ inboundReplyCorrelations: { none: {} } },
          ...(reconcile ? [{ inboundReplyCorrelations: { some: { status: "NOT_FOUND", reason: { in: ["SOURCE_NOT_FOUND", "NO_CAMPAIGN"] } } } }] : [])] },
      select: { id: true }, orderBy: { id: "asc" }, take: limit + 1
    }));
    const result = { scanned: 0, processed: 0, busy: 0, errors: [] as Array<{ messageId: string; code: string }>, nextCursor: afterId ?? null, hasMore: candidates.length > limit };
    for (const candidate of candidates.slice(0, limit)) {
      if (Date.now() >= deadline) { result.hasMore = true; break; }
      result.scanned++; result.nextCursor = candidate.id;
      try {
        const receipt = await processMessage({ ...selection, messageId: candidate.id });
        if (receipt) result.processed++; else result.busy++;
      } catch {
        result.errors.push({ messageId: candidate.id, code: "REPLY_PROCESSING_FAILED" });
      }
    }
    return result;
  }

  return { processMessage, refresh, processBatch };
}
