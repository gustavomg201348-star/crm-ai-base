import { NextResponse, type NextRequest } from "next/server";
import {
  AiReplyProviderError,
  AiReplyProviderTimeoutError,
  AiReplyProviderUnavailableError,
  type AiSuggestion
} from "@/lib/ai-attendant.service";
import {
  AiResponseContextNotFoundError,
  type AiResponseContext,
  InvalidAiResponseReplyError
} from "@/lib/ai-response-context";
import {
  AI_REPLY_PROMPT_VERSION,
  InvalidAiReplyRequestError,
  InvalidAiReplyResponseError,
  parseAiReplyRequestBody
} from "@/lib/ai-response-schema";
import type { SessionUser } from "@/lib/auth";
import type { ConversationAccessResult } from "@/lib/conversation-access-control";
import { rateLimitPolicies } from "@/lib/rate-limit";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type AiReplyRouteDependencies = {
  getSession(request: NextRequest): Promise<SessionUser | null>;
  enforceLimits(
    limits: Array<{
      category: string;
      identifiers: string[];
      limit: number;
      windowMs: number;
    }>
  ): Promise<NextResponse | null>;
  resolveAccess(input: {
    session: SessionUser;
    conversationId: string;
  }): Promise<ConversationAccessResult>;
  buildContext(input: {
    companyId: string;
    conversationId: string;
    replyToMessageId?: string | null;
  }): Promise<AiResponseContext>;
  generateSuggestion(input: { context: AiResponseContext }): Promise<AiSuggestion>;
};

export function createAiReplyPostHandler(dependencies: AiReplyRouteDependencies) {
  return async function handlePost(request: NextRequest, context: RouteContext) {
    try {
      const session = await dependencies.getSession(request);
      if (!session) {
        return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
      }

      const limited = await dependencies.enforceLimits([
        {
          category: "ai",
          identifiers: [session.companyId, session.id],
          ...rateLimitPolicies.ai
        }
      ]);
      if (limited) return limited;

      const rawBody = await request.text();
      let body: { replyToMessageId?: string | null };
      try {
        body = parseAiReplyRequestBody(rawBody);
      } catch (error) {
        if (!(error instanceof InvalidAiReplyRequestError)) throw error;
        return NextResponse.json({ error: "Requisicao invalida." }, { status: 400 });
      }

      const conversationId = (await context.params).id;
      const access = await dependencies.resolveAccess({ session, conversationId });
      if (access.status === "not_found") {
        return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
      }
      if (access.status === "forbidden") {
        return NextResponse.json(
          { error: "Conversa atribuida a outro atendente." },
          { status: 403 }
        );
      }

      const aiContext = await dependencies.buildContext({
        conversationId: access.conversation.id,
        companyId: session.companyId,
        replyToMessageId:
          typeof body.replyToMessageId === "string" ? body.replyToMessageId : null
      });
      const suggestion = await dependencies.generateSuggestion({ context: aiContext });

      return NextResponse.json({
        analysis: suggestion,
        suggestion,
        promptVersion: AI_REPLY_PROMPT_VERSION
      });
    } catch (error) {
      if (error instanceof InvalidAiResponseReplyError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof AiResponseContextNotFoundError) {
        return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
      }
      if (error instanceof AiReplyProviderUnavailableError) {
        return NextResponse.json({ error: "Provedor de IA indisponivel." }, { status: 503 });
      }
      if (error instanceof AiReplyProviderTimeoutError) {
        return NextResponse.json({ error: "Tempo limite da IA excedido." }, { status: 504 });
      }
      if (
        error instanceof AiReplyProviderError ||
        error instanceof InvalidAiReplyResponseError
      ) {
        return NextResponse.json({ error: "Resposta da IA indisponivel." }, { status: 502 });
      }
      return NextResponse.json(
        { error: "Nao foi possivel gerar analise IA." },
        { status: 500 }
      );
    }
  };
}
