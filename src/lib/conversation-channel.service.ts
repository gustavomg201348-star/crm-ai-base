export const LEGACY_WHATSAPP_CHANNEL = "whatsapp";
export const WHATSAPP_CHANNEL_PREFIX = "whatsapp:";
export const OPEN_CREDIT_CHANNEL_TYPE = "OPEN_CREDIT";
export const OPEN_CREDIT_CHANNEL_PROVIDER = "internal";
export const OPEN_CREDIT_CONVERSATION_CHANNEL = "OPEN_CREDIT";

type ChannelKind = { type?: string | null; provider?: string | null };

// Reserve either marker, including rows that have an inconsistent pair.
export function hasOpenCreditChannelMarker(channel?: ChannelKind | null): boolean {
  return channel?.type === OPEN_CREDIT_CHANNEL_TYPE || channel?.provider === OPEN_CREDIT_CHANNEL_PROVIDER;
}

export const openCreditChannelRef = { select: { type: true, provider: true } } as const;

export function isOpenCreditConversation(conversation: { channel?: string | null; channelRef?: ChannelKind | null }): boolean {
  return conversation.channel === OPEN_CREDIT_CONVERSATION_CHANNEL || hasOpenCreditChannelMarker(conversation.channelRef);
}

export class OpenCreditTransportBlockedError extends Error {
  constructor() {
    super("OPENCREDIT_TRANSPORT_BLOCKED");
    this.name = "OpenCreditTransportBlockedError";
  }
}

export type ConversationChannelLike = {
  channel?: string | null;
  channelId?: string | null;
};

function normalizeChannelId(channelId?: string | null) {
  const normalized = channelId?.trim();
  return normalized ? normalized : null;
}

export function formatConversationChannel(channelId: string): string {
  const normalized = normalizeChannelId(channelId);
  if (!normalized) {
    throw new Error("channelId obrigatorio para formatar canal da conversa.");
  }

  return `${WHATSAPP_CHANNEL_PREFIX}${normalized}`;
}

export function parseLegacyConversationChannel(channel?: string | null): string | null {
  const normalized = channel?.trim();
  if (!normalized || normalized === LEGACY_WHATSAPP_CHANNEL) return null;
  if (!normalized.startsWith(WHATSAPP_CHANNEL_PREFIX)) return null;

  return normalizeChannelId(normalized.slice(WHATSAPP_CHANNEL_PREFIX.length));
}

export function resolveConversationChannelId(
  conversation: ConversationChannelLike
): string | null {
  return normalizeChannelId(conversation.channelId) ?? parseLegacyConversationChannel(conversation.channel);
}

export function conversationMatchesChannel(
  conversation: ConversationChannelLike,
  channelId: string
): boolean {
  const normalized = normalizeChannelId(channelId);
  if (!normalized) return false;

  return resolveConversationChannelId(conversation) === normalized;
}

export function isLegacyGenericWhatsappChannel(channel?: string | null): boolean {
  return channel?.trim() === LEGACY_WHATSAPP_CHANNEL;
}

export function buildConversationChannelWhere(channelId: string) {
  const channel = formatConversationChannel(channelId);
  const normalized = channel.slice(WHATSAPP_CHANNEL_PREFIX.length);

  return {
    OR: [{ channelId: normalized }, { channelId: null, channel }]
  };
}
