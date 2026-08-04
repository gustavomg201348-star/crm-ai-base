import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOpportunitySummaryForConversation } from "@/lib/opportunity-summary-service";
import { canAccessConversation } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: context.params.id,
        contact: { companyId: session.companyId, archivedAt: null }
      },
      select: { id: true, agentId: true }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: conversation.agentId })) {
      return NextResponse.json(
        { error: "Conversa atribuida a outro atendente." },
        { status: 403 }
      );
    }

    const summary = await getOpportunitySummaryForConversation({
      companyId: session.companyId,
      conversationId: conversation.id
    });

    if (!summary) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    return NextResponse.json({ summary });
  } catch (error) {
    safeLogError("opportunity-summary-api", error, {
      route: "/api/conversations/[id]/opportunity-summary",
      operation: "opportunity-summary-get",
      conversationId: context.params.id
    });

    return NextResponse.json(
      { error: "Nao foi possivel carregar a oportunidade comercial." },
      { status: 500 }
    );
  }
}
