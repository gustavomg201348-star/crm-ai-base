import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { contactInclude, mapContact } from "@/lib/contacts";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const stages = await prisma.pipelineStage.findMany({
      where: { companyId: session.companyId },
      orderBy: { position: "asc" },
      include: {
        contacts: {
          where: { archivedAt: null },
          include: contactInclude,
          orderBy: { updatedAt: "desc" }
        }
      }
    });

    const unstaged = await prisma.contact.findMany({
      where: {
        companyId: session.companyId,
        archivedAt: null,
        stageId: null
      },
      include: contactInclude,
      orderBy: { updatedAt: "desc" }
    });

    return NextResponse.json({
      stages: [
        ...stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: stage.position,
          contacts: stage.contacts.map(mapContact)
        })),
        {
          id: "",
          name: "Sem etapa",
          color: "#64748b",
          position: 999,
          contacts: unstaged.map(mapContact)
        }
      ]
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar o Kanban." },
      { status: 500 }
    );
  }
}
