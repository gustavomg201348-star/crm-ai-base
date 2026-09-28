import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { saveFailedOutboundMessage } from "@/lib/message-delivery";
import { canAccessConversation } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import { enforceRateLimits, rateLimitPolicies } from "@/lib/rate-limit";
import { sendConversationTemplate } from "@/lib/whatsapp-template.service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  let authorizedConversation: { id: string; companyId: string } | null = null;

  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          templateName?: string;
          language?: string;
          variables?: string[];
        }
      | null;

    if (!body?.templateName || !body.language) {
      return NextResponse.json(
        { error: "Template e idioma sao obrigatorios." },
        { status: 400 }
      );
    }

    const current = await prisma.conversation.findFirst({
      where: { id: (await context.params).id, contact: { companyId: session.companyId } },
      select: { agentId: true }
    });

    if (!current) {
      return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
    }

    if (!canAccessConversation({ session, agentId: current.agentId })) {
      return NextResponse.json({ error: "Conversa atribuida a outro atendente." }, { status: 403 });
    }

    const limited = await enforceRateLimits([
      {
        category: "message-send",
        identifiers: [session.companyId, session.id],
        ...rateLimitPolicies.messageSend
      }
    ]);
    if (limited) return limited;

    authorizedConversation = { id: (await context.params).id, companyId: session.companyId };

    const conversation = await sendConversationTemplate({
      conversationId: (await context.params).id,
      companyId: session.companyId,
      userId: session.id,
      templateName: body.templateName,
      language: body.language,
      variables: body.variables ?? []
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    const message = "Falha ao enviar template.";

    if (authorizedConversation) {
      await saveFailedOutboundMessage({
        companyId: authorizedConversation.companyId,
        conversationId: authorizedConversation.id,
        body: "Falha ao enviar template.",
        type: "template",
        errorMessage: message
      }).catch(() => null);
    }

    safeLogError("http-api", error, {
      operation: "conversation-template-send",
      route: "/api/conversations/[id]/messages/template",
      publicErrorCode: "MESSAGE_SEND_FAILED",
      status: 500,
      conversationId: (await context.params).id
    });

    return publicErrorResponse({
      code: "MESSAGE_SEND_FAILED",
      status: 500,
      message: "Nao foi possivel enviar template."
    });
  }
}
