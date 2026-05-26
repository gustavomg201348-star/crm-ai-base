import { NextResponse, type NextRequest } from "next/server";
import {
  getLeadAssignmentSettings,
  normalizeAssignmentMode,
  updateLeadAssignmentSettings
} from "@/lib/lead-assignment";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const settings = await getLeadAssignmentSettings(session.companyId);
    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar configuracao de distribuicao." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          mode?: string;
          onlineOnly?: boolean;
          maxOpenPerAttendant?: number | null;
          allowAttendantClaim?: boolean;
          redistributeWhenOffline?: boolean;
        }
      | null;

    const settings = await updateLeadAssignmentSettings({
      companyId: session.companyId,
      data: {
        mode: normalizeAssignmentMode(body?.mode),
        onlineOnly: body?.onlineOnly,
        maxOpenPerAttendant:
          body?.maxOpenPerAttendant === undefined
            ? undefined
            : body.maxOpenPerAttendant && body.maxOpenPerAttendant > 0
              ? body.maxOpenPerAttendant
              : null,
        allowAttendantClaim: body?.allowAttendantClaim,
        redistributeWhenOffline: body?.redistributeWhenOffline
      }
    });

    return NextResponse.json({ settings });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel salvar configuracao de distribuicao." },
      { status: 500 }
    );
  }
}
