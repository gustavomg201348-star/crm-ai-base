import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";

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

    const updated = await prisma.$transaction(async (tx) => {
      const direction = body?.direction ?? "outbound";

      await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction,
          body: messageBody,
          type: "text",
          status: "sent"
        }
      });

      await createActivity(tx, {
        contactId: conversation.contactId,
        userId: session.id,
        type: direction === "outbound" ? "MESSAGE_SENT" : "MESSAGE_RECEIVED",
        title: direction === "outbound" ? "Mensagem enviada" : "Mensagem recebida",
        detail: messageBody
      });

      return tx.conversation.update({
        where: { id: conversation.id },
        data: {
          status:
            direction === "outbound" && conversation.status === "PENDING"
              ? "OPEN"
              : conversation.status,
          updatedAt: new Date(),
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel enviar mensagem." },
      { status: 500 }
    );
  }
}
