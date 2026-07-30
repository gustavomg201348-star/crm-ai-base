import { NextResponse, type NextRequest } from "next/server";
import { publicErrorResponse } from "@/lib/http-error-response";
import { listAttendants } from "@/lib/lead-assignment";
import { getSessionOrUnauthorized } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const attendants = await listAttendants(session.companyId);
    return NextResponse.json({ attendants });
  } catch (error) {
    const { session } = getSessionOrUnauthorized(request);

    safeLogError("http-api", error, {
      route: "/api/users/attendants",
      method: "GET",
      companyId: session?.companyId,
      currentUserId: session?.id,
      publicErrorCode: "INTERNAL_ERROR",
      status: 500
    });

    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}
