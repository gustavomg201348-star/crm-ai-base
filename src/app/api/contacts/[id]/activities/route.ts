import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { activityInclude, mapActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const { id } = await params;
    const contact = await prisma.contact.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const activities = await prisma.contactActivity.findMany({
      where: { contactId: id },
      include: activityInclude,
      orderBy: { createdAt: "desc" },
      take: 100
    });

    return NextResponse.json({ activities: activities.map(mapActivity) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar historico." },
      { status: 500 }
    );
  }
}

export async function POST(
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
      | { detail?: string }
      | null;
    const detail = body?.detail?.trim();

    if (!detail) {
      return NextResponse.json({ error: "Escreva uma anotacao." }, { status: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const activity = await prisma.contactActivity.create({
      data: {
        contactId: id,
        userId: session.id,
        type: "NOTE",
        title: "Anotacao manual",
        detail
      },
      include: activityInclude
    });

    return NextResponse.json({ activity: mapActivity(activity) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel salvar anotacao." },
      { status: 500 }
    );
  }
}
