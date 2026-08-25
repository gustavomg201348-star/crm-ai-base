import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
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
      | { tagIds?: string[]; tagId?: string; mode?: "append" | "replace" }
      | null;
    const tagIds = Array.from(
      new Set(
        [...(body?.tagIds ?? []), body?.tagId ?? ""]
          .map((tagId) => tagId.trim())
          .filter(Boolean)
      )
    );

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

    const tags = tagIds.length
      ? await prisma.tag.findMany({
          where: {
            id: { in: tagIds },
            companyId: session.companyId,
            isActive: true
          },
          select: { id: true }
        })
      : [];

    const validTagIds = tags.map((tag) => tag.id);

    const updated = await prisma.$transaction(async (tx) => {
      if (body?.mode === "replace") {
        await tx.conversationTag.deleteMany({
          where: { conversationId: conversation.id, companyId: session.companyId }
        });
      }

      await Promise.all(
        validTagIds.map((tagId) =>
          tx.conversationTag.upsert({
            where: {
              conversationId_tagId: {
                conversationId: conversation.id,
                tagId
              }
            },
            update: {},
            create: {
              companyId: session.companyId,
              conversationId: conversation.id,
              tagId,
              createdByUserId: session.id
            }
          })
        )
      );

      return tx.conversation.findFirstOrThrow({
        where: { id: conversation.id },
        include: conversationInclude
      });
    });

    return NextResponse.json({ conversation: mapConversation(updated) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar tags da conversa." },
      { status: 500 }
    );
  }
}
