import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  claimVisibleOpportunity,
  getNextOpportunityCandidate
} from "@/lib/opportunity-next-service";
import { OpportunityQueueValidationError } from "@/lib/opportunity-queue-service";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NextOpportunityRequestBody = {
  action?: "peek" | "claim";
  conversationId?: string;
  excludeConversationIds?: unknown;
};

function parseBody(body: unknown): NextOpportunityRequestBody {
  if (!body || typeof body !== "object") return {};
  return body as NextOpportunityRequestBody;
}

function parseExcludedConversationIds(body: NextOpportunityRequestBody) {
  const value = body.excludeConversationIds;
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === "string");
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = parseBody(await request.json().catch(() => null));
    const excludeConversationIds = parseExcludedConversationIds(body);

    if (body.action === "claim") {
      const conversationId = body.conversationId?.trim();

      if (!conversationId) {
        return NextResponse.json({ error: "Informe a oportunidade." }, { status: 400 });
      }

      const result = await claimVisibleOpportunity({
        companyId: session.companyId,
        requesterId: session.id,
        requesterName: session.name,
        requesterRole: session.role,
        conversationId,
        excludeConversationIds
      });

      return NextResponse.json({
        opportunity: result.opportunity,
        empty: !result.opportunity,
        scanned: result.scanned,
        skipped: result.skipped,
        claimed: result.claimed,
        claimStatus: result.claimStatus,
        message: result.claimed
          ? "Oportunidade assumida para atendimento."
          : "Essa oportunidade ja foi assumida. Preparamos a proxima opcao."
      });
    }

    const result = await getNextOpportunityCandidate({
      companyId: session.companyId,
      requesterId: session.id,
      requesterName: session.name,
      requesterRole: session.role,
      excludeConversationIds
    });

    if (!result.opportunity) {
      return NextResponse.json({
        opportunity: null,
        empty: true,
        scanned: result.scanned,
        skipped: result.skipped,
        claimed: false,
        message: "Nenhuma oportunidade disponivel para assumir agora."
      });
    }

    return NextResponse.json({
      opportunity: result.opportunity,
      empty: false,
      scanned: result.scanned,
      skipped: result.skipped,
      claimed: false
    });
  } catch (error) {
    if (error instanceof OpportunityQueueValidationError) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
    }

    const session = getSessionFromRequest(request);

    safeLogError("opportunity-next-api", error, {
      route: "/api/opportunities/next",
      operation: "opportunity-next",
      companyId: session?.companyId,
      currentUserId: session?.id
    });

    return NextResponse.json(
      { error: "Nao foi possivel preparar a proxima melhor acao." },
      { status: 500 }
    );
  }
}