import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { isSemMargemTagName, nextSemMargemReturnWindow } from "@/lib/sem-margem-return";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);

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
      conversationId: (await context.params).id
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
          select: { id: true, name: true }
        })
      : [];

    const validTagIds = tags.map((tag) => tag.id);
    const shouldScheduleSemMargem = tags.some((tag) => isSemMargemTagName(tag.name));

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

      if (shouldScheduleSemMargem) {
        const scopedConversation = await tx.conversation.findFirstOrThrow({
          where: { id: conversation.id, contact: { companyId: session.companyId } },
          select: {
            id: true,
            agentId: true,
            contactId: true,
            contact: { select: { ownerId: true } }
          }
        });
        const assigneeId =
          scopedConversation.agentId ??
          scopedConversation.contact.ownerId ??
          session.id;
        const { dueAt, dayStart, nextDay } = nextSemMargemReturnWindow();
        const existing = await tx.task.findFirst({
          where: {
            companyId: session.companyId,
            contactId: scopedConversation.contactId,
            title: "Retorno: Sem margem",
            status: "PENDING",
            dueAt: { gte: dayStart, lt: nextDay }
          },
          select: { id: true }
        });
        if (!existing) {
          await tx.task.create({
            data: {
              companyId: session.companyId,
              contactId: scopedConversation.contactId,
              assigneeId,
              title: "Retorno: Sem margem",
              note: "Agendado automaticamente pela tag Sem margem.",
              dueAt,
              status: "PENDING"
            }
          });
        }
      }

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
