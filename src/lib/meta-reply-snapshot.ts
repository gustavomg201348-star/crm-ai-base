import { createHash } from "node:crypto";
import { digitsOnlyPhone, normalizeBrazilianPhoneForIdentity } from "./phone-normalization.service";
import type { MetaReplyMetadata } from "./meta-reply-metadata";

export type ReplyScope = { companyId: string; channelId: string };
export type CaptureMetaReplyInput = ReplyScope & {
  conversationId: string; contactId?: string; providerMessageId: string;
  contextProviderMessageId?: string | null; senderPhone: string; metadata: MetaReplyMetadata;
  contentDigest: string;
};
export type ReplySnapshot = ReplyScope & {
  version: 1; conversationId: string; contactId: string; providerMessageId: string;
  contextProviderMessageId: string | null; senderIdentityHash: string;
  contentDigest: string;
  metadata: Omit<MetaReplyMetadata, "sourceTimestamp"> & { sourceTimestamp: string | null };
};
export const MAX_REPLY_SNAPSHOT_BYTES = 24576;
export function replyContentDigest(input: { body: string; type?: string | null; mediaId?: string | null; fileName?: string | null; mimeType?: string | null }) {
  return createHash("sha256").update(JSON.stringify([input.body, input.type ?? "text", input.mediaId ?? null, input.fileName ?? null, input.mimeType ?? null])).digest("hex");
}

export function requireReplyId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) throw new Error("INVALID_REPLY_SCOPE");
}
export function requireReplyScope(input: ReplyScope) {
  requireReplyId(input?.companyId); requireReplyId(input?.channelId);
}
export function replyPhoneHash(scope: ReplyScope, phone: string) {
  requireReplyScope(scope);
  requireReplyId(phone);
  const normalized = normalizeBrazilianPhoneForIdentity(phone).normalizedPhone ?? digitsOnlyPhone(phone);
  if (!normalized) throw new Error("INVALID_REPLY_SENDER");
  return createHash("sha256").update(JSON.stringify([scope.companyId, scope.channelId, normalized])).digest("hex");
}
export function replyFingerprint(snapshot: ReplySnapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}
export function validateReplyMetadata(value: MetaReplyMetadata): MetaReplyMetadata {
  if (!value || !["TEMPLATE_BUTTON", "INTERACTIVE_BUTTON", "INTERACTIVE_LIST", "TEXT", "OTHER"].includes(value.interactionType)
    || !["PROVIDER_ID", "TITLE_ONLY", "MISSING", "NOT_APPLICABLE"].includes(value.optionIdentity)
    || !Array.isArray(value.limitations) || value.limitations.length > 5
    || value.limitations.some((item) => !["MISSING_OPTION_ID", "MISSING_OPTION_TITLE", "MISSING_SOURCE_TIMESTAMP", "INVALID_SOURCE_TIMESTAMP", "UNSUPPORTED_INTERACTION"].includes(item))) throw new Error("INVALID_REPLY_METADATA");
  for (const [field, limit] of [[value.optionId, 2048], [value.optionTitle, 1024], [value.timestampRaw, 32]] as const) {
    if (field !== null && (typeof field !== "string" || !field.trim() || field.length > limit)) throw new Error("INVALID_REPLY_METADATA");
  }
  if (value.sourceTimestamp !== null && (!(value.sourceTimestamp instanceof Date) || !Number.isFinite(value.sourceTimestamp.getTime()))) throw new Error("INVALID_REPLY_METADATA");
  const option = ["TEMPLATE_BUTTON", "INTERACTIVE_BUTTON", "INTERACTIVE_LIST"].includes(value.interactionType);
  const identity = !option ? "NOT_APPLICABLE" : value.optionId ? "PROVIDER_ID" : value.optionTitle ? "TITLE_ONLY" : "MISSING";
  if (identity !== value.optionIdentity || (!option && (value.optionId !== null || value.optionTitle !== null))) throw new Error("INVALID_REPLY_METADATA");
  return { ...value, sourceTimestamp: value.sourceTimestamp ? new Date(value.sourceTimestamp) : null, limitations: [...value.limitations] };
}
export function createReplySnapshot(input: CaptureMetaReplyInput & { contactId: string }): string {
  requireReplyScope(input);
  for (const id of [input.contactId, input.conversationId, input.providerMessageId]) requireReplyId(id);
  if (input.contextProviderMessageId !== null && input.contextProviderMessageId !== undefined) requireReplyId(input.contextProviderMessageId);
  const metadata = validateReplyMetadata(input.metadata);
  if (typeof input.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.contentDigest)) throw new Error("INVALID_REPLY_CONTENT_DIGEST");
  const snapshot: ReplySnapshot = {
    version: 1, companyId: input.companyId, channelId: input.channelId, conversationId: input.conversationId,
    contactId: input.contactId, providerMessageId: input.providerMessageId,
    contextProviderMessageId: input.contextProviderMessageId ?? null, senderIdentityHash: replyPhoneHash(input, input.senderPhone), contentDigest: input.contentDigest,
    metadata: { ...metadata, sourceTimestamp: metadata.sourceTimestamp?.toISOString() ?? null }
  };
  const encoded = JSON.stringify(snapshot);
  if (Buffer.byteLength(encoded) > MAX_REPLY_SNAPSHOT_BYTES) throw new Error("REPLY_SNAPSHOT_TOO_LARGE");
  return encoded;
}
export function readReplySnapshot(encoded: string): ReplySnapshot {
  if (typeof encoded !== "string" || Buffer.byteLength(encoded) > MAX_REPLY_SNAPSHOT_BYTES) throw new Error("INVALID_REPLY_SNAPSHOT");
  const parsed = JSON.parse(encoded) as ReplySnapshot;
  requireReplyScope(parsed);
  for (const id of [parsed.contactId, parsed.conversationId, parsed.providerMessageId]) requireReplyId(id);
  if (parsed.version !== 1 || typeof parsed.senderIdentityHash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.senderIdentityHash)) throw new Error("INVALID_REPLY_SNAPSHOT");
  if (typeof parsed.contentDigest !== "string" || !/^[a-f0-9]{64}$/.test(parsed.contentDigest)) throw new Error("INVALID_REPLY_CONTENT_DIGEST");
  if (parsed.contextProviderMessageId !== null) requireReplyId(parsed.contextProviderMessageId);
  const metadata = validateReplyMetadata({ ...parsed.metadata, sourceTimestamp: parsed.metadata?.sourceTimestamp === null ? null : new Date(parsed.metadata?.sourceTimestamp) });
  const canonical: ReplySnapshot = {
    version: 1, companyId: parsed.companyId, channelId: parsed.channelId, conversationId: parsed.conversationId,
    contactId: parsed.contactId, providerMessageId: parsed.providerMessageId, contextProviderMessageId: parsed.contextProviderMessageId,
    senderIdentityHash: parsed.senderIdentityHash, contentDigest: parsed.contentDigest, metadata: { ...metadata, sourceTimestamp: metadata.sourceTimestamp?.toISOString() ?? null }
  };
  return canonical;
}
