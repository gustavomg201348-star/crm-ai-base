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
  tags: {
    include: { tag: true },
    orderBy: { createdAt: "asc" }
  },
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
    aiMode: conversation.aiMode,
    aiPaused: conversation.aiPaused,
    aiLastSuggestion: conversation.aiLastSuggestion,
    unreadCount: conversation.unreadCount,
    lastMessageAt: conversation.lastMessageAt,
    lastMessagePreview: conversation.lastMessagePreview,
    lastInboundMessageAt: conversation.lastInboundMessageAt,
    lastReadAt: conversation.lastReadAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    agent: conversation.agent
      ? {
          id: conversation.agent.id,
          name: conversation.agent.name,
          email: conversation.agent.email,
          role: conversation.agent.role
        }
      : null,
    assignmentStatus: conversation.agentId ? "ASSIGNED" : "UNASSIGNED",
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
    tags: conversation.tags.map((item) => ({
      id: item.tag.id,
      name: item.tag.name,
      color: item.tag.color,
      textColor: item.tag.textColor,
      category: item.tag.category,
      isActive: item.tag.isActive
    })),
    lastMessage: lastMessage
      ? {
          id: lastMessage.id,
          direction: lastMessage.direction,
          body: lastMessage.body,
          createdAt: lastMessage.createdAt,
          type: lastMessage.type,
          mediaUrl: lastMessage.mediaUrl,
          fileName: lastMessage.fileName,
          mimeType: lastMessage.mimeType,
          templateName: lastMessage.templateName,
          status: lastMessage.status,
          readAt: lastMessage.readAt,
          senderType: lastMessage.senderType
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
      providerMessageId: message.providerMessageId,
      readAt: message.readAt,
      senderType: message.senderType
    }))
  };
}
