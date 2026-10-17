import type { Prisma, PrismaClient } from "@prisma/client";
import { createReplySnapshot, readReplySnapshot, replyFingerprint, replyContentDigest, type CaptureMetaReplyInput } from "./meta-reply-snapshot";
import { replyProvider, replyTransaction, type ReplyProvider } from "./meta-reply-storage";
import { createInboundMessageWithDurableEvent, inboundEventTransaction, InboundEventError } from "./conversation-inbound-event";

export class ReplyEvidencePersistenceError extends Error {
  constructor() { super("REPLY_EVIDENCE_RETRY_REQUIRED"); }
}
type Evidence = Omit<CaptureMetaReplyInput, "conversationId" | "providerMessageId" | "contentDigest"> & { contactId: string };

// Message, original evidence, sequence and event share one transaction.
export function persistInboundMessage(db: Pick<PrismaClient, "$transaction">, data: Prisma.MessageUncheckedCreateInput, evidence: Evidence | undefined, companyId: string, provenance?: unknown) {
  if (evidence && evidence.companyId !== companyId) return Promise.reject(new InboundEventError("INVALID_SCOPE"));
  const metaReplySnapshot = evidence && data.providerMessageId
    ? createReplySnapshot({ ...evidence, conversationId: data.conversationId, providerMessageId: data.providerMessageId, contentDigest: replyContentDigest(data) })
    : undefined;
  return inboundEventTransaction(db, tx => createInboundMessageWithDurableEvent(tx, companyId, { ...data, metaReplySnapshot },
    evidence ? { contactId: evidence.contactId, channelId: evidence.channelId } : undefined, provenance));
}

/** Both initial lookup and P2002 recovery must pass this same fail-closed check. */
export async function validateAuthenticatedInboundReplay(db: PrismaClient, existing: { id: string },
  input: import("./meta-inbound-provenance").MetaInboundInput, provenance: unknown) {
  const security = await import("./meta-inbound-provenance");
  input = security.assertMetaInboundCapability(provenance, input);
  const message = await db.message.findFirst({ where: { id: existing.id, conversation: { contact: { companyId: input.companyId } } }, include: {
    inboundEvent: true, conversation: { include: { contact: { select: { companyId: true } } } },
  } });
  if (!message) throw new security.InboundProvenanceError("REPLAY_SCOPE");
  if (!message.inboundEvent || message.inboundEvent.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED"
    || message.inboundEvent.provenanceVersion !== 1 || !message.metaReplySnapshot) throw new security.InboundProvenanceError("REPLAY_UNPROVEN");
  const event = message.inboundEvent;
  if (event.companyId !== input.companyId || event.channelId !== input.channelId || event.messageId !== message.id
    || event.conversationId !== message.conversationId || event.contactId !== message.conversation.contactId
    || message.conversation.contact.companyId !== input.companyId || message.conversation.channelId !== input.channelId
    || message.providerMessageId !== input.providerMessageId || message.direction !== "inbound") throw new security.InboundProvenanceError("REPLAY_SCOPE");
  if (message.metaReplyConflictSnapshot) throw new security.InboundProvenanceError("REPLAY_CONFLICT");
  try {
    security.provenanceForInboundPersistence(provenance, input.companyId, message, {
      contactId: event.contactId, channelId: event.channelId,
    });
  } catch {
    await preserveReplyReplay(db, message, { companyId: input.companyId, channelId: input.channelId,
      conversationId: message.conversationId, contactId: event.contactId, providerMessageId: input.providerMessageId,
      senderPhone: input.phone, contextProviderMessageId: input.contextProviderMessageId,
      metadata: input.replyMetadata, contentDigest: replyContentDigest({ body: input.body.trim(), type: input.type,
        mediaId: input.mediaId, fileName: input.fileName, mimeType: input.mimeType }) });
    throw new security.InboundProvenanceError("REPLAY_CONFLICT");
  }
}

export async function preserveReplyReplay(
  db: PrismaClient,
  existing: { id: string; conversationId: string; metaReplySnapshot: string | null; metaReplyConflictSnapshot: string | null },
  input: CaptureMetaReplyInput & { contactId: string },
  provider?: ReplyProvider
) {
  if (!existing.metaReplySnapshot || existing.metaReplyConflictSnapshot) return;
  try {
    const original = readReplySnapshot(existing.metaReplySnapshot);
    const replay = createReplySnapshot(input);
    if (replyFingerprint(original) === replyFingerprint(readReplySnapshot(replay))) return;
    if (original.companyId !== input.companyId || original.channelId !== input.channelId || original.conversationId !== input.conversationId) throw new ReplyEvidencePersistenceError();
    await replyTransaction(db, provider ?? replyProvider(), async (tx) => {
      const changed = await tx.message.updateMany({
        where: { id: existing.id, conversationId: input.conversationId, metaReplySnapshot: existing.metaReplySnapshot, metaReplyConflictSnapshot: null,
          conversation: { channelId: input.channelId, contact: { companyId: input.companyId } } },
        data: { metaReplyConflictSnapshot: replay }
      });
      if (changed.count) await tx.chatbotReplyCorrelation.updateMany({
        where: { companyId: input.companyId, channelId: input.channelId, inboundMessageId: existing.id },
        data: { status: "CONFLICT", reason: "REPLAY_CONFLICT" }
      });
      else {
        const alreadyStored = await tx.message.findFirst({
          where: { id: existing.id, metaReplySnapshot: existing.metaReplySnapshot, metaReplyConflictSnapshot: { not: null },
            conversation: { channelId: input.channelId, contact: { companyId: input.companyId } } }, select: { id: true }
        });
        if (!alreadyStored) throw new ReplyEvidencePersistenceError();
      }
    }, true);
  } catch { throw new ReplyEvidencePersistenceError(); }
}
