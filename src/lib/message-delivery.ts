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
  const readAt = normalizedStatus === "read" ? new Date() : undefined;

  const updated = await prisma.message.updateMany({
    where: { providerMessageId },
    data: {
      status: normalizedStatus,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      ...(readAt ? { readAt } : {})
    }
  });

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

  return prisma.message.create({
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
      status: "failed",
      errorMessage
    }
  });
}
