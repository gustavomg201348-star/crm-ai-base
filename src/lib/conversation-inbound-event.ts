import { Prisma, type PrismaClient } from "@prisma/client";

const MAX_SEQUENCE = BigInt("9223372036854775807");
export class InboundEventError extends Error {
  constructor(readonly code: "INVALID_INBOUND" | "INVALID_SCOPE" | "SEQUENCE_EXHAUSTED") {
    super("CONVERSATION_INBOUND_EVENT_" + code);
    this.name = "InboundEventError";
    this.stack = this.name + ": " + this.message;
  }
}

/** Only DB work may run in this callback; retries never repeat an external effect. */
export async function inboundEventTransaction<T>(
  db: Pick<PrismaClient, "$transaction">,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000,
      });
    } catch (error) {
      const retry = error instanceof Prisma.PrismaClientKnownRequestError
        && (["P2034", "P1008", "P2028"].includes(error.code)
          || (error.code === "P2010" && ["40001", "40P01"].includes(String(error.meta?.code))));
      if (!retry || attempt >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}

/** Must run inside the caller's transaction. No caller-selected channel or event fields. */
export async function createInboundMessageWithDurableEvent(
  tx: Prisma.TransactionClient, companyId: string, data: Prisma.MessageUncheckedCreateInput,
  expectedBinding?: Readonly<{ contactId: string; channelId: string | null }>,
  provenance?: unknown,
) {
  if (Object.keys(data).some(key => !Object.prototype.hasOwnProperty.call(Prisma.MessageScalarFieldEnum, key))) {
    throw new InboundEventError("INVALID_INBOUND");
  }
  // Scalar snapshot prevents nested Message writers and caller mutation across awaits.
  data = structuredClone(data);
  expectedBinding = expectedBinding ? { contactId: expectedBinding.contactId, channelId: expectedBinding.channelId } : undefined;
  const provenanceFields = provenance === undefined ? {} : (await import("./meta-inbound-provenance"))
    .provenanceForInboundPersistence(provenance, companyId, data, expectedBinding);
  if (data.direction !== "inbound") throw new InboundEventError("INVALID_INBOUND");
  if (typeof companyId !== "string" || !companyId || typeof data.conversationId !== "string" || !data.conversationId) {
    throw new InboundEventError("INVALID_SCOPE");
  }
  // Shared SQLite/PostgreSQL SQL. One statement locks, validates and allocates;
  // it deliberately does not change legacy updatedAt/preview/activity timestamps.
  const [conversation] = await tx.$queryRaw<Array<{
    id: string; contactId: string; channelId: string | null; inboundEventSequence: bigint;
  }>>(Prisma.sql`UPDATE "Conversation" SET "inboundEventSequence" = "inboundEventSequence" + 1
    WHERE "id" = ${data.conversationId} AND "inboundEventSequence" >= 0 AND "inboundEventSequence" < ${MAX_SEQUENCE}
      AND EXISTS (SELECT 1 FROM "Contact" p WHERE p.id = "Conversation"."contactId" AND p."companyId" = ${companyId})
      AND ("channelId" IS NULL OR EXISTS (SELECT 1 FROM "Channel" c WHERE c.id = "Conversation"."channelId" AND c."companyId" = ${companyId}))
      ${expectedBinding ? Prisma.sql`AND "contactId" = ${expectedBinding.contactId} AND "channelId" IS NOT DISTINCT FROM ${expectedBinding.channelId}` : Prisma.empty}
    RETURNING "id", "contactId", "channelId", "inboundEventSequence"`);
  if (!conversation) {
    const current = await tx.conversation.findFirst({ where: { id: data.conversationId, contact: { companyId } }, select: { inboundEventSequence: true } });
    if (current && (current.inboundEventSequence < BigInt("0") || current.inboundEventSequence >= MAX_SEQUENCE)) throw new InboundEventError("SEQUENCE_EXHAUSTED");
    throw new InboundEventError("INVALID_SCOPE");
  }
  if (provenance !== undefined && data.replyToMessageId) {
    const referenced = await tx.message.findFirst({ where: { id: data.replyToMessageId,
      conversationId: conversation.id, direction: "outbound", providerMessageId: data.replyToProviderMessageId } });
    if (!referenced) throw new InboundEventError("INVALID_SCOPE");
  }
  const message = await tx.message.create({ data });
  await tx.conversationInboundEvent.create({ data: {
    companyId, contactId: conversation.contactId, channelId: conversation.channelId,
    conversationId: conversation.id, messageId: message.id, sequence: conversation.inboundEventSequence,
    ...provenanceFields,
  } });
  return message;
}
