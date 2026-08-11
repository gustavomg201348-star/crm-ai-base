import type { Contact, Conversation, Message } from "@prisma/client";

export type InboundContextResolutionReason =
  | "NO_CONTEXT"
  | "MISSING_CHANNEL_ID"
  | "REFERENCED_MESSAGE_NOT_FOUND"
  | "REFERENCED_MESSAGE_NOT_OUTBOUND"
  | "COMPANY_MISMATCH"
  | "REFERENCED_CONVERSATION_WITHOUT_CHANNEL"
  | "CHANNEL_MISMATCH"
  | "PHONE_MISMATCH"
  | "MATCHED";

type ReferencedMessage = Pick<Message, "direction"> & {
  conversation: Pick<Conversation, "channelId"> & {
    contact: Pick<Contact, "companyId">;
  };
};

export function resolveInboundContextReference({
  companyId,
  channelId,
  contextProviderMessageId,
  referencedMessage,
  phoneMatched
}: {
  companyId: string;
  channelId?: string | null;
  contextProviderMessageId?: string | null;
  referencedMessage?: ReferencedMessage | null;
  phoneMatched: boolean;
}): { reusable: boolean; reason: InboundContextResolutionReason } {
  if (!contextProviderMessageId?.trim()) {
    return { reusable: false, reason: "NO_CONTEXT" };
  }

  const normalizedChannelId = channelId?.trim();
  if (!normalizedChannelId) {
    return { reusable: false, reason: "MISSING_CHANNEL_ID" };
  }

  if (!referencedMessage) {
    return { reusable: false, reason: "REFERENCED_MESSAGE_NOT_FOUND" };
  }

  if (referencedMessage.direction !== "outbound") {
    return { reusable: false, reason: "REFERENCED_MESSAGE_NOT_OUTBOUND" };
  }

  if (referencedMessage.conversation.contact.companyId !== companyId) {
    return { reusable: false, reason: "COMPANY_MISMATCH" };
  }

  const referencedChannelId = referencedMessage.conversation.channelId?.trim();
  if (!referencedChannelId) {
    return { reusable: false, reason: "REFERENCED_CONVERSATION_WITHOUT_CHANNEL" };
  }

  if (referencedChannelId !== normalizedChannelId) {
    return { reusable: false, reason: "CHANNEL_MISMATCH" };
  }

  if (!phoneMatched) {
    return { reusable: false, reason: "PHONE_MISMATCH" };
  }

  return { reusable: true, reason: "MATCHED" };
}
