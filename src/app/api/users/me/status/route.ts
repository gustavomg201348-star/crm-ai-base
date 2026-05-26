import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeAvailabilityStatus,
  setAttendantStatus
} from "@/lib/lead-assignment";
import { getSessionOrUnauthorized } from "@/lib/permissions";

export async function PATCH(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const body = (await request.json().catch(() => null)) as
      | { status?: string }
      | null;

    const result = await setAttendantStatus({
      companyId: session.companyId,
      userId: session.id,
      status: normalizeAvailabilityStatus(body?.status)
    });

    return NextResponse.json({ status: result });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar disponibilidade." },
      { status: 500 }
    );
  }
}
