import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export async function PATCH(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          contactIds?: string[];
          ownerId?: string;
          stageId?: string;
          tagId?: string;
          archived?: boolean;
        }
      | null;
    const contactIds = Array.isArray(body?.contactIds)
      ? Array.from(new Set(body.contactIds)).filter(Boolean)
      : [];

    if (!contactIds.length) {
      return NextResponse.json(
        { error: "Selecione pelo menos um contato." },
        { status: 400 }
      );
    }

    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, companyId: session.companyId },
      select: { id: true }
    });
    const validIds = contacts.map((contact) => contact.id);

    if (!validIds.length) {
      return NextResponse.json({ error: "Nenhum contato valido." }, { status: 404 });
    }

    const owner = body?.ownerId
      ? await prisma.user.findFirst({
          where: { id: body.ownerId, companyId: session.companyId },
          select: { id: true }
        })
      : null;
    const stage = body?.stageId
      ? await prisma.pipelineStage.findFirst({
          where: { id: body.stageId, companyId: session.companyId },
          select: { id: true }
        })
      : null;
    const tag = body?.tagId
      ? await prisma.tag.findFirst({
          where: { id: body.tagId, companyId: session.companyId },
          select: { id: true }
        })
      : null;

    await prisma.$transaction(async (tx) => {
      if (body?.ownerId !== undefined || body?.stageId !== undefined || body?.archived !== undefined) {
        await tx.contact.updateMany({
          where: { id: { in: validIds }, companyId: session.companyId },
          data: {
            ...(body.ownerId !== undefined ? { ownerId: owner?.id ?? null } : {}),
            ...(body.stageId !== undefined ? { stageId: stage?.id ?? null } : {}),
            ...(body.archived !== undefined
              ? { archivedAt: body.archived ? new Date() : null }
              : {})
          }
        });
      }

      if (tag?.id) {
        const existing = await tx.contactTag.findMany({
          where: { contactId: { in: validIds }, tagId: tag.id },
          select: { contactId: true }
        });
        const existingIds = new Set(existing.map((item) => item.contactId));
        const missingIds = validIds.filter((id) => !existingIds.has(id));

        for (const contactId of missingIds) {
          await tx.contactTag.create({ data: { contactId, tagId: tag.id } });
        }
      }
    });

    return NextResponse.json({ updated: validIds.length });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel aplicar acao em massa." },
      { status: 500 }
    );
  }
}
