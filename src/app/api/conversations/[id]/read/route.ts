import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
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

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: context.params.id,
        contact: { companyId: session.companyId }
      },
      select: { id: true }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    const readAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      await tx.message.updateMany({
        where: {
          conversationId: conversation.id,
          direction: "inbound",
          readAt: null
        },
        data: { readAt }
      });

      return tx.conversation.update({
        where: { id: conversation.id },
        data: {
          unreadCount: 0,
          lastReadAt: readAt
        },
        include: conversationInclude
      });
    });

    return NextResponse.json({
      conversation: mapConversation(updated),
      unreadCount: 0,
      readAt
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel marcar conversa como lida." },
      { status: 500 }
    );
  }
}
