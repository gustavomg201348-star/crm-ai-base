import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { contactInclude, mapContact, type LeadTemperature } from "@/lib/contacts";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: { id: string };
};

async function findOwnedContact(id: string, companyId: string) {
  return prisma.contact.findFirst({
    where: { id, companyId },
    include: contactInclude
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const contact = await findOwnedContact(context.params.id, session.companyId);

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ contact: mapContact(contact) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar o contato." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const existing = await findOwnedContact(context.params.id, session.companyId);

    if (!existing) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          phone?: string;
          email?: string | null;
          cpf?: string | null;
          originId?: string | null;
          stageId?: string | null;
          ownerId?: string | null;
          tagIds?: string[];
          temperature?: LeadTemperature;
          lastMessage?: string | null;
          archived?: boolean;
        }
      | null;

    const owner =
      body?.ownerId !== undefined && body.ownerId
        ? await prisma.user.findFirst({
            where: { id: body.ownerId, companyId: session.companyId }
          })
        : null;
    const tagIds = Array.isArray(body?.tagIds)
      ? Array.from(new Set(body.tagIds))
      : null;
    const tags =
      tagIds && tagIds.length
        ? await prisma.tag.findMany({
            where: { id: { in: tagIds }, companyId: session.companyId },
            select: { id: true }
          })
        : [];

    const contact = await prisma.$transaction(async (tx) => {
      const activityDetails: string[] = [];

      if (tagIds) {
        await tx.contactTag.deleteMany({ where: { contactId: existing.id } });
        if (tags.length) {
          await tx.contactTag.createMany({
            data: tags.map((tag) => ({ contactId: existing.id, tagId: tag.id }))
          });
        }
        activityDetails.push(
          tags.length
            ? `Tags atualizadas: ${tags.map((tag) => tag.id).join(", ")}.`
            : "Tags removidas."
        );
      }

      if (body?.stageId !== undefined && body.stageId !== existing.stageId) {
        activityDetails.push("Etapa alterada.");
      }

      if (body?.ownerId !== undefined && (owner?.id ?? null) !== existing.ownerId) {
        activityDetails.push("Responsavel alterado.");
      }

      if (body?.archived !== undefined) {
        activityDetails.push(body.archived ? "Contato arquivado." : "Contato reativado.");
      }

      const updated = await tx.contact.update({
        where: { id: existing.id },
        data: {
          ...(body?.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body?.phone !== undefined ? { phone: body.phone.trim() } : {}),
          ...(body?.email !== undefined ? { email: body.email?.trim() || null } : {}),
          ...(body?.cpf !== undefined ? { cpf: body.cpf?.trim() || null } : {}),
          ...(body?.originId !== undefined ? { originId: body.originId || null } : {}),
          ...(body?.stageId !== undefined ? { stageId: body.stageId || null } : {}),
          ...(body?.ownerId !== undefined ? { ownerId: owner?.id ?? null } : {}),
          ...(body?.temperature !== undefined
            ? { temperature: body.temperature }
            : {}),
          ...(body?.lastMessage !== undefined
            ? { lastMessage: body.lastMessage?.trim() || null }
            : {}),
          ...(body?.archived !== undefined
            ? { archivedAt: body.archived ? new Date() : null }
            : {})
        },
        include: contactInclude
      });

      await createActivity(tx, {
        contactId: existing.id,
        userId: session.id,
        type: "CONTACT_UPDATED",
        title: body?.archived !== undefined
          ? body.archived
            ? "Contato arquivado"
            : "Contato reativado"
          : "Contato atualizado",
        detail: activityDetails.length
          ? activityDetails.join(" ")
          : "Dados cadastrais atualizados."
      });

      return updated;
    });

    return NextResponse.json({ contact: mapContact(contact) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o contato." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const existing = await findOwnedContact(context.params.id, session.companyId);

    if (!existing) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const contact = await prisma.$transaction(async (tx) => {
      const archived = await tx.contact.update({
        where: { id: existing.id },
        data: { archivedAt: new Date() },
        include: contactInclude
      });

      await createActivity(tx, {
        contactId: existing.id,
        userId: session.id,
        type: "CONTACT_ARCHIVED",
        title: "Contato arquivado",
        detail: "Contato removido da lista ativa."
      });

      return archived;
    });

    return NextResponse.json({ contact: mapContact(contact) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel arquivar o contato." },
      { status: 500 }
    );
  }
}
