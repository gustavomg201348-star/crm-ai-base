import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { processEligibleCommercialObservations } from "@/lib/commercial-observer-processing";
import { requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidInternalToken(request: NextRequest) {
  const expected = process.env.INTERNAL_JOB_SECRET?.trim();
  if (!expected) return false;
  const provided = request.headers.get("x-internal-job-secret")?.trim();
  return provided === expected;
}

export async function POST(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!hasValidInternalToken(request)) {
      if (!session) {
        return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
      }

      const blocked = requireAdmin(session);
      if (blocked) return blocked;
    }

    const body = (await request.json().catch(() => null)) as { limit?: number } | null;
    const result = await processEligibleCommercialObservations({
      limit: body?.limit
    });

    return NextResponse.json(result);
  } catch (error) {
    safeLogError("commercial-observer-processing-api", error, {
      route: "/api/internal/commercial-observer/process",
      operation: "commercial-observer-process"
    });

    return NextResponse.json(
      { error: "Nao foi possivel processar observacoes comerciais." },
      { status: 500 }
    );
  }
}
