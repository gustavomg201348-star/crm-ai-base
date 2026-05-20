import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | { name?: string; color?: string; position?: number }
      | null;
    const name = body?.name?.trim();
    const color = body?.color?.trim();

    const current = await prisma.pipelineStage.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Etapa nao encontrada." }, { status: 404 });
    }

    if (body?.name !== undefined && !name) {
      return NextResponse.json({ error: "Nome da etapa e obrigatorio." }, { status: 400 });
    }

    const stage = await prisma.pipelineStage.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(body?.position !== undefined && Number.isFinite(body.position)
          ? { position: Number(body.position) }
          : {})
      }
    });

    return NextResponse.json({ stage });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar etapa." },
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

    const { id } = await params;
    const [current, stageCount] = await Promise.all([
      prisma.pipelineStage.findFirst({ where: { id, companyId: session.companyId } }),
      prisma.pipelineStage.count({ where: { companyId: session.companyId } })
    ]);

    if (!current) {
      return NextResponse.json({ error: "Etapa nao encontrada." }, { status: 404 });
    }

    if (stageCount <= 1) {
      return NextResponse.json(
        { error: "Mantenha pelo menos uma etapa no funil." },
        { status: 400 }
      );
    }

    await prisma.pipelineStage.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover etapa." },
      { status: 500 }
    );
  }
}
