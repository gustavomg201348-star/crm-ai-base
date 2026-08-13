import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
import { publicErrorResponse } from "@/lib/http-error-response";
import {
  contactInclude,
  findContactByNormalizedPhone,
  getContactNormalizedPhone,
  logContactNameMutationAttempt,
  mapContact,
  normalizeContactCpf,
  normalizeContactPhone,
  type LeadTemperature
} from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { forbidden, isAdmin } from "@/lib/permissions";
import {
  isPrismaUniqueViolation,
  isPrismaUniqueViolationForTarget
} from "@/lib/prisma-errors";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

async function findOwnedContact(id: string, companyId: string) {
  return prisma.contact.findFirst({
    where: { id, companyId },
    include: contactInclude
  });
}

const agentAllowedPatchFields = new Set(["name", "cpf", "stageId", "internalNote"]);

async function agentCanEditContact(contact: { id: string; ownerId: string | null }, session: { id: string; companyId: string }) {
  if (contact.ownerId === session.id) return true;

  const assignedConversation = await prisma.conversation.findFirst({
    where: {
      contactId: contact.id,
      agentId: session.id,
      contact: { companyId: session.companyId }
    },
    select: { id: true }
  });

  return Boolean(assignedConversation);
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
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contact-detail",
      route: "/api/contacts/[id]",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500,
      contactId: context.params.id
    });

    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Nao foi possivel carregar o contato."
    });
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
          internalNote?: string | null;
          originId?: string | null;
          stageId?: string | null;
          ownerId?: string | null;
          tagIds?: string[];
          temperature?: LeadTemperature;
          lastMessage?: string | null;
          archived?: boolean;
        }
      | null;

    if (!isAdmin(session)) {
      const blockedFields = Object.keys(body ?? {}).filter(
        (field) => !agentAllowedPatchFields.has(field)
      );

      if (blockedFields.length) {
        return forbidden(
          "Atendentes podem editar apenas nome, CPF, etapa e observacao interna do contato."
        );
      }

      const canEdit = await agentCanEditContact(existing, session);

      if (!canEdit) {
        return forbidden("Voce nao tem permissao para editar este contato.");
      }
    }

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
    const normalizedPhone =
      body?.phone !== undefined ? normalizeContactPhone(body.phone) : undefined;
    const contactNormalizedPhone =
      normalizedPhone !== undefined ? getContactNormalizedPhone(normalizedPhone) : undefined;
    const normalizedCpf =
      body?.cpf !== undefined ? normalizeContactCpf(body.cpf) : undefined;

    if (normalizedCpf && normalizedCpf.length !== 11) {
      return NextResponse.json(
        { error: "Informe um CPF valido com 11 digitos." },
        { status: 400 }
      );
    }

    if (body?.phone !== undefined && !normalizedPhone) {
      return NextResponse.json(
        { error: "Telefone do contato nao pode ficar vazio." },
        { status: 400 }
      );
    }

    if (normalizedPhone !== undefined || normalizedCpf !== undefined) {
      const duplicateByPhone = normalizedPhone
        ? await findContactByNormalizedPhone(prisma, {
            companyId: session.companyId,
            phone: normalizedPhone,
            archived: true,
            source: "contact-update"
          })
        : null;
      const duplicateByCpf = normalizedCpf
        ? await prisma.contact.findFirst({
            where: {
              companyId: session.companyId,
              id: { not: existing.id },
              cpf: normalizedCpf
            },
            select: { id: true }
          })
        : null;
      const duplicate =
        duplicateByPhone && duplicateByPhone.id !== existing.id
          ? duplicateByPhone
          : duplicateByCpf;

      if (duplicate) {
        return NextResponse.json(
          { error: "Ja existe outro contato com este telefone ou CPF." },
          { status: 409 }
        );
      }
    }

    if (body?.name !== undefined && !body.name.trim()) {
      return NextResponse.json(
        { error: "Nome do contato nao pode ficar vazio." },
        { status: 400 }
      );
    }

    const contact = await prisma.$transaction(async (tx) => {
      const activityDetails: string[] = [];
      const manualName = body?.name?.trim().replace(/\s+/g, " ");

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

      if (manualName !== undefined && manualName !== existing.name) {
        activityDetails.push(`Nome alterado manualmente: ${existing.name} -> ${manualName}.`);
        logContactNameMutationAttempt({
          origin: "edicao_manual",
          file: "src/app/api/contacts/[id]/route.ts",
          functionName: "PATCH /api/contacts/[id]",
          contactId: existing.id,
          phone: normalizedPhone ?? existing.phone,
          oldName: existing.name,
          newName: manualName,
          reason: "usuario alterou nome manualmente",
          allowed: true
        });
      }

      if (
        body?.internalNote !== undefined &&
        (body.internalNote?.trim() || null) !== (existing.internalNote ?? null)
      ) {
        activityDetails.push("Observacao interna atualizada.");
      }

      const updated = await tx.contact.update({
        where: { id: existing.id },
        data: {
          ...(manualName !== undefined ? { name: manualName } : {}),
          ...(normalizedPhone !== undefined
            ? { phone: normalizedPhone, normalizedPhone: contactNormalizedPhone }
            : {}),
          ...(body?.email !== undefined ? { email: body.email?.trim() || null } : {}),
          ...(normalizedCpf !== undefined ? { cpf: normalizedCpf || null } : {}),
          ...(body?.internalNote !== undefined
            ? { internalNote: body.internalNote?.trim() || null }
            : {}),
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
  } catch (error) {
    if (
      isPrismaUniqueViolation(error) &&
      (isPrismaUniqueViolationForTarget(error, "normalizedPhone") ||
        isPrismaUniqueViolationForTarget(error, ["companyId", "normalizedPhone"]))
    ) {
      return publicErrorResponse({
        code: "CONTACT_DUPLICATE",
        status: 409
      });
    }

    safeLogError("http-api", error, {
      operation: "contact-update",
      route: "/api/contacts/[id]",
      publicErrorCode: "CONTACT_UPDATE_FAILED",
      status: 500,
      contactId: context.params.id
    });

    return publicErrorResponse({
      code: "CONTACT_UPDATE_FAILED",
      status: 500,
      message: "Nao foi possivel atualizar o contato."
    });
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

    if (!isAdmin(session)) {
      return forbidden("Apenas administradores e supervisores podem arquivar contatos.");
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
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contact-delete",
      route: "/api/contacts/[id]",
      publicErrorCode: "CONTACT_DELETE_FAILED",
      status: 500,
      contactId: context.params.id
    });

    return publicErrorResponse({
      code: "CONTACT_DELETE_FAILED",
      status: 500,
      message: "Nao foi possivel arquivar o contato."
    });
  }
}
