import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  conversationInclude,
  mapConversation,
  type ConversationStatus
} from "@/lib/conversations";
import { prisma } from "@/lib/db";

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, "");
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status") ?? "OPEN";
    const tagIds = request.nextUrl.searchParams
      .getAll("tagId")
      .concat(request.nextUrl.searchParams.get("tagIds")?.split(",") ?? [])
      .map((tagId) => tagId.trim())
      .filter(Boolean);

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
        ...(tagIds.length
          ? {
              tags: {
                some: {
                  tagId: { in: tagIds },
                  companyId: session.companyId,
                  tag: { companyId: session.companyId, isActive: true }
                }
              }
            }
          : {}),
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
          name?: string;
          phone?: string;
          status?: ConversationStatus;
          summary?: string;
        }
      | null;

    const phone = body?.phone?.trim();
    const normalizedPhone = phone ? normalizePhone(phone) : "";
    const name = body?.name?.trim();

    let contact = body?.contactId
      ? await prisma.contact.findFirst({
          where: {
            id: body.contactId,
            companyId: session.companyId,
            archivedAt: null
          }
        })
      : null;

    if (!contact && normalizedPhone) {
      contact = await prisma.contact.findFirst({
        where: {
          companyId: session.companyId,
          archivedAt: null,
          OR: [{ phone: normalizedPhone }, { phone: phone ?? normalizedPhone }]
        }
      });
    }

    if (!contact && normalizedPhone) {
      const [origin, stage] = await Promise.all([
        prisma.origin.findFirst({
          where: { companyId: session.companyId, name: "WhatsApp" }
        }),
        prisma.pipelineStage.findFirst({
          where: { companyId: session.companyId },
          orderBy: { position: "asc" }
        })
      ]);

      contact = await prisma.contact.create({
        data: {
          companyId: session.companyId,
          ownerId: session.id,
          name: name || normalizedPhone,
          phone: normalizedPhone,
          originId: origin?.id ?? null,
          stageId: stage?.id ?? null,
          temperature: "WARM"
        }
      });
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Informe um contato ou telefone valido." },
        { status: 400 }
      );
    }

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        status: { not: "RESOLVED" }
      },
      include: conversationInclude,
      orderBy: { updatedAt: "desc" }
    });

    if (existingConversation) {
      return NextResponse.json({ conversation: mapConversation(existingConversation) });
    }

    const channel = await prisma.channel.findFirst({
      where: { companyId: session.companyId, type: "whatsapp", status: "ACTIVE" },
      orderBy: { updatedAt: "desc" }
    });

    const conversation = await prisma.conversation.create({
      data: {
        contactId: contact.id,
        agentId: session.id,
        status: body?.status ?? "OPEN",
        channel: channel ? `whatsapp:${channel.id}` : "whatsapp",
        summary: body?.summary?.trim() || null
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
