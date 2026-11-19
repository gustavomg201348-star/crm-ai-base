import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });

  const quickReplies = await prisma.quickReply.findMany({
    where: { companyId: session.companyId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }]
  });

  return NextResponse.json({ quickReplies });
}

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  const blocked = requireAdmin(session);
  if (blocked) return blocked;

  const body = await request.json().catch(() => null) as { title?: unknown; body?: unknown } | null;
  const title = clean(body?.title, 80);
  const message = clean(body?.body, 4000);
  if (!title || !message) {
    return NextResponse.json({ error: "Informe titulo e mensagem." }, { status: 400 });
  }

  const last = await prisma.quickReply.findFirst({
    where: { companyId: session.companyId },
    orderBy: [{ position: "desc" }, { createdAt: "desc" }],
    select: { position: true }
  });

  const quickReply = await prisma.quickReply.create({
    data: {
      companyId: session.companyId,
      title,
      body: message,
      position: (last?.position ?? -1) + 1
    }
  });

  return NextResponse.json({ quickReply }, { status: 201 });
}
