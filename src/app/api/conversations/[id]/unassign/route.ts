import { NextResponse, type NextRequest } from "next/server";
import { unassignConversation } from "@/lib/lead-assignment";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { session, response } = await getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const conversation = await unassignConversation({
      companyId: session.companyId,
      conversationId: (await context.params).id,
      assignedByUserId: session.id
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "conversation-unassign",
      route: "/api/conversations/[id]/unassign",
      publicErrorCode: "INTERNAL_ERROR",
      status: 500,
      conversationId: (await context.params).id
    });

    return publicErrorResponse({
      code: "INTERNAL_ERROR",
      status: 500,
      message: "Nao foi possivel devolver atendimento para fila."
    });
  }
}
