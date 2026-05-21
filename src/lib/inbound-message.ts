import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { publishInboundNotification } from "@/lib/notification-stream";
import { createInboundMessageNotification, mapNotification } from "@/lib/notifications";

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function processInboundMessage({
  companyId,
  channelId,
  name,
  phone,
  body
}: {
  companyId: string;
  channelId?: string | null;
  name?: string | null;
  phone: string;
  body: string;
}) {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone || !body.trim()) {
    throw new Error("Mensagem invalida.");
  }

  const [origin, stage] = await Promise.all([
    prisma.origin.findFirst({
      where: { companyId, name: "WhatsApp" }
    }),
    prisma.pipelineStage.findFirst({
      where: { companyId },
      orderBy: { position: "asc" }
    })
  ]);

  let contact = await prisma.contact.findFirst({
    where: {
      companyId,
      OR: [{ phone }, { phone: normalizedPhone }]
    }
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        companyId,
        name: name?.trim() || normalizedPhone,
        phone: normalizedPhone,
        originId: origin?.id ?? null,
        stageId: stage?.id ?? null,
        temperature: "WARM",
        lastMessage: body.trim()
      }
    });
  } else {
    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        name: contact.name || name?.trim() || normalizedPhone,
        lastMessage: body.trim(),
        archivedAt: null
      }
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      status: { not: "RESOLVED" }
    },
    orderBy: { updatedAt: "desc" }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        status: "PENDING",
        channel: channelId ? `whatsapp:${channelId}` : "whatsapp"
      }
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      body: body.trim()
    }
  });

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      updatedAt: new Date()
    },
    include: conversationInclude
  });

  const channel = channelId
    ? await prisma.channel.findFirst({
        where: { id: channelId, companyId },
        select: { displayPhone: true, name: true }
      })
    : null;

  const notification = await createInboundMessageNotification({
    companyId,
    userId: updated.agent?.id ?? null,
    conversationId: updated.id,
    contactId: updated.contact.id,
    channelId: channelId ?? null,
    customerName: updated.contact.name,
    phone: updated.contact.phone,
    message: body,
    channelLabel: channel?.displayPhone ?? channel?.name ?? updated.channel
  });

  publishInboundNotification({
    companyId,
    userId: updated.agent?.id ?? null,
    notification: mapNotification(notification)
  });

  return mapConversation(updated);
}
