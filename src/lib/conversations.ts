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

export const conversationListSelect = {
  id: true,
  status: true,
  channel: true,
  summary: true,
  aiMode: true,
  aiPaused: true,
  aiLastSuggestion: true,
  unreadCount: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  lastInboundMessageAt: true,
  lastReadAt: true,
  createdAt: true,
  updatedAt: true,
  agentId: true,
  contact: {
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      cpf: true,
      internalNote: true,
      temperature: true,
      lastMessage: true,
      owner: { select: { name: true } },
      origin: { select: { name: true } },
      stage: { select: { name: true } },
      tags: {
        select: {
          tag: {
            select: {
              id: true,
              name: true,
              color: true
            }
          }
        }
      }
    }
  },
  agent: {
    select: {
      id: true,
      name: true,
      email: true,
      role: true
    }
  },
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
          color: true,
          textColor: true,
          category: true,
          isActive: true
        }
      }
    },
    orderBy: { createdAt: "asc" }
  }
} satisfies Prisma.ConversationSelect;

export type ConversationWithRelations = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export type ConversationListWithRelations = Prisma.ConversationGetPayload<{
  select: typeof conversationListSelect;
}>;

export function mapConversation(conversation: ConversationWithRelations) {
  const lastMessage = conversation.messages.at(-1);
  const effectiveLastMessageAt =
    lastMessage &&
    (!conversation.lastMessageAt ||
      lastMessage.createdAt.getTime() > conversation.lastMessageAt.getTime())
      ? lastMessage.createdAt
      : conversation.lastMessageAt;
  const effectiveLastMessagePreview =
    lastMessage &&
    (!conversation.lastMessagePreview ||
      !conversation.lastMessageAt ||
      lastMessage.createdAt.getTime() >= conversation.lastMessageAt.getTime())
      ? lastMessage.body
      : conversation.lastMessagePreview;

  return {
    id: conversation.id,
    status: conversation.status as ConversationStatus,
    channel: conversation.channel,
    summary: conversation.summary,
    aiMode: conversation.aiMode,
    aiPaused: conversation.aiPaused,
    aiLastSuggestion: conversation.aiLastSuggestion,
    unreadCount: conversation.unreadCount,
    lastMessageAt: effectiveLastMessageAt,
    lastMessagePreview: effectiveLastMessagePreview,
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
      internalNote: conversation.contact.internalNote,
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

export function mapConversationListItem(conversation: ConversationListWithRelations) {
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
      internalNote: conversation.contact.internalNote,
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
    lastMessage: null,
    messages: []
  };
}
