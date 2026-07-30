import { NextResponse, type NextRequest } from "next/server";
import {
  getLeadAssignmentSettings,
  normalizeAssignmentMode,
  updateLeadAssignmentSettings
} from "@/lib/lead-assignment";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const settings = await getLeadAssignmentSettings(session.companyId);
    return NextResponse.json({ settings });
  } catch (error) {
    const { session } = getSessionOrUnauthorized(request);

    safeLogError("http-api", error, {
      route: "/api/settings/lead-assignment",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireCompanyAdmin(session);
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
  } catch (error) {
    const { session } = getSessionOrUnauthorized(request);

    safeLogError("http-api", error, {
      route: "/api/settings/lead-assignment",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "USER_SETTINGS_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_SETTINGS_UPDATE_FAILED", status: 500 });
  }
}
