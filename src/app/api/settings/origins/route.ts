import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/permissions";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();

    if (!name) {
      return NextResponse.json({ error: "Nome da origem e obrigatorio." }, { status: 400 });
    }

    const origin = await prisma.origin.create({
      data: { companyId: session.companyId, name }
    });

    return NextResponse.json({ origin }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar origem." },
      { status: 500 }
    );
  }
}
