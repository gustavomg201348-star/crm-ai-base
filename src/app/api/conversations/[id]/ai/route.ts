import { NextResponse, type NextRequest } from "next/server";
import { generateAiSuggestion } from "@/lib/ai-attendant.service";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: { id: string };
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: context.params.id,
        contact: { companyId: session.companyId }
      }
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    const { suggestion, conversation: updatedConversation } = await generateAiSuggestion({
      conversationId: conversation.id,
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
