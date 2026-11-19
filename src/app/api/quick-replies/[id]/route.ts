import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  const blocked = requireAdmin(session);
  if (blocked) return blocked;

  const { id } = await params;
  const current = await prisma.quickReply.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true }
  });
  if (!current) return NextResponse.json({ error: "Resposta rapida nao encontrada." }, { status: 404 });

  const body = await request.json().catch(() => null) as { title?: unknown; body?: unknown } | null;
  const title = clean(body?.title, 80);
  const message = clean(body?.body, 4000);
  if (!title || !message) {
    return NextResponse.json({ error: "Informe titulo e mensagem." }, { status: 400 });
  }

  const quickReply = await prisma.quickReply.update({
    where: { id },
    data: { title, body: message }
  });
  return NextResponse.json({ quickReply });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  const blocked = requireAdmin(session);
  if (blocked) return blocked;

  const { id } = await params;
  const current = await prisma.quickReply.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true }
  });
  if (!current) return NextResponse.json({ error: "Resposta rapida nao encontrada." }, { status: 404 });

  await prisma.quickReply.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
