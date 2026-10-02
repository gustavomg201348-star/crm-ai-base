import { prisma } from "@/lib/db";
import {
  buildReplySnapshot,
  type PersistedReplyFields,
  type ReplySourceMessage
} from "@/lib/message-reply";

const INVALID_REPLY_MESSAGE =
  "Nao foi possivel responder a mensagem selecionada. Atualize a conversa e tente novamente.";

export class InvalidMessageReplyError extends Error {
  constructor() {
    super(INVALID_REPLY_MESSAGE);
    this.name = "InvalidMessageReplyError";
  }
}

type FindReplySource = (scope: {
  messageId: string;
  companyId: string;
  conversationId: string;
  channelId: string;
}) => Promise<ReplySourceMessage | null>;

const findReplySource: FindReplySource = async ({
  messageId,
  companyId,
  conversationId,
  channelId
}) =>
  prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId,
      conversation: {
        channelId,
        contact: { companyId }
      }
    },
    select: {
      id: true,
      conversationId: true,
      direction: true,
      providerMessageId: true,
      type: true,
      body: true,
      fileName: true,
      conversation: {
        select: {
          channelId: true,
          contact: { select: { companyId: true } }
        }
      }
    }
  });

export type OutboundReplyContext = {
  contextMessageId: string;
  fields: PersistedReplyFields;
};

export async function resolveOutboundReplyContext({
  replyToMessageId,
  companyId,
  conversationId,
  channelId,
  findSource = findReplySource
}: {
  replyToMessageId?: string | null;
  companyId: string;
  conversationId: string;
  channelId?: string | null;
  findSource?: FindReplySource;
}): Promise<OutboundReplyContext | null> {
  const messageId = replyToMessageId?.trim();
  if (!messageId) return null;
  if (!channelId) throw new InvalidMessageReplyError();

  const source = await findSource({
    messageId,
    companyId,
    conversationId,
    channelId
  });
  const providerMessageId = source?.providerMessageId?.trim();
  const valid = Boolean(
    source &&
      providerMessageId &&
      source.conversationId === conversationId &&
      source.conversation.contact.companyId === companyId &&
      source.conversation.channelId === channelId
  );

  if (!valid || !source || !providerMessageId) {
    throw new InvalidMessageReplyError();
  }

  return {
    contextMessageId: providerMessageId,
    fields: {
      replyToMessageId: source.id,
      replyToProviderMessageId: providerMessageId,
      ...buildReplySnapshot(source)
    }
  };
}
