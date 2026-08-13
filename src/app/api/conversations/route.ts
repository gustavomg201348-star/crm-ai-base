import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSessionFromRequest } from "@/lib/auth";
import {
  conversationInclude,
  conversationListSelect,
  mapConversation,
  mapConversationListItem,
  type ConversationStatus
} from "@/lib/conversations";
import { findOrCreateConversationForChannel } from "@/lib/conversation-lifecycle.service";
import { prisma } from "@/lib/db";
import { maybeAutoAssignConversation } from "@/lib/lead-assignment";
import { conversationVisibilityWhere, isAdmin } from "@/lib/permissions";
import {
  findContactPhoneIdentityMatch,
  getContactNormalizedPhone,
  logContactNameMutationAttempt,
  normalizeContactCpf,
  normalizeContactPhone
} from "@/lib/contacts";

type ConversationWithInclude = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const search = request.nextUrl.searchParams.get("search")?.trim();
    const status = request.nextUrl.searchParams.get("status") ?? "OPEN";
    const assignedTo = request.nextUrl.searchParams.get("assignedTo")?.trim();
    const tagIds = request.nextUrl.searchParams
      .getAll("tagId")
      .concat(request.nextUrl.searchParams.get("tagIds")?.split(",") ?? [])
      .map((tagId) => tagId.trim())
      .filter(Boolean);

    const assignmentWhere =
      assignedTo === "me"
        ? { agentId: session.id }
        : assignedTo === "unassigned"
          ? { agentId: null }
          : assignedTo && isAdmin(session)
            ? { agentId: assignedTo }
            : conversationVisibilityWhere(session);

    const baseWhere = {
        ...assignmentWhere,
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
      };

    const [conversations, statusGroups] = await Promise.all([
      prisma.conversation.findMany({
        where: {
          ...baseWhere,
          ...(status === "ALL" ? {} : { status })
        },
        select: conversationListSelect,
        orderBy: [
          { lastMessageAt: { sort: "desc", nulls: "last" } },
          { createdAt: "desc" }
        ],
        take: 100
      }),
      prisma.conversation.groupBy({
        by: ["status"],
        where: baseWhere,
        _count: { _all: true }
      })
    ]);

    const statusCounts = {
      OPEN: 0,
      PENDING: 0,
      BOT: 0,
      RESOLVED: 0,
      SOLD: 0
    };

    for (const group of statusGroups) {
      if (group.status in statusCounts) {
        statusCounts[group.status as keyof typeof statusCounts] = group._count._all;
      }
    }

    const mappedConversations = conversations
      .map(mapConversationListItem)
      .sort((a, b) => {
        const aTime = a.lastMessageAt
          ? new Date(a.lastMessageAt).getTime()
          : new Date(a.createdAt).getTime();
        const bTime = b.lastMessageAt
          ? new Date(b.lastMessageAt).getTime()
          : new Date(b.createdAt).getTime();

        return bTime - aTime;
      })
      .slice(0, 100);

    return NextResponse.json({
      conversations: mappedConversations,
      statusCounts
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
          cpf?: string;
          channelId?: string;
          status?: ConversationStatus;
          summary?: string;
        }
      | null;

    const phone = body?.phone?.trim();
    const normalizedPhone = normalizeContactPhone(phone);
    const contactNormalizedPhone = getContactNormalizedPhone(normalizedPhone);
    const normalizedCpf = normalizeContactCpf(body?.cpf);
    const name = body?.name?.trim();

    if (normalizedCpf && normalizedCpf.length !== 11) {
      return NextResponse.json(
        { error: "Informe um CPF valido com 11 digitos." },
        { status: 400 }
      );
    }

    let contact = body?.contactId
      ? await prisma.contact.findFirst({
          where: {
            id: body.contactId,
            companyId: session.companyId,
            archivedAt: null
          }
        })
      : null;

    let phoneIdentityMatchType = "none";
    if (!contact && normalizedPhone) {
      const phoneIdentity = await findContactPhoneIdentityMatch(prisma, {
        companyId: session.companyId,
        phone: normalizedPhone,
        source: "conversation-create"
      });
      contact = phoneIdentity.contact;
      phoneIdentityMatchType = phoneIdentity.matchType;

      if (!contact && normalizedCpf) {
        contact = await prisma.contact.findFirst({
          where: {
            companyId: session.companyId,
            archivedAt: null,
            cpf: normalizedCpf
          }
        });
      }
    }

    const contactByCpf = normalizedCpf
      ? await prisma.contact.findFirst({
          where: {
            companyId: session.companyId,
            archivedAt: null,
            cpf: normalizedCpf
          }
        })
      : null;

    if (contact && contactByCpf && contactByCpf.id !== contact.id) {
      return NextResponse.json(
        { error: "Este CPF ja esta cadastrado em outro contato." },
        { status: 409 }
      );
    }

    if (!contact && contactByCpf) {
      contact = contactByCpf;
    }

    if (
      contact &&
      normalizedCpf &&
      contact.cpf !== normalizedCpf &&
      phoneIdentityMatchType !== "alternate"
    ) {
      contact = await prisma.contact.update({
        where: { id: contact.id },
        data: { cpf: normalizedCpf }
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
          normalizedPhone: contactNormalizedPhone,
          cpf: normalizedCpf || null,
          originId: origin?.id ?? null,
          stageId: stage?.id ?? null,
          temperature: "WARM"
        }
      });

      logContactNameMutationAttempt({
        origin: "criacao_manual_conversa",
        file: "src/app/api/conversations/route.ts",
        functionName: "POST /api/conversations",
        contactId: contact.id,
        phone: contact.phone,
        oldName: null,
        newName: contact.name,
        reason: "novo contato criado pelo modal iniciar conversa",
        allowed: true
      });
    }

    if (!contact) {
      return NextResponse.json(
        { error: "Informe um contato ou telefone valido." },
        { status: 400 }
      );
    }

    const requestedChannelId = body?.channelId?.trim();
    const channel = requestedChannelId
      ? await prisma.channel.findFirst({
          where: {
            id: requestedChannelId,
            companyId: session.companyId,
            type: "whatsapp",
            provider: "meta",
            status: { in: ["ACTIVE", "CONNECTED"] }
          }
        })
      : await prisma.channel.findMany({
          where: {
            companyId: session.companyId,
            type: "whatsapp",
            provider: "meta",
            status: { in: ["ACTIVE", "CONNECTED"] }
          },
          take: 2
        });

    if (requestedChannelId && !channel) {
      return NextResponse.json(
        { error: "Canal Meta nao encontrado ou indisponivel." },
        { status: 404 }
      );
    }

    if (!requestedChannelId && Array.isArray(channel) && channel.length === 0) {
      return NextResponse.json(
        { error: "Nenhum canal Meta elegivel encontrado para iniciar conversa." },
        { status: 400 }
      );
    }

    if (!requestedChannelId && Array.isArray(channel) && channel.length > 1) {
      return NextResponse.json(
        { error: "Selecione um canal WhatsApp para iniciar conversa." },
        { status: 409 }
      );
    }

    const resolvedChannel = Array.isArray(channel) ? channel[0] : channel;
    if (!resolvedChannel) {
      return NextResponse.json(
        { error: "Canal Meta nao encontrado ou indisponivel." },
        { status: 404 }
      );
    }

    const { conversation, created } = (await findOrCreateConversationForChannel({
      db: prisma,
      companyId: session.companyId,
      contactId: contact.id,
      channelId: resolvedChannel.id,
      agentId: session.id,
      status: body?.status ?? "OPEN",
      summary: body?.summary?.trim() || null,
      statuses: ["OPEN", "PENDING", "BOT", "SOLD"],
      include: conversationInclude,
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" }
      ],
      withCreated: true
    })) as { conversation: ConversationWithInclude; created: boolean };

    if (!created) {
      return NextResponse.json({ conversation: mapConversation(conversation) });
    }

    await maybeAutoAssignConversation({
      companyId: session.companyId,
      conversationId: conversation.id
    });

    const finalConversation = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: conversationInclude
    });

    return NextResponse.json(
      { conversation: mapConversation(finalConversation ?? conversation) },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel criar conversa." },
      { status: 500 }
    );
  }
}
