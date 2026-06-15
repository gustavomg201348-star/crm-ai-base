import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildMulticredClientPatchData,
  isValidCpf,
  mapMulticredClientDetail,
  multicredClientDetailInclude,
  readString
} from "@/lib/multicred-clients";
import { requireCompanyAdmin } from "@/lib/permissions";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await context.params;
    const client = await prisma.multicredClient.findFirst({
      where: { id, companyId: session.companyId },
      include: multicredClientDetailInclude
    });

    if (!client) {
      return NextResponse.json({ error: "Cliente Multicred nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ client: mapMulticredClientDetail(client) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar cliente Multicred." },
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
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await context.params;
    const current = await prisma.multicredClient.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Cliente Multicred nao encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });
    }

    const data = buildMulticredClientPatchData(body);
    const contactId = "contactId" in body ? readString(body.contactId) : undefined;

    if ("name" in data && !data.name) {
      return NextResponse.json({ error: "Nome do cliente e obrigatorio." }, { status: 400 });
    }

    if ("cpf" in data) {
      if (!isValidCpf(String(data.cpf ?? ""))) {
        return NextResponse.json({ error: "CPF invalido." }, { status: 400 });
      }

      const duplicated = await prisma.multicredClient.findFirst({
        where: {
          companyId: session.companyId,
          cpf: String(data.cpf),
          NOT: { id }
        }
      });

      if (duplicated) {
        return NextResponse.json(
          { error: "Ja existe cliente Multicred com este CPF." },
          { status: 409 }
        );
      }
    }

    if (contactId !== undefined) {
      if (contactId) {
        const contact = await prisma.contact.findFirst({
          where: { id: contactId, companyId: session.companyId }
        });

        if (!contact) {
          return NextResponse.json(
            { error: "Contato vinculado nao encontrado." },
            { status: 404 }
          );
        }
      }

      data.contactId = contactId || null;
    }

    const client = await prisma.multicredClient.update({
      where: { id: current.id },
      data,
      include: multicredClientDetailInclude
    });

    return NextResponse.json({ client: mapMulticredClientDetail(client) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar cliente Multicred." },
      { status: 500 }
    );
  }
}
