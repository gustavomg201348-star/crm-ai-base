import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";

const roles = ["ADMIN", "SUPERVISOR", "AGENT"] as const;

function isRole(value: unknown): value is (typeof roles)[number] {
  return typeof value === "string" && roles.includes(value as (typeof roles)[number]);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const current = await prisma.user.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          email?: string;
          password?: string;
          role?: string;
        }
      | null;
    const name = body?.name?.trim();
    const email = body?.email?.trim().toLowerCase();

    if (body?.name !== undefined && !name) {
      return NextResponse.json({ error: "Nome e obrigatorio." }, { status: 400 });
    }

    if (body?.email !== undefined && !email) {
      return NextResponse.json({ error: "Email e obrigatorio." }, { status: 400 });
    }

    if (body?.password !== undefined && body.password && body.password.length < 6) {
      return NextResponse.json(
        { error: "A senha precisa ter pelo menos 6 caracteres." },
        { status: 400 }
      );
    }

    if (body?.role !== undefined && !isRole(body.role)) {
      return NextResponse.json({ error: "Funcao invalida." }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(body?.role !== undefined ? { role: body.role } : {}),
        ...(body?.password ? { passwordHash: hashPassword(body.password) } : {})
      },
      select: { id: true, name: true, email: true, role: true }
    });

    return NextResponse.json({ user });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar usuario." },
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
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;

    if (id === session.id) {
      return NextResponse.json(
        { error: "Voce nao pode remover o proprio usuario logado." },
        { status: 400 }
      );
    }

    const current = await prisma.user.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
    }

    await prisma.user.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover usuario." },
      { status: 500 }
    );
  }
}
