import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

const kanbanContactSelect = {
  id: true,
  name: true,
  phone: true,
  email: true,
  cpf: true,
  temperature: true,
  lastMessage: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  ownerId: true,
  originId: true,
  stageId: true,
  owner: { select: { name: true } },
  origin: { select: { name: true } },
  stage: { select: { name: true } },
  tags: {
    include: {
      tag: {
        select: {
          id: true,
          name: true,
          color: true
        }
      }
    }
  }
} satisfies Prisma.ContactSelect;

type KanbanContact = Prisma.ContactGetPayload<{ select: typeof kanbanContactSelect }>;

function mapKanbanContact(contact: KanbanContact) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    cpf: contact.cpf,
    temperature: contact.temperature,
    lastMessage: contact.lastMessage,
    archivedAt: contact.archivedAt,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    owner: contact.owner?.name ?? "Sem responsavel",
    origin: contact.origin?.name ?? "Sem origem",
    stage: contact.stage?.name ?? "Sem etapa",
    ownerId: contact.ownerId,
    originId: contact.originId,
    stageId: contact.stageId,
    tags: contact.tags.map((item) => ({
      id: item.tag.id,
      name: item.tag.name,
      color: item.tag.color
    })),
    conversations: [],
    proposals: []
  };
}

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
          select: kanbanContactSelect,
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
      select: kanbanContactSelect,
      orderBy: { updatedAt: "desc" }
    });

    return NextResponse.json({
      stages: [
        ...stages.map((stage) => ({
          id: stage.id,
          name: stage.name,
          color: stage.color,
          position: stage.position,
          contacts: stage.contacts.map(mapKanbanContact)
        })),
        {
          id: "",
          name: "Sem etapa",
          color: "#64748b",
          position: 999,
          contacts: unstaged.map(mapKanbanContact)
        }
      ]
    });
  } catch (error) {
    console.error("[kanban-load-error]", error);
    return NextResponse.json(
      { error: "Nao foi possivel carregar o Kanban." },
      { status: 500 }
    );
  }
}
