import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import {
  getConversationIntegration,
  saveOutboundMessage
} from "@/lib/conversation-message.service";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { readMetaMessageId, sendMetaTextMessage } from "@/lib/meta-whatsapp";
import { canAccessConversation } from "@/lib/permissions";
import { digitsOnlyPhone } from "@/lib/phone-normalization.service";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          body?: string;
          direction?: "inbound" | "outbound";
        }
      | null;

    const messageBody = body?.body?.trim();

    if (!messageBody) {
      return NextResponse.json({ error: "Mensagem vazia." }, { status: 400 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: context.params.id,
        contact: { companyId: session.companyId }
      },
      include: { contact: true }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: conversation.agentId })) {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const direction = body?.direction ?? "outbound";

    if (direction === "outbound") {
      const { conversation: integrationConversation, channel } =
        await getConversationIntegration({
          conversationId: conversation.id,
          companyId: session.companyId
        });
      const sent = await sendMetaTextMessage({
        phoneNumberId: channel.phoneNumberId!,
        accessToken: channel.accessToken!,
        to: digitsOnlyPhone(integrationConversation.contact.phone),
        body: messageBody
      });
      const updated = await saveOutboundMessage({
        conversationId: conversation.id,
        userId: session.id,
        body: messageBody,
        providerMessageId: readMetaMessageId(sent)
      });

      return NextResponse.json({ conversation: updated });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction,
          senderType: "customer",
          body: messageBody,
          type: "text",
          status: "sent",
          readAt: null
        }
      });

      await createActivity(tx, {
        contactId: conversation.contactId,
        userId: session.id,
        type: "MESSAGE_RECEIVED",
        title: "Mensagem recebida",
        detail: messageBody
      });

      return tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status: conversation.status,
          unreadCount: { increment: 1 },
          lastReadAt: conversation.lastReadAt,
          lastMessageAt: now,
          lastMessagePreview: messageBody,
          lastInboundMessageAt: now,
          updatedAt: now,
          contact: {
            update: {
              lastMessage: messageBody
            }
          }
        },
        include: conversationInclude
      });
    });

    return NextResponse.json({ conversation: mapConversation(updated) });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "conversation-message-send",
      route: "/api/conversations/[id]/messages",
      publicErrorCode: "MESSAGE_SEND_FAILED",
      status: 500,
      conversationId: context.params.id
    });

    return publicErrorResponse({
      code: "MESSAGE_SEND_FAILED",
      status: 500
    });
  }
}
