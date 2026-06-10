import { prisma } from "@/lib/db";

const statusMap: Record<string, string> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
  deleted: "failed",
  warning: "failed"
};

export function normalizeDeliveryStatus(status: string) {
  return statusMap[status.toLowerCase()] ?? status.toLowerCase();
}

export async function updateMessageDeliveryStatus({
  providerMessageId,
  status,
  errorMessage
}: {
  providerMessageId: string;
  status: string;
  errorMessage?: string | null;
}) {
  const normalizedStatus = normalizeDeliveryStatus(status);
  const statusAt = new Date();
  const failedMessages = normalizedStatus === "failed" && errorMessage
    ? await prisma.message.findMany({
        where: { providerMessageId },
        select: { id: true, body: true }
      })
    : [];

  const updated = await prisma.message.updateMany({
    where: { providerMessageId },
    data: {
      status: normalizedStatus,
      ...(normalizedStatus === "read" ? { readAt: statusAt } : {})
    }
  });

  if (failedMessages.length) {
    await Promise.all(
      failedMessages
        .filter((message) => !message.body.includes("Falha:"))
        .map((message) =>
          prisma.message.update({
            where: { id: message.id },
            data: { body: `${message.body}\n\nFalha: ${errorMessage}`.trim() }
          })
        )
    );
  }

  return updated.count;
}

export async function saveFailedOutboundMessage({
  conversationId,
  body,
  type = "text",
  errorMessage,
  fileName,
  mimeType,
  templateName,
  templateLanguage
}: {
  conversationId: string;
  body: string;
  type?: string;
  errorMessage: string;
  fileName?: string | null;
  mimeType?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
}) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, contactId: true }
  });

  if (!conversation) return null;

  const detail = `${body}\n\nFalha: ${errorMessage}`.trim();
  const failedAt = new Date();

  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        conversationId,
        direction: "outbound",
        senderType: "agent",
        body: detail,
        type,
        fileName,
        mimeType,
        templateName,
        templateLanguage,
        status: "failed"
      }
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: failedAt,
        lastMessagePreview: detail,
        updatedAt: failedAt,
        contact: { update: { lastMessage: detail } }
      }
    });

    return message;
  });
}
