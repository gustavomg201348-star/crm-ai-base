import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { getContactNormalizedPhone } from "@/lib/contacts";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import {
  buildMulticredClientData,
  isValidCpf,
  mapMulticredClient,
  multicredClientInclude,
  normalizeCpf,
  normalizePhone,
  readString
} from "@/lib/multicred-clients";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

function buildWhere(companyId: string, searchParams: NextRequest["nextUrl"]["searchParams"]) {
  const search = searchParams.get("search")?.trim();
  const digits = search?.replace(/\D/g, "") ?? "";

  return {
    companyId,
    ...(search
      ? {
          OR: [
            { name: { contains: search } },
            { cpf: { contains: normalizeCpf(search) || search } },
            { phone: { contains: normalizePhone(search) ?? digits } },
            { whatsapp: { contains: normalizePhone(search) ?? digits } },
            { email: { contains: search } }
          ]
        }
      : {})
  } satisfies Prisma.MulticredClientWhereInput;
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const clients = await prisma.multicredClient.findMany({
      where: buildWhere(session.companyId, request.nextUrl.searchParams),
      include: multicredClientInclude,
      orderBy: { updatedAt: "desc" },
      take: 100
    });

    return NextResponse.json({ clients: clients.map(mapMulticredClient) });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/clients",
      method: "GET",
      publicErrorCode: "MULTICRED_CLIENT_LIST_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_CLIENT_LIST_FAILED", status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const data = buildMulticredClientData(body);
    const contactId = readString(body.contactId);
    const contactNormalizedPhone = getContactNormalizedPhone(data.phone);
    const contactNormalizedWhatsapp = getContactNormalizedPhone(data.whatsapp);

    if (!data.name) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    if (!isValidCpf(data.cpf)) {
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    const existing = await prisma.multicredClient.findUnique({
      where: { companyId_cpf: { companyId: session.companyId, cpf: data.cpf } }
    });

    if (existing) {
      return publicErrorResponse({ code: "CONFLICT", status: 409 });
    }

    let linkedContact = contactId
      ? await prisma.contact.findFirst({
          where: { id: contactId, companyId: session.companyId }
        })
      : null;

    if (!contactId) {
      linkedContact = await prisma.contact.findFirst({
        where: { companyId: session.companyId, cpf: data.cpf }
      });

      if (!linkedContact && contactNormalizedPhone) {
        linkedContact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, normalizedPhone: contactNormalizedPhone }
        });
      }

      if (
        !linkedContact &&
        contactNormalizedWhatsapp &&
        contactNormalizedWhatsapp !== contactNormalizedPhone
      ) {
        linkedContact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, normalizedPhone: contactNormalizedWhatsapp }
        });
      }

      if (!linkedContact && data.phone) {
        linkedContact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, phone: data.phone }
        });
      }

      if (!linkedContact && data.whatsapp && data.whatsapp !== data.phone) {
        linkedContact = await prisma.contact.findFirst({
          where: { companyId: session.companyId, phone: data.whatsapp }
        });
      }
    }

    if (contactId && !linkedContact) {
      return publicErrorResponse({ code: "CONTACT_NOT_FOUND", status: 404 });
    }

    const client = await prisma.multicredClient.create({
      data: {
        ...data,
        companyId: session.companyId,
        createdById: session.id,
        contactId: linkedContact?.id ?? null
      },
      include: multicredClientInclude
    });

    return NextResponse.json({ client: mapMulticredClient(client) }, { status: 201 });
  } catch (error) {
    safeLogError("http-api", error, {
      route: "/api/multicred/clients",
      method: "POST",
      publicErrorCode: "MULTICRED_CLIENT_CREATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "MULTICRED_CLIENT_CREATE_FAILED", status: 500 });
  }
}
