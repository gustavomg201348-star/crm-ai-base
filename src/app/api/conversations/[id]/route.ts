import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { markCommercialObservationStale } from "@/lib/commercial-observer-persistence";
import {
  conversationInclude,
  mapConversation,
  type ConversationStatus
} from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { canAccessConversation } from "@/lib/permissions";

type RouteContext = {
  params: { id: string };
};

async function findOwnedConversation(id: string, companyId: string) {
  return prisma.conversation.findFirst({
    where: {
      id,
      contact: { companyId }
    },
    include: conversationInclude
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const conversation = await findOwnedConversation(
      context.params.id,
      session.companyId
    );

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: conversation.agentId })) {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    return NextResponse.json({ conversation: mapConversation(conversation) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar conversa." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const existing = await findOwnedConversation(context.params.id, session.companyId);

    if (!existing) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: existing.agentId })) {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          status?: ConversationStatus;
          summary?: string | null;
        }
      | null;

    const conversation = await prisma.conversation.update({
      where: { id: existing.id },
      data: {
        ...(body?.status ? { status: body.status } : {}),
        ...(body?.summary !== undefined
          ? { summary: body.summary?.trim() || null }
          : {})
      },
      include: conversationInclude
    });

    if (body?.status && body.status !== existing.status) {
      await markCommercialObservationStale({
        companyId: session.companyId,
        conversationId: conversation.id,
        sourceUpdatedAt: conversation.updatedAt
      });
    }

    return NextResponse.json({ conversation: mapConversation(conversation) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar conversa." },
      { status: 500 }
    );
  }
}
