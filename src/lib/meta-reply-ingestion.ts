import type { Prisma, PrismaClient } from "@prisma/client";
import { createReplySnapshot, readReplySnapshot, replyFingerprint, replyContentDigest, type CaptureMetaReplyInput } from "./meta-reply-snapshot";
import { replyProvider, replyTransaction, type ReplyProvider } from "./meta-reply-storage";
import { createInboundMessageWithDurableEvent, inboundEventTransaction, InboundEventError } from "./conversation-inbound-event";

export class ReplyEvidencePersistenceError extends Error {
  constructor() { super("REPLY_EVIDENCE_RETRY_REQUIRED"); }
}
type Evidence = Omit<CaptureMetaReplyInput, "conversationId" | "providerMessageId" | "contentDigest"> & { contactId: string };

// Message, original evidence, sequence and event share one transaction.
export function persistInboundMessage(db: Pick<PrismaClient, "$transaction">, data: Prisma.MessageUncheckedCreateInput, evidence: Evidence | undefined, companyId: string) {
  if (evidence && evidence.companyId !== companyId) return Promise.reject(new InboundEventError("INVALID_SCOPE"));
  const metaReplySnapshot = evidence && data.providerMessageId
    ? createReplySnapshot({ ...evidence, conversationId: data.conversationId, providerMessageId: data.providerMessageId, contentDigest: replyContentDigest(data) })
    : undefined;
  return inboundEventTransaction(db, tx => createInboundMessageWithDurableEvent(tx, companyId, { ...data, metaReplySnapshot },
    evidence ? { contactId: evidence.contactId, channelId: evidence.channelId } : undefined));
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
