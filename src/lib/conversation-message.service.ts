import type { Prisma } from "@prisma/client";
import { createActivity } from "@/lib/activities";
import { resolveChannelAccessToken } from "@/lib/channel-secrets";
import { resolveConversationChannelId } from "@/lib/conversation-channel.service";
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
    accessToken: string;
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

  const channelId = resolveConversationChannelId(conversation);

  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, companyId, type: "whatsapp", provider: "meta" }
      })
    : await prisma.channel.findMany({
        where: {
          companyId,
          type: "whatsapp",
          provider: "meta",
          status: { in: ["ACTIVE", "CONNECTED"] }
        },
        take: 2
      });

  if (!channelId && Array.isArray(channel) && channel.length > 1) {
    throw new Error(
      "Esta conversa nao possui canal WhatsApp definido. Defina o canal antes de enviar."
    );
  }

  const resolvedChannel = Array.isArray(channel) ? channel[0] : channel;

  if (!channel) throw new Error("Integração WhatsApp nao encontrada para esta conversa.");
  if (!resolvedChannel) throw new Error("Integracao WhatsApp nao encontrada para esta conversa.");
  if (resolvedChannel.provider !== "meta") throw new Error("A conversa nao esta vinculada a um canal Meta.");
  const accessToken = resolveChannelAccessToken(resolvedChannel.accessToken, {
    channelId: resolvedChannel.id
  });

  if (!resolvedChannel.phoneNumberId || !accessToken) {
    throw new Error("Canal Meta sem Phone Number ID ou token.");
  }

  return { conversation, channel: { ...resolvedChannel, accessToken } };
}

export async function saveOutboundMessage({
  conversationId,
  userId,
  body,
  type = "text",
  mediaId,
  mediaUrl,
  fileName,
  mimeType,
  templateName,
  templateLanguage,
  templateVariables,
  providerMessageId,
  status = "sent",
  senderType = "agent"
}: {
  conversationId: string;
  userId?: string;
  body: string;
  type?: string;
  mediaId?: string | null;
  mediaUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  templateVariables?: string | null;
  providerMessageId?: string | null;
  status?: string;
  senderType?: string;
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
        senderType,
        body,
        type,
        mediaId,
        mediaUrl,
        fileName,
        mimeType,
        templateName,
        templateLanguage,
        templateVariables,
        providerMessageId,
        status
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
        ...(userId && !conversation.agentId
          ? { agent: { connect: { id: userId } } }
          : {}),
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
