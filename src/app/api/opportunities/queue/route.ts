import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import {
  listOpportunityQueue,
  OpportunityQueueValidationError
} from "@/lib/opportunity-queue-service";
import {
  parseOpportunityQueueSearchParams,
  OpportunityQueueQueryValidationError
} from "@/lib/opportunity-queue-query";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const filters = parseOpportunityQueueSearchParams(request.nextUrl.searchParams);

    const result = await listOpportunityQueue({
      companyId: session.companyId,
      requesterId: session.id,
      requesterRole: session.role,
      ownerId: filters.ownerId,
      priority: filters.priority,
      productType: filters.productType,
      limit: filters.limit,
      cursor: filters.cursor
    });

    return NextResponse.json(result);
  } catch (error) {
    if (
      error instanceof OpportunityQueueValidationError ||
      error instanceof OpportunityQueueQueryValidationError
    ) {
      return NextResponse.json({ error: "Parametros invalidos." }, { status: 400 });
    }

    safeLogError("opportunity-queue-api", error, {
      route: "/api/opportunities/queue",
      operation: "opportunity-queue-list"
    });

    return NextResponse.json(
      { error: "Nao foi possivel carregar a fila de oportunidades." },
      { status: 500 }
    );
  }
}
