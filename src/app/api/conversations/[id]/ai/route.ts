import { NextResponse, type NextRequest } from "next/server";
import { generateAiSuggestion } from "@/lib/ai-attendant.service";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { prisma } from "@/lib/db";
import { enforceRateLimits, rateLimitPolicies } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const access = await resolveConversationAccess({
      db: prisma,
      session,
      conversationId: (await context.params).id
    });

    if (access.status === "not_found") {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (access.status === "forbidden") {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const limited = await enforceRateLimits([
      {
        category: "ai",
        identifiers: [session.companyId, session.id],
        ...rateLimitPolicies.ai
      }
    ]);
    if (limited) return limited;

    const { suggestion, conversation: updatedConversation } = await generateAiSuggestion({
      conversationId: access.conversation.id,
      companyId: session.companyId
    });

    return NextResponse.json({
      analysis: suggestion,
      suggestion,
      conversation: updatedConversation
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel gerar analise IA." },
      { status: 500 }
    );
  }
}
