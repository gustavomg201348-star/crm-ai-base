export const REPLY_PREVIEW_BODY_MAX_GRAPHEMES = 500;

export type ReplySourceMessage = {
  id: string;
  conversationId: string;
  direction: string;
  providerMessageId?: string | null;
  type?: string | null;
  body?: string | null;
  fileName?: string | null;
  conversation: {
    channelId?: string | null;
    contact: { companyId: string };
  };
};

export type QuotedReply = {
  id: string | null;
  providerMessageId: string | null;
  direction?: string | null;
  type: string | null;
  body: string | null;
  fileName: string | null;
};

export type PersistedReplyFields = {
  replyToMessageId: string | null;
  replyToProviderMessageId: string | null;
  replyPreviewType: string | null;
  replyPreviewBody: string | null;
  replyPreviewFileName: string | null;
};

function splitGraphemes(value: string) {
  const segmenter = new Intl.Segmenter("pt-BR", { granularity: "grapheme" });
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

export function truncateReplyPreviewBody(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const graphemes = splitGraphemes(normalized);
  if (graphemes.length <= REPLY_PREVIEW_BODY_MAX_GRAPHEMES) return normalized;

  return `${graphemes.slice(0, REPLY_PREVIEW_BODY_MAX_GRAPHEMES - 1).join("")}…`;
}

export function buildReplySnapshot(message: {
  type?: string | null;
  body?: string | null;
  fileName?: string | null;
}) {
  const type = message.type?.trim() || "text";
  const body = type === "audio" ? null : truncateReplyPreviewBody(message.body);
  const fileName = message.fileName?.trim() || null;

  return {
    replyPreviewType: type,
    replyPreviewBody: body,
    replyPreviewFileName: fileName
  };
}

export function buildInboundReplyFields({
  contextProviderMessageId,
  referencedMessage,
  companyId,
  conversationId,
  channelId
}: {
  contextProviderMessageId?: string | null;
  referencedMessage?: ReplySourceMessage | null;
  companyId: string;
  conversationId: string;
  channelId?: string | null;
}): PersistedReplyFields {
  const externalId = contextProviderMessageId?.trim() || null;
  const isValidLocalReference = Boolean(
    externalId &&
      referencedMessage &&
      referencedMessage.direction === "outbound" &&
      referencedMessage.providerMessageId === externalId &&
      referencedMessage.conversation.contact.companyId === companyId &&
      referencedMessage.conversationId === conversationId &&
      channelId &&
      referencedMessage.conversation.channelId === channelId
  );

  if (!isValidLocalReference || !referencedMessage) {
    return {
      replyToMessageId: null,
      replyToProviderMessageId: externalId,
      replyPreviewType: null,
      replyPreviewBody: null,
      replyPreviewFileName: null
    };
  }

  return {
    replyToMessageId: referencedMessage.id,
    replyToProviderMessageId: externalId,
    ...buildReplySnapshot(referencedMessage)
  };
}

export function mapQuotedReply(message: {
  conversationId?: string;
  replyToProviderMessageId?: string | null;
  replyPreviewType?: string | null;
  replyPreviewBody?: string | null;
  replyPreviewFileName?: string | null;
  replyTo?: {
    id: string;
    conversationId: string;
    direction?: string | null;
    providerMessageId?: string | null;
    type?: string | null;
    body?: string | null;
    fileName?: string | null;
  } | null;
}): QuotedReply | null {
  const localReply =
    message.replyTo && message.replyTo.conversationId === message.conversationId
      ? message.replyTo
      : null;
  const providerMessageId =
    localReply?.providerMessageId ?? message.replyToProviderMessageId ?? null;
  const hasReply = Boolean(
    localReply ||
      providerMessageId ||
      message.replyPreviewType ||
      message.replyPreviewBody ||
      message.replyPreviewFileName
  );

  if (!hasReply) return null;

  if (localReply) {
    const relationSnapshot = buildReplySnapshot(localReply);

    return {
      id: localReply.id,
      providerMessageId: localReply.providerMessageId ?? providerMessageId,
      ...(localReply.direction ? { direction: localReply.direction } : {}),
      type: relationSnapshot.replyPreviewType,
      body: relationSnapshot.replyPreviewBody,
      fileName: relationSnapshot.replyPreviewFileName
    };
  }

  return {
    id: null,
    providerMessageId,
    type: message.replyPreviewType ?? null,
    body: message.replyPreviewBody ?? null,
    fileName: message.replyPreviewFileName ?? null
  };
}
