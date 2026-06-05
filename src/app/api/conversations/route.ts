import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  conversationInclude,
  mapConversation,
  type ConversationStatus
} from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { maybeAutoAssignConversation } from "@/lib/lead-assignment";
import { conversationVisibilityWhere, isAdmin } from "@/lib/permissions";
import {
  findContactByNormalizedPhone,
  logContactNameMutationAttempt,
  normalizeContactCpf,
  normalizeContactPhone
} from "@/lib/contacts";

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

    const conversations = await prisma.conversation.findMany({
      where: {
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
        ...(status === "ALL" ? {} : { status })
      },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
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
          cpf?: string;
          status?: ConversationStatus;
          summary?: string;
        }
      | null;

    const phone = body?.phone?.trim();
    const normalizedPhone = normalizeContactPhone(phone);
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

    if (!contact && normalizedPhone) {
      contact = await findContactByNormalizedPhone(prisma, {
        companyId: session.companyId,
        phone: normalizedPhone
      });

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

    if (contact && normalizedCpf && contact.cpf !== normalizedCpf) {
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

    const existingConversation = await prisma.conversation.findFirst({
      where: {
        contactId: contact.id,
        status: { not: "RESOLVED" }
      },
      include: conversationInclude,
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }]
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
