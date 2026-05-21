import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";

export type ConversationIntegration = {
  conversation: Prisma.ConversationGetPayload<{
    include: { contact: true };
  }>;
  channel: {
    id: string;
    name: string;
    provider: string;
    phoneNumberId: string | null;
    wabaId: string | null;
    accessToken: string | null;
  };
};

export async function getConversationIntegration({
  conversationId,
  companyId
}: {
  conversationId: string;
  companyId: string;
}): Promise<ConversationIntegration> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } },
    include: { contact: true }
  });

  if (!conversation) throw new Error("Conversa nao encontrada.");

  const channelId = conversation.channel.startsWith("whatsapp:")
    ? conversation.channel.replace("whatsapp:", "")
    : null;

  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, companyId, type: "whatsapp" }
      })
    : await prisma.channel.findFirst({
        where: { companyId, type: "whatsapp", provider: "meta", status: "ACTIVE" },
        orderBy: { updatedAt: "desc" }
      });

  if (!channel) throw new Error("Integração WhatsApp nao encontrada para esta conversa.");
  if (channel.provider !== "meta") throw new Error("A conversa nao esta vinculada a um canal Meta.");
  if (!channel.phoneNumberId || !channel.accessToken) {
    throw new Error("Canal Meta sem Phone Number ID ou token.");
  }

  return { conversation, channel };
}

export async function saveOutboundMessage({
  conversationId,
  userId,
  body,
  type = "text",
  mediaId,
  fileName,
  mimeType,
  templateName,
  templateLanguage,
  templateVariables,
  providerMessageId,
  status = "sent"
}: {
  conversationId: string;
  userId?: string;
  body: string;
  type?: string;
  mediaId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateVariables?: string | null;
  providerMessageId?: string | null;
  status?: string;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { contact: true }
    });

    await tx.message.create({
      data: {
        conversationId,
        direction: "outbound",
        senderType: "agent",
        body,
        type,
        mediaId,
        fileName,
        mimeType,
        templateName,
        templateLanguage,
        templateVariables,
        providerMessageId,
        status,
        readAt: new Date()
      }
    });

    await createActivity(tx, {
      contactId: conversation.contactId,
      userId,
      type: "MESSAGE_SENT",
      title: "Mensagem enviada",
      detail: body
    });

    const sentAt = new Date();

    return tx.conversation.update({
      where: { id: conversationId },
      data: {
        status: conversation.status === "PENDING" ? "OPEN" : conversation.status,
        unreadCount: 0,
        lastReadAt: sentAt,
        lastMessageAt: sentAt,
        lastMessagePreview: body,
        updatedAt: sentAt,
        contact: { update: { lastMessage: body } }
      },
      include: conversationInclude
    });
  });

  return mapConversation(updated);
}
