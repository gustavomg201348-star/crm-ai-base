import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  analyzeConversationWithCommercialObserver,
  CommercialObserverError
} from "@/lib/commercial-observer-service";
import { upsertCommercialObservationResult } from "@/lib/commercial-observer-persistence";
import { requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as { conversationId?: string } | null;
    const conversationId = body?.conversationId?.trim();

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId obrigatorio." }, { status: 400 });
    }

    const { analysis, input } = await analyzeConversationWithCommercialObserver({
      conversationId,
      companyId: session.companyId
    });

    const observation = await upsertCommercialObservationResult({
      companyId: session.companyId,
      conversationId,
      result: analysis,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      sourceUpdatedAt: input.conversation.updatedAt
    });

    return NextResponse.json({
      analysis,
      observation: {
        status: observation.status,
        analyzedAt: observation.analyzedAt,
        sourceUpdatedAt: observation.sourceUpdatedAt,
        structuredResult: observation.structuredResult
      }
    });
  } catch (error) {
    if (error instanceof CommercialObserverError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json({ error: "Conversa nao encontrada." }, { status: 404 });
      }

      if (error.code === "NOT_CONFIGURED") {
        return NextResponse.json({ error: "IA nao configurada." }, { status: 503 });
      }

      return NextResponse.json({ error: "Nao foi possivel analisar a conversa." }, { status: 502 });
    }

    safeLogError("commercial-observer-api", error, {
      route: "/api/commercial-observer/analyze",
      operation: "commercial-observer-analyze"
    });

    return NextResponse.json({ error: "Nao foi possivel analisar a conversa." }, { status: 500 });
  }
}
