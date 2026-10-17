import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { parseMetaWebhookMessages } from "./meta-whatsapp";
import { resolveVerifiedMetaWebhookChannel } from "./webhook-channel-secrets";
import { createReplySnapshot, replyContentDigest, requireReplyId } from "./meta-reply-snapshot";
import type { MetaReplyMetadata } from "./meta-reply-metadata";

declare const capabilityBrand: unique symbol;
export type MetaInboundCapability = { readonly [capabilityBrand]: never };
export type MetaInboundInput = Readonly<{
  companyId: string; channelId: string; phone: string; body: string;
  name?: string | null; type?: string | null; mediaId?: string | null;
  fileName?: string | null; mimeType?: string | null; providerMessageId: string;
  contextProviderMessageId?: string | null; replyMetadata: MetaReplyMetadata;
}>;
const issued = new WeakMap<object, { input: MetaInboundInput; fingerprint: string }>();
export class InboundProvenanceError extends Error {
  constructor(readonly code: "INVALID_CAPABILITY" | "INVALID_ITEM" | "CHANNEL_REJECTED" | "REPLAY_UNPROVEN" | "REPLAY_SCOPE" | "REPLAY_CONFLICT") {
    super("INBOUND_PROVENANCE_" + code); this.name = "InboundProvenanceError";
    this.stack = this.name + ": " + this.message;
  }
}
function fingerprint(value: MetaInboundInput) {
  return JSON.stringify([value.companyId, value.channelId, value.phone, value.body, value.name ?? null,
    value.type ?? null, value.mediaId ?? null, value.fileName ?? null, value.mimeType ?? null,
    value.providerMessageId, value.contextProviderMessageId ?? null, value.replyMetadata]);
}
function record(capability: unknown) {
  const entry = capability && typeof capability === "object" ? issued.get(capability) : undefined;
  if (!entry) throw new InboundProvenanceError("INVALID_CAPABILITY");
  return entry;
}
export function assertMetaInboundCapability(capability: unknown, input: MetaInboundInput) {
  const entry = record(capability);
  if (fingerprint(input) !== entry.fingerprint) throw new InboundProvenanceError("INVALID_CAPABILITY");
  return structuredClone(entry.input);
}

/** No issuer is exported. Every item is parsed from these exact authenticated bytes. */
export async function authenticateMetaInboundBatch({ db, rawBody, signature }: {
  db: Pick<PrismaClient, "channel">; rawBody: string; signature?: string | null;
}) {
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { throw new InboundProvenanceError("INVALID_ITEM"); }
  let messages: ReturnType<typeof parseMetaWebhookMessages>;
  try { messages = parseMetaWebhookMessages(payload); } catch { throw new InboundProvenanceError("INVALID_ITEM"); }
  // The legacy parser skips malformed items: a verified batch must not silently drop them.
  const entries = (payload as { entry?: Array<{ changes?: Array<{ value?: { messages?: unknown[] } }> }> })?.entry;
  let rawCount: number;
  try {
    rawCount = (entries ?? []).reduce((sum, entry) => sum + (entry.changes ?? []).reduce((n, change) => {
      const items = change.value?.messages;
      if (items !== undefined && !Array.isArray(items)) throw new InboundProvenanceError("INVALID_ITEM");
      return n + (items?.length ?? 0);
    }, 0), 0);
  } catch { throw new InboundProvenanceError("INVALID_ITEM"); }
  if (rawCount !== messages.length) throw new InboundProvenanceError("INVALID_ITEM");
  const result: Array<{ input: MetaInboundInput; capability: MetaInboundCapability; phoneNumberId: string }> = [];
  for (const message of messages) {
    if (typeof message.messageId !== "string" || !message.messageId.trim() || message.messageId.length > 2048
      || typeof message.from !== "string" || !/\d/.test(message.from) || typeof message.body !== "string" || !message.body.trim()
      || [message.phoneNumberId, message.messageId, message.from, message.body, message.name, message.type,
        message.mediaId, message.fileName, message.mimeType, message.contextMessageId]
        .some(value => value != null && (typeof value !== "string" || value.includes("\u0000")
          || Buffer.from(value, "utf8").toString("utf8") !== value))) {
      throw new InboundProvenanceError("INVALID_ITEM");
    }
    const verified = await resolveVerifiedMetaWebhookChannel({ db, phoneNumberId: message.phoneNumberId, rawBody, signature });
    if (!verified.ok) throw new InboundProvenanceError("CHANNEL_REJECTED");
    try {
      if (message.contextMessageId != null) requireReplyId(message.contextMessageId);
      // Reserve the existing validator's maximum Contact/Conversation ID lengths.
      // Metadata, sender and snapshot size must fail before ANY batch write, not at INSERT.
      createReplySnapshot({ ...verified.channel, channelId: verified.channel.id,
        conversationId: "x".repeat(2048), contactId: "x".repeat(2048), providerMessageId: message.messageId,
        contextProviderMessageId: message.contextMessageId, senderPhone: message.from,
        metadata: message.replyMetadata, contentDigest: replyContentDigest({ body: message.body.trim(), type: message.type,
          mediaId: message.mediaId, fileName: message.fileName, mimeType: message.mimeType }) });
    } catch { throw new InboundProvenanceError("INVALID_ITEM"); }
    const input: MetaInboundInput = {
      companyId: verified.channel.companyId, channelId: verified.channel.id,
      phone: message.from, body: message.body, name: message.name, type: message.type,
      mediaId: message.mediaId, fileName: message.fileName, mimeType: message.mimeType,
      providerMessageId: message.messageId, contextProviderMessageId: message.contextMessageId, replyMetadata: message.replyMetadata,
    };
    // Keep an independent private copy; mutation of the returned item cannot change its authority.
    const captured = structuredClone(input);
    const capability = Object.freeze(Object.defineProperty(Object.create(null), "toJSON", {
      value: () => { throw new InboundProvenanceError("INVALID_CAPABILITY"); },
    })) as MetaInboundCapability;
    issued.set(capability, { input: captured, fingerprint: fingerprint(captured) });
    result.push({ input, capability, phoneNumberId: message.phoneNumberId });
  }
  return result;
}

/** Called before allocation. No caller-selected provenance fields reach persistence. */
export function provenanceForInboundPersistence(capability: unknown, companyId: string,
  data: Pick<Prisma.MessageUncheckedCreateInput, "conversationId" | "direction" | "body" | "providerMessageId" | "type" | "mediaId" | "mediaUrl" | "fileName" | "mimeType" | "replyToProviderMessageId" | "metaReplySnapshot">,
  binding?: Readonly<{ contactId: string; channelId: string | null }>) {
  const { input } = record(capability);
  if (!binding || companyId !== input.companyId || binding.channelId !== input.channelId || data.direction !== "inbound"
    || data.providerMessageId !== input.providerMessageId || data.body !== input.body.trim()
    || (data.type ?? "text") !== (input.type ?? "text") || (data.mediaId ?? null) !== (input.mediaId ?? null)
    || (data.fileName ?? null) !== (input.fileName ?? null) || (data.mimeType ?? null) !== (input.mimeType ?? null)
    || (data.mediaUrl ?? null) !== null || (data.replyToProviderMessageId ?? null) !== (input.contextProviderMessageId?.trim() || null)) {
    throw new InboundProvenanceError("INVALID_CAPABILITY");
  }
  const expected = createReplySnapshot({ companyId, channelId: input.channelId, contactId: binding.contactId,
    conversationId: data.conversationId, providerMessageId: input.providerMessageId,
    senderPhone: input.phone, contextProviderMessageId: input.contextProviderMessageId,
    metadata: input.replyMetadata, contentDigest: replyContentDigest(data) });
  if (data.metaReplySnapshot !== expected) throw new InboundProvenanceError("INVALID_CAPABILITY");
  return { provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 } as const;
}
