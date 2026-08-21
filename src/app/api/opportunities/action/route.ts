import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  parseLifecycleAction,
  recordNextBestAction
} from "@/lib/next-best-action-lifecycle-service";
import { NextBestActionError } from "@/lib/opportunity-next-service";
import { OpportunityQueueValidationError } from "@/lib/opportunity-queue-service";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ActionRequestBody = {
  action?: unknown;
  conversationId?: unknown;
  idempotencyKey?: unknown;
  reason?: unknown;
  outcome?: unknown;
};

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as ActionRequestBody | null;
    const action = parseLifecycleAction(body?.action);
    const conversationId = readString(body?.conversationId);
    const idempotencyKey = readString(body?.idempotencyKey);

    if (!action) {
      return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
    }

    if (!conversationId) {
      return NextResponse.json({ error: "Informe a oportunidade." }, { status: 400 });
    }

    if (!idempotencyKey) {
      return NextResponse.json({ error: "Informe a chave da acao." }, { status: 400 });
    }

    const result = await recordNextBestAction({
      companyId: session.companyId,
      requesterId: session.id,
      requesterRole: session.role,
      conversationId,
      action,
      idempotencyKey,
      reason: readString(body?.reason),
      outcome: readString(body?.outcome)
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NextBestActionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    if (error instanceof OpportunityQueueValidationError) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
    }

    const session = getSessionFromRequest(request);

    safeLogError("opportunity-action-api", error, {
      route: "/api/opportunities/action",
      operation: "opportunity-action",
      companyId: session?.companyId,
      currentUserId: session?.id
    });

    return NextResponse.json(
      { error: "Nao foi possivel registrar a acao da oportunidade." },
      { status: 500 }
    );
  }
}
