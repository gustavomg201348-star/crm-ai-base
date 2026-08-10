import { conversationMatchesChannel } from "@/lib/conversation-channel.service";

export type ReferencedInboundConversationLike = {
  channel?: string | null;
  channelId?: string | null;
  contact: {
    phone?: string | null;
  };
};

export type ReferencedInboundMessageLike = {
  direction?: string | null;
  conversation: ReferencedInboundConversationLike;
};

function normalizePhoneForComparison(phone?: string | null) {
  return phone?.replace(/\D/g, "") ?? "";
}

export function phonesMatch(storedPhone?: string | null, incomingPhone?: string | null) {
  const stored = normalizePhoneForComparison(storedPhone);
  const incoming = normalizePhoneForComparison(incomingPhone);

  if (!stored || !incoming) return false;
  if (stored === incoming) return true;

  const storedWithoutCountryCode =
    stored.startsWith("55") && stored.length > 11 ? stored.slice(2) : stored;
  const incomingWithoutCountryCode =
    incoming.startsWith("55") && incoming.length > 11 ? incoming.slice(2) : incoming;

  return storedWithoutCountryCode === incomingWithoutCountryCode;
}

export function resolveReferencedInboundConversation({
  conversation,
  channelId,
  incomingPhone
}: {
  conversation?: ReferencedInboundConversationLike | null;
  channelId?: string | null;
  incomingPhone?: string | null;
}) {
  const phoneMatched = conversation
    ? phonesMatch(conversation.contact.phone, incomingPhone)
    : false;
  const channelMatched = Boolean(
    conversation && channelId && conversationMatchesChannel(conversation, channelId)
  );

  return {
    phoneMatched,
    channelMatched,
    shouldUseReferencedConversation: Boolean(conversation && channelMatched)
  };
}

export function resolveReferencedInboundMessage({
  message,
  channelId,
  incomingPhone
}: {
  message?: ReferencedInboundMessageLike | null;
  channelId?: string | null;
  incomingPhone?: string | null;
}) {
  return resolveReferencedInboundConversation({
    conversation: message?.direction === "outbound" ? message.conversation : null,
    channelId,
    incomingPhone
  });
}
