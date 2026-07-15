import { NextResponse, type NextRequest } from "next/server";
import type { Contact, Conversation } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { conversationMatchesChannel } from "@/lib/conversation-channel.service";
import { findOrCreateConversationForChannel } from "@/lib/conversation-lifecycle.service";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import {
  findContactByNormalizedPhone,
  getContactNormalizedPhone,
  logContactNameMutationAttempt,
  normalizeContactPhone
} from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { saveFailedOutboundMessage } from "@/lib/message-delivery";
import { readMetaMessageId, sendMetaTextMessage } from "@/lib/meta-whatsapp";
import { canAccessConversation } from "@/lib/permissions";
import {
  isPrismaUniqueViolation,
  isPrismaUniqueViolationForTarget
} from "@/lib/prisma-errors";

type RouteContext = {
  params: { id: string };
};

type ConversationWithContact = Conversation & { contact: Contact };

export async function POST(request: NextRequest, context: RouteContext) {
  let failedConversationId: string | undefined;
  let failedMessageBody: string | undefined;
  let metaAcceptedMessage = false;

  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = context.params;
    const body = (await request.json().catch(() => null)) as
      | { conversationId?: string; to?: string; body?: string }
      | null;
    const message = body?.body?.trim();

    if (!message || !body?.to) {
      return NextResponse.json(
        { error: "Destino e mensagem sao obrigatorios." },
        { status: 400 }
      );
    }

    const channel = await prisma.channel.findFirst({
      where: { id, companyId: session.companyId, type: "whatsapp" }
    });

    if (!channel) {
      return NextResponse.json({ error: "Canal nao encontrado." }, { status: 404 });
    }

    if (channel.provider !== "meta") {
      return NextResponse.json(
        { error: "Envio real exige canal provider=meta." },
        { status: 400 }
      );
    }

    if (!channel.phoneNumberId || !channel.accessToken) {
      return NextResponse.json(
        { error: "Canal sem phoneNumberId ou accessToken." },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizeContactPhone(body.to);
    const contactNormalizedPhone = getContactNormalizedPhone(normalizedPhone);
    let conversation: ConversationWithContact | null = body.conversationId
      ? await prisma.conversation.findFirst({
          where: {
            id: body.conversationId,
            contact: { companyId: session.companyId }
          },
          include: { contact: true }
        })
      : null;

    if (body.conversationId) {
      if (!conversation) {
        return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
      }

      if (!canAccessConversation({ session, agentId: conversation.agentId })) {
        return NextResponse.json(
          { error: "Conversa atribuida a outro atendente." },
          { status: 403 }
        );
      }

      if (!conversationMatchesChannel(conversation, channel.id)) {
        return NextResponse.json(
          { error: "A conversa nao pertence ao canal WhatsApp informado." },
          { status: 409 }
        );
      }

      const conversationPhone = normalizeContactPhone(conversation.contact.phone);
      if (!conversationPhone || conversationPhone !== normalizedPhone) {
        return NextResponse.json(
          { error: "O telefone informado nao corresponde ao contato da conversa." },
          { status: 400 }
        );
      }

      failedConversationId = conversation.id;
      failedMessageBody = message;
    }

    const sent = await sendMetaTextMessage({
      phoneNumberId: channel.phoneNumberId,
      accessToken: channel.accessToken,
      to: conversation
        ? normalizeContactPhone(conversation.contact.phone)
        : normalizedPhone,
      body: message
    });
    const providerMessageId = readMetaMessageId(sent);
    metaAcceptedMessage = true;

    if (!conversation) {
      const [origin, stage] = await Promise.all([
        prisma.origin.findFirst({
          where: { companyId: session.companyId },
          orderBy: { name: "asc" }
        }),
        prisma.pipelineStage.findFirst({
          where: { companyId: session.companyId },
          orderBy: { position: "asc" }
        })
      ]);

      let createdContactForSend = false;
      const existingContact = await findContactByNormalizedPhone(prisma, {
        companyId: session.companyId,
        phone: normalizedPhone
      });
      let contact = existingContact;

      if (!contact) {
        try {
          contact = await prisma.contact.create({
            data: {
              companyId: session.companyId,
              ownerId: session.id,
              originId: origin?.id,
              stageId: stage?.id,
              name: normalizedPhone,
              phone: normalizedPhone,
              normalizedPhone: contactNormalizedPhone,
              temperature: "WARM",
              lastMessage: message
            }
          });
          createdContactForSend = true;
        } catch (error) {
          if (
            isPrismaUniqueViolation(error) &&
            (isPrismaUniqueViolationForTarget(error, "normalizedPhone") ||
              isPrismaUniqueViolationForTarget(error, [
                "companyId",
                "normalizedPhone"
              ]))
          ) {
            contact = await findContactByNormalizedPhone(prisma, {
              companyId: session.companyId,
              phone: normalizedPhone
            });
          }

          if (!contact) {
            throw error;
          }
        }
      }

      if (createdContactForSend) {
        logContactNameMutationAttempt({
          origin: "envio_avulso_canal",
          file: "src/app/api/channels/[id]/messages/route.ts",
          functionName: "POST /api/channels/[id]/messages",
          contactId: contact.id,
          phone: contact.phone,
          oldName: null,
          newName: contact.name,
          reason: "contato criado automaticamente para envio avulso",
          allowed: true
        });
      }

      conversation = (await findOrCreateConversationForChannel({
        db: prisma,
        companyId: session.companyId,
        contactId: contact.id,
        channelId: channel.id,
        agentId: session.id,
        status: "OPEN",
        include: { contact: true }
      })) as ConversationWithContact;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const sentAt = new Date();

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          senderType: "agent",
          body: message,
          type: "text",
          status: "sent",
          providerMessageId
        }
      });

      await createActivity(tx, {
        contactId: conversation.contactId,
        userId: session.id,
        type: "MESSAGE_SENT",
        title: "Mensagem enviada pela Meta",
        detail: message
      });

      return tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status: conversation.status === "PENDING" ? "OPEN" : conversation.status,
          unreadCount: 0,
          lastReadAt: sentAt,
          lastMessageAt: sentAt,
          lastMessagePreview: message,
          updatedAt: sentAt,
          contact: { update: { lastMessage: message } }
        },
        include: conversationInclude
      });
    });

    return NextResponse.json({
      ok: true,
      meta: sent,
      conversation: mapConversation(updated)
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Nao foi possivel enviar mensagem.";

    if (!metaAcceptedMessage && failedConversationId && failedMessageBody) {
      await saveFailedOutboundMessage({
        conversationId: failedConversationId,
        body: failedMessageBody,
        errorMessage
      });
    }

    return NextResponse.json(
      {
        error: errorMessage
      },
      { status: 500 }
    );
  }
}
