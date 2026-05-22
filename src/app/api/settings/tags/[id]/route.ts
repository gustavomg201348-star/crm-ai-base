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
      | {
          name?: string;
          color?: string;
          textColor?: string;
          category?: string | null;
          isActive?: boolean;
        }
      | null;
    const name = body?.name?.trim();
    const color = body?.color?.trim();
    const textColor = body?.textColor?.trim();
    const category = body?.category === null ? null : body?.category?.trim();

    const current = await prisma.tag.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Tag nao encontrada." }, { status: 404 });
    }

    if (body?.name !== undefined && !name) {
      return NextResponse.json({ error: "Nome da tag e obrigatorio." }, { status: 400 });
    }

    const tag = await prisma.tag.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(textColor !== undefined ? { textColor } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(body?.isActive !== undefined ? { isActive: body.isActive } : {})
      }
    });

    return NextResponse.json({ tag });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar tag." },
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
    const current = await prisma.tag.findFirst({
      where: { id, companyId: session.companyId }
    });

    if (!current) {
      return NextResponse.json({ error: "Tag nao encontrada." }, { status: 404 });
    }

    await prisma.tag.update({
      where: { id },
      data: { isActive: false }
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel remover tag." },
      { status: 500 }
    );
  }
}
