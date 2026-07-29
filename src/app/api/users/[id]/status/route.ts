import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeAvailabilityStatus,
  setAttendantStatus
} from "@/lib/lead-assignment";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const user = await prisma.user.findFirst({
      where: { id: context.params.id, companyId: session.companyId },
      select: { id: true }
    });

    if (!user) {
      return publicErrorResponse({ code: "USER_NOT_FOUND", status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { status?: string }
      | null;
    const result = await setAttendantStatus({
      companyId: session.companyId,
      userId: user.id,
      status: normalizeAvailabilityStatus(body?.status)
    });

    return NextResponse.json({ status: result });
  } catch (error) {
    const { session } = getSessionOrUnauthorized(request);

    safeLogError("http-api", error, {
      route: "/api/users/[id]/status",
      method: "PATCH",
      companyId: session?.companyId,
      currentUserId: session?.id,
      targetUserId: context.params.id,
      publicErrorCode: "USER_SETTINGS_UPDATE_FAILED",
      status: 500
    });

    return publicErrorResponse({ code: "USER_SETTINGS_UPDATE_FAILED", status: 500 });
  }
}
