import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | { name?: string; color?: string; position?: number }
      | null;
    const name = body?.name?.trim();
    const color = body?.color?.trim() || "#0f766e";

    if (!name) {
      return NextResponse.json({ error: "Nome da etapa e obrigatorio." }, { status: 400 });
    }

    const lastStage = await prisma.pipelineStage.findFirst({
      where: { companyId: session.companyId },
      orderBy: { position: "desc" }
    });

    const stage = await prisma.pipelineStage.create({
      data: {
        companyId: session.companyId,
        name,
        color,
        position: Number.isFinite(body?.position)
          ? Number(body?.position)
          : (lastStage?.position ?? 0) + 1
      }
    });

    return NextResponse.json({ stage }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar etapa." },
      { status: 500 }
    );
  }
}
