import type { Conversation } from "@prisma/client";
import {
  conversationMatchesChannel,
  LEGACY_WHATSAPP_CHANNEL
} from "@/lib/conversation-channel.service";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { findOrCreateConversationForChannel } from "@/lib/conversation-lifecycle.service";
import { prisma } from "@/lib/db";
import { maybeSendAutomaticAiReply } from "@/lib/ai-attendant.service";
import { maybeAutoAssignConversation } from "@/lib/lead-assignment";
import { publishInboundNotification } from "@/lib/notification-stream";
import { createInboundMessageNotification, mapNotification } from "@/lib/notifications";
import { createActivity } from "@/lib/activities";
import {
  formatContactDisplayName,
  findContactByNormalizedPhone,
  getAutomaticContactNameUpdate,
  logContactNameMutationAttempt,
  normalizeContactPhone
} from "@/lib/contacts";

export async function processInboundMessage({
  companyId,
  channelId,
  name,
  phone,
  body,
  type,
  mediaId,
  fileName,
  mimeType,
  providerMessageId,
  contextProviderMessageId
}: {
  companyId: string;
  channelId?: string | null;
  name?: string | null;
  phone: string;
  body: string;
  type?: string | null;
  mediaId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  providerMessageId?: string | null;
  contextProviderMessageId?: string | null;
}) {
  const normalizedPhone = normalizeContactPhone(phone);
  const messageBody = body.trim();

  if (!normalizedPhone || !messageBody) {
    throw new Error("Mensagem invalida.");
  }

  if (providerMessageId) {
    const existingMessage = await prisma.message.findFirst({
      where: {
        providerMessageId,
        conversation: { contact: { companyId } }
      },
      include: {
        conversation: { include: conversationInclude }
      }
    });

    if (existingMessage) {
      return mapConversation(existingMessage.conversation);
    }
  }

  const referencedMessage = contextProviderMessageId
    ? await prisma.message.findFirst({
        where: {
          providerMessageId: contextProviderMessageId,
          conversation: { contact: { companyId } }
        },
        include: {
          conversation: { include: conversationInclude }
        }
      })
    : null;
  const referencedPhoneMatched = referencedMessage
    ? phonesMatch(referencedMessage.conversation.contact.phone, normalizedPhone)
    : false;
  const referencedChannelMatched = referencedMessage
    ? !channelId || conversationMatchesChannel(referencedMessage.conversation, channelId)
    : false;

  const [origin, stage] = await Promise.all([
    prisma.origin.findFirst({
      where: { companyId, name: "WhatsApp" }
    }),
    prisma.pipelineStage.findFirst({
      where: { companyId },
      orderBy: { position: "asc" }
    })
  ]);

  let contact =
    referencedMessage && referencedPhoneMatched
      ? referencedMessage.conversation.contact
      : await findContactByNormalizedPhone(prisma, {
          companyId,
          phone: normalizedPhone,
          archived: true
        });

  console.warn("[whatsapp-inbound-audit]", {
    rawPhone: phone,
    normalizedPhone,
    contactId: contact?.id ?? null,
    conversationId: referencedMessage?.conversationId ?? null,
    referencedProviderMessageId: contextProviderMessageId ?? null,
    referencedMessageFound: Boolean(referencedMessage),
    referencedPhoneMatched,
    oldName: contact?.name ?? null,
    incomingWhatsappName: name?.trim() || null,
    cpfBefore: contact?.cpf ?? null,
    messageType: type ?? "text"
  });

  if (!contact) {
    logContactNameMutationAttempt({
      origin: "webhook",
      file: "src/lib/inbound-message.ts",
      functionName: "processInboundMessage",
      contactId: null,
      phone: normalizedPhone,
      oldName: null,
      newName: name?.trim() || normalizedPhone,
      reason: "criacao de contato por mensagem inbound",
      allowed: true
    });

    contact = await prisma.contact.create({
      data: {
        companyId,
        name: name?.trim().replace(/\s+/g, " ") || normalizedPhone,
        phone: normalizedPhone,
        originId: origin?.id ?? null,
        stageId: stage?.id ?? null,
        temperature: "WARM",
        lastMessage: messageBody
      }
    });
  } else {
    const nameUpdate = getAutomaticContactNameUpdate({
      currentName: contact.name,
      incomingName: name,
      phone: normalizedPhone
    });

    logContactNameMutationAttempt({
      origin: "webhook",
      file: "src/lib/inbound-message.ts",
      functionName: "processInboundMessage",
      contactId: contact.id,
      phone: contact.phone,
      oldName: contact.name,
      newName: nameUpdate?.nextName ?? name?.trim() ?? contact.name,
      reason: nameUpdate
        ? "contato sem nome real recebeu nome do WhatsApp"
        : "nome automatico bloqueado porque contato ja possui nome salvo",
      allowed: Boolean(nameUpdate)
    });

    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: {
        ...(nameUpdate ? { name: nameUpdate.nextName } : {}),
        lastMessage: messageBody,
        archivedAt: null
      }
    });

    if (nameUpdate) {
      await createActivity(prisma, {
        contactId: contact.id,
        type: "CONTACT_NAME_AUTO_FILLED",
        title: "Nome preenchido automaticamente",
        detail: `Origem: webhook WhatsApp. Antes: ${nameUpdate.previousName ?? "(vazio)"}. Depois: ${nameUpdate.nextName}.`
      });
    }
  }

  let conversation: Conversation | null =
    referencedMessage && referencedPhoneMatched && referencedChannelMatched
      ? referencedMessage.conversation
      : null;
  let conversationCreated = false;

  if (!conversation && channelId) {
    const result = await findOrCreateConversationForChannel({
      db: prisma,
      companyId,
      contactId: contact.id,
      channelId,
      status: "PENDING",
      statuses: ["OPEN", "PENDING", "BOT", "SOLD"],
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" }
      ],
      withCreated: true
    });
    conversation = result.conversation;
    conversationCreated = result.created;
  }

  if (!conversation && !channelId) {
    conversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        status: { not: "RESOLVED" }
      },
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" }
      ]
    });
  }

  if (!conversation && !channelId) {
    conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        status: "PENDING",
        channel: LEGACY_WHATSAPP_CHANNEL
      }
    });
    conversationCreated = true;
  }

  if (!conversation) {
    throw new Error("Nao foi possivel resolver conversa inbound.");
  }

  if (conversationCreated) {
    await maybeAutoAssignConversation({
      companyId,
      conversationId: conversation.id
    });
  }

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: "inbound",
      senderType: "customer",
      body: messageBody,
      type: type ?? "text",
      mediaId: mediaId ?? null,
      fileName: fileName ?? null,
      mimeType: mimeType ?? null,
      providerMessageId: providerMessageId ?? null
    }
  });

  const receivedAt = new Date();
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      unreadCount: { increment: 1 },
      lastMessageAt: receivedAt,
      lastMessagePreview: messageBody,
      lastInboundMessageAt: receivedAt,
      status: "PENDING",
      updatedAt: receivedAt
    },
    include: conversationInclude
  });

  console.warn("[whatsapp-inbound-audit-result]", {
    rawPhone: phone,
    normalizedPhone,
    contactId: updated.contact.id,
    conversationId: updated.id,
    oldName: contact.name,
    finalName: updated.contact.name,
    incomingWhatsappName: name?.trim() || null,
    cpfBefore: contact.cpf ?? null,
    cpfAfter: updated.contact.cpf ?? null,
    messageType: type ?? "text",
    status: updated.status
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
    customerName: formatContactDisplayName(updated.contact.name),
    phone: updated.contact.phone,
    message: messageBody,
    channelLabel: channel?.displayPhone ?? channel?.name ?? updated.channel
  });

  publishInboundNotification({
    companyId,
    userId: updated.agent?.id ?? null,
    notification: mapNotification(notification)
  });

  void maybeSendAutomaticAiReply({
    companyId,
    conversationId: updated.id
  }).catch((error) => {
    console.error("Falha ao enviar resposta automatica IA", error);
  });

  return mapConversation(updated);
}

function phonesMatch(storedPhone?: string | null, incomingPhone?: string | null) {
  const stored = normalizeContactPhone(storedPhone);
  const incoming = normalizeContactPhone(incomingPhone);

  if (!stored || !incoming) return false;
  if (stored === incoming) return true;

  const storedWithoutCountryCode =
    stored.startsWith("55") && stored.length > 11 ? stored.slice(2) : stored;
  const incomingWithoutCountryCode =
    incoming.startsWith("55") && incoming.length > 11 ? incoming.slice(2) : incoming;

  return storedWithoutCountryCode === incomingWithoutCountryCode;
}
