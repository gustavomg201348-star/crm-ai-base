import { NextResponse, type NextRequest } from "next/server";
import { unassignConversation } from "@/lib/lead-assignment";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";

type RouteContext = {
  params: { id: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const conversation = await unassignConversation({
      companyId: session.companyId,
      conversationId: context.params.id,
      assignedByUserId: session.id
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel devolver atendimento para fila."
      },
      { status: 500 }
    );
  }
}
