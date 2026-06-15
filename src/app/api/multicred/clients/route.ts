import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar clientes Multicred." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });
    }

    const data = buildMulticredClientData(body);
    const contactId = readString(body.contactId);

    if (!data.name) {
      return NextResponse.json({ error: "Nome do cliente e obrigatorio." }, { status: 400 });
    }

    if (!isValidCpf(data.cpf)) {
      return NextResponse.json({ error: "CPF invalido." }, { status: 400 });
    }

    const existing = await prisma.multicredClient.findUnique({
      where: { companyId_cpf: { companyId: session.companyId, cpf: data.cpf } }
    });

    if (existing) {
      return NextResponse.json(
        { error: "Ja existe cliente Multicred com este CPF." },
        { status: 409 }
      );
    }

    const linkedContact = contactId
      ? await prisma.contact.findFirst({
          where: { id: contactId, companyId: session.companyId }
        })
      : await prisma.contact.findFirst({
          where: {
            companyId: session.companyId,
            OR: [
              { cpf: data.cpf },
              ...(data.phone ? [{ phone: data.phone }] : []),
              ...(data.whatsapp ? [{ phone: data.whatsapp }] : [])
            ]
          }
        });

    if (contactId && !linkedContact) {
      return NextResponse.json({ error: "Contato vinculado nao encontrado." }, { status: 404 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar cliente Multicred." },
      { status: 500 }
    );
  }
}

