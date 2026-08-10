import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { getCommercialControlOverview } from "@/lib/commercial-control-service";
import { requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  try {
    const session = getSessionFromRequest(_request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const overview = await getCommercialControlOverview({
      companyId: session.companyId,
      requesterId: session.id,
      requesterRole: session.role
    });

    return NextResponse.json({ overview });
  } catch (error) {
    safeLogError("commercial-control-api", error, {
      route: "/api/commercial-control",
      operation: "commercial-control-overview"
    });

    return NextResponse.json(
      { error: "Nao foi possivel carregar a Sala de Controle." },
      { status: 500 }
    );
  }
}
