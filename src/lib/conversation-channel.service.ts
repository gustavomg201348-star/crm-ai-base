export const LEGACY_WHATSAPP_CHANNEL = "whatsapp";
export const WHATSAPP_CHANNEL_PREFIX = "whatsapp:";

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
    OR: [{ channelId: normalized }, { channel }]
  };
}
