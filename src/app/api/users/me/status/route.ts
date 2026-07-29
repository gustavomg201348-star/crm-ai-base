import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeAvailabilityStatus,
  setAttendantStatus
} from "@/lib/lead-assignment";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

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
  } catch (error) {
    const { session } = getSessionOrUnauthorized(request);

    safeLogError("http-api", error, {
      route: "/api/users/me/status",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "USER_SETTINGS_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_SETTINGS_UPDATE_FAILED", status: 500 });
  }
}
