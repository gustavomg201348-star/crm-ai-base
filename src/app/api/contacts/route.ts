import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { createActivity } from "@/lib/activities";
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
import { publicErrorResponse } from "@/lib/http-error-response";
import {
  isPrismaUniqueViolation,
  isPrismaUniqueViolationForTarget
} from "@/lib/prisma-errors";
import { safeLogError } from "@/lib/safe-logger";

function buildContactWhere(
  companyId: string,
  searchParams: NextRequest["nextUrl"]["searchParams"]
): Prisma.ContactWhereInput {
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status") ?? "active";
  const originId = searchParams.get("originId") ?? "";
  const stageId = searchParams.get("stageId") ?? "";
  const ownerId = searchParams.get("ownerId") ?? "";
  const tagId = searchParams.get("tagId") ?? "";
  const temperature = searchParams.get("temperature") ?? "";

  return {
    companyId,
    archivedAt: status === "archived" ? { not: null } : null,
    ...(originId ? { originId } : {}),
    ...(stageId ? { stageId } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    ...(temperature ? { temperature } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
            { cpf: { contains: search } }
          ]
        }
      : {})
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const contacts = await prisma.contact.findMany({
      where: buildContactWhere(session.companyId, request.nextUrl.searchParams),
      include: contactInclude,
      orderBy: { updatedAt: "desc" },
      take: 100
    });

    return NextResponse.json({ contacts: contacts.map(mapContact) });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contacts-list",
      route: "/api/contacts",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Nao foi possivel carregar contatos."
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          phone?: string;
          email?: string;
          cpf?: string;
          originId?: string;
          stageId?: string;
          ownerId?: string;
          tagIds?: string[];
          temperature?: LeadTemperature;
        }
      | null;

    const name = body?.name?.trim();
    const phone = normalizeContactPhone(body?.phone);
    const normalizedPhone = getContactNormalizedPhone(phone);
    const cpf = normalizeContactCpf(body?.cpf);

    if (!name || !phone) {
      return NextResponse.json(
        { error: "Nome e telefone sao obrigatorios." },
        { status: 400 }
      );
    }

    if (cpf && cpf.length !== 11) {
      return NextResponse.json(
        { error: "Informe um CPF valido com 11 digitos." },
        { status: 400 }
      );
    }

    const duplicated =
      (await findContactByNormalizedPhone(prisma, {
        companyId: session.companyId,
        phone,
        archived: true,
        source: "contact-create"
      })) ??
      (cpf
        ? await prisma.contact.findFirst({
            where: {
              companyId: session.companyId,
              cpf
            },
            select: { id: true }
          })
        : null);

    if (duplicated) {
      return NextResponse.json(
        { error: "Ja existe um contato com este telefone ou CPF." },
        { status: 409 }
      );
    }

    const owner = body?.ownerId
      ? await prisma.user.findFirst({
          where: { id: body.ownerId, companyId: session.companyId }
        })
      : null;
    const tagIds = Array.isArray(body?.tagIds) ? Array.from(new Set(body.tagIds)) : [];
    const tags = tagIds.length
      ? await prisma.tag.findMany({
          where: { id: { in: tagIds }, companyId: session.companyId },
          select: { id: true }
        })
      : [];

    const contact = await prisma.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          companyId: session.companyId,
          ownerId: owner?.id ?? session.id,
          name,
          phone,
          normalizedPhone,
          email: body?.email?.trim() || null,
          cpf: cpf || null,
          originId: body?.originId || null,
          stageId: body?.stageId || null,
          temperature: body?.temperature || "WARM",
          tags: tags.length
            ? { create: tags.map((tag) => ({ tagId: tag.id })) }
            : undefined
        },
        include: contactInclude
      });

      await createActivity(tx, {
        contactId: created.id,
        userId: session.id,
        type: "CONTACT_CREATED",
        title: "Contato criado",
        detail: `${created.name} foi adicionado ao CRM.`
      });

      logContactNameMutationAttempt({
        origin: "edicao_manual",
        file: "src/app/api/contacts/route.ts",
        functionName: "POST /api/contacts",
        contactId: created.id,
        phone: created.phone,
        oldName: null,
        newName: created.name,
        reason: "contato criado manualmente",
        allowed: true
      });

      return created;
    });

    return NextResponse.json({ contact: mapContact(contact) }, { status: 201 });
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
      operation: "contact-create",
      route: "/api/contacts",
      publicErrorCode: "CONTACT_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({
      code: "CONTACT_CREATE_FAILED",
      status: 500,
      message: "Nao foi possivel salvar contato."
    });
  }
}
