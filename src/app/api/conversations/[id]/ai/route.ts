import { NextResponse, type NextRequest } from "next/server";
import { analyzeConversation } from "@/lib/ai-analysis";
import { getSessionFromRequest } from "@/lib/auth";
import { conversationInclude, mapConversation } from "@/lib/conversations";
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
      },
      include: conversationInclude
    });

    if (!conversation) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    const analysis = analyzeConversation(conversation);

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        summary: `${analysis.summary}\n\nProxima acao: ${analysis.nextAction}`,
        contact: {
          update: {
            temperature: analysis.temperature,
            lastMessage: analysis.nextAction
          }
        }
      },
      include: conversationInclude
    });

    return NextResponse.json({
      analysis,
      conversation: mapConversation(updated)
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel gerar analise IA." },
      { status: 500 }
    );
  }
}
