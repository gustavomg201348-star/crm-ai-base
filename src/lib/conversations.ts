import type { Prisma } from "@prisma/client";

export type ConversationStatus = "OPEN" | "PENDING" | "BOT" | "SOLD" | "RESOLVED";

export const conversationInclude = {
  contact: {
    include: {
      owner: true,
      origin: true,
      stage: true,
      tags: { include: { tag: true } }
    }
  },
  agent: true,
  messages: {
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.ConversationInclude;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export function mapConversation(conversation: ConversationWithRelations) {
  const lastMessage = conversation.messages.at(-1);

  return {
    id: conversation.id,
    status: conversation.status as ConversationStatus,
    channel: conversation.channel,
    summary: conversation.summary,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    agent: conversation.agent
      ? {
          id: conversation.agent.id,
          name: conversation.agent.name,
          email: conversation.agent.email
        }
      : null,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phone: conversation.contact.phone,
      email: conversation.contact.email,
      cpf: conversation.contact.cpf,
      origin: conversation.contact.origin?.name ?? "Sem origem",
      stage: conversation.contact.stage?.name ?? "Sem etapa",
      temperature: conversation.contact.temperature,
      owner: conversation.contact.owner?.name ?? "Sem responsavel",
      lastMessage: conversation.contact.lastMessage,
      tags: conversation.contact.tags.map((item) => ({
        id: item.tag.id,
        name: item.tag.name,
        color: item.tag.color
      }))
    },
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          direction: lastMessage.direction,
          body: lastMessage.body,
          createdAt: lastMessage.createdAt,
          type: lastMessage.type,
          fileName: lastMessage.fileName,
          mimeType: lastMessage.mimeType,
          templateName: lastMessage.templateName,
          status: lastMessage.status
        }
      : null,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      createdAt: message.createdAt,
      type: message.type,
      mediaUrl: message.mediaUrl,
      mediaId: message.mediaId,
      fileName: message.fileName,
      mimeType: message.mimeType,
      templateName: message.templateName,
      templateLanguage: message.templateLanguage,
      templateVariables: message.templateVariables,
      status: message.status,
      providerMessageId: message.providerMessageId
    }))
  };
}
