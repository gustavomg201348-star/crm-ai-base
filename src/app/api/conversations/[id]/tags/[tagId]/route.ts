import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: { id: string; tagId: string };
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const access = await resolveConversationAccess({
      db: prisma,
      session,
      conversationId: context.params.id
    });

    if (access.status === "not_found") {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (access.status === "forbidden") {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const { conversation } = access;

    const tag = await prisma.tag.findFirst({
      where: { id: context.params.tagId, companyId: session.companyId },
      select: { id: true }
    });

    if (!tag) {
      return NextResponse.json({ error: "Tag nao encontrada." }, { status: 404 });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.conversationTag.deleteMany({
        where: {
          conversationId: conversation.id,
          tagId: tag.id,
          companyId: session.companyId
        }
      });

      return tx.conversation.findFirstOrThrow({
        where: { id: conversation.id },
        include: conversationInclude
      });
    });

    return NextResponse.json({ conversation: mapConversation(updated) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover tag da conversa." },
      { status: 500 }
    );
  }
}
