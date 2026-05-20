import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  conversationInclude,
  mapConversation,
  type ConversationStatus
} from "@/lib/conversations";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status") ?? "OPEN";

    const conversations = await prisma.conversation.findMany({
      where: {
        contact: {
          companyId: session.companyId,
          archivedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search } },
                  { phone: { contains: search } },
                  { cpf: { contains: search } }
                ]
              }
            : {})
        },
        ...(status === "ALL" ? {} : { status })
      },
      include: conversationInclude,
      orderBy: { updatedAt: "desc" },
      take: 100
    });

    return NextResponse.json({
      conversations: conversations.map(mapConversation)
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar conversas." },
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
          contactId?: string;
          status?: ConversationStatus;
          summary?: string;
        }
      | null;

    if (!body?.contactId) {
      return NextResponse.json({ error: "Informe o contato." }, { status: 400 });
    }

    const contact = await prisma.contact.findFirst({
      where: {
        id: body.contactId,
        companyId: session.companyId,
        archivedAt: null
      }
    });

    if (!contact) {
      return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    }

    const conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        agentId: session.id,
        status: body.status ?? "OPEN",
        summary: body.summary?.trim() || null
      },
      include: conversationInclude
    });

    return NextResponse.json(
      { conversation: mapConversation(conversation) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar conversa." },
      { status: 500 }
    );
  }
}
