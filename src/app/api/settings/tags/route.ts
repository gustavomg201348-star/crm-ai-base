import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const tags = await prisma.tag.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });

    return NextResponse.json({ tags });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel listar tags." },
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

    const body = (await request.json().catch(() => null)) as
      | {
          name?: string;
          color?: string;
          textColor?: string;
          category?: string;
          isActive?: boolean;
        }
      | null;
    const name = body?.name?.trim();
    const color = body?.color?.trim() || "#0f766e";
    const textColor = body?.textColor?.trim() || "#ffffff";
    const category = body?.category?.trim() || null;

    if (!name) {
      return NextResponse.json({ error: "Nome da tag e obrigatorio." }, { status: 400 });
    }

    const tag = await prisma.tag.create({
      data: {
        companyId: session.companyId,
        name,
        color,
        textColor,
        category,
        isActive: body?.isActive ?? true
      }
    });

    return NextResponse.json({ tag }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar tag." },
      { status: 500 }
    );
  }
}
