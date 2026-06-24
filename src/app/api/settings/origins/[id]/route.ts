import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Nome da origem e obrigatorio." }, { status: 400 });
    }

    const current = await prisma.origin.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Origem nao encontrada." }, { status: 404 });
    }

    const origin = await prisma.origin.update({
      where: { id },
      data: { name }
    });

    return NextResponse.json({ origin });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar origem." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const current = await prisma.origin.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Origem nao encontrada." }, { status: 404 });
    }

    await prisma.origin.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover origem." },
      { status: 500 }
    );
  }
}
