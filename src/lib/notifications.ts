import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const notificationInclude = {
  contact: true,
  conversation: true
} satisfies Prisma.NotificationInclude;

export type NotificationWithRelations = Prisma.NotificationGetPayload<{
  include: typeof notificationInclude;
}>;

function previewMessage(message: string) {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

export function mapNotification(notification: NotificationWithRelations) {
  return {
    id: notification.id,
    conversationId: notification.conversationId,
    contactId: notification.contactId,
    customerName: notification.contact?.name ?? null,
    phone: notification.contact?.phone ?? null,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    channelId: notification.channelId,
    channelLabel: notification.channelLabel,
    readAt: notification.readAt,
    createdAt: notification.createdAt
  };
}

export async function createInboundMessageNotification({
  companyId,
  userId,
  conversationId,
  contactId,
  channelId,
  customerName,
  phone,
  message,
  channelLabel
}: {
  companyId: string;
  userId?: string | null;
  conversationId: string;
  contactId: string;
  channelId?: string | null;
  customerName: string;
  phone: string;
  message: string;
  channelLabel?: string | null;
}) {
  const messagePreview = previewMessage(message);

  return prisma.notification.create({
    data: {
      companyId,
      userId: userId ?? null,
      conversationId,
      contactId,
      channelId: channelId ?? null,
      title: `Nova mensagem de ${customerName || phone}`,
      message: messagePreview,
      type: "NEW_INBOUND_MESSAGE",
      channelLabel: channelLabel ?? null
    },
    include: notificationInclude
  });
}
