import { NextResponse, type NextRequest } from "next/server";
import { assignConversationToUser } from "@/lib/lead-assignment";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, isAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = {
  params: { id: string };
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (!session) return response;

    const body = (await request.json().catch(() => null)) as
      | { userId?: string }
      | null;
    const assignedToUserId = body?.userId || session.id;

    if (!isAdmin(session) && assignedToUserId !== session.id) {
      return NextResponse.json(
        { error: "Atendente so pode assumir para si mesmo." },
        { status: 403 }
      );
    }

    const target = await prisma.user.findFirst({
      where: {
        id: assignedToUserId,
        companyId: session.companyId,
        role: { in: ["AGENT", "SUPERVISOR", "ADMIN"] }
      },
      select: { id: true }
    });

    if (!target) {
      return NextResponse.json({ error: "Atendente nao encontrado." }, { status: 404 });
    }

    const conversation = await assignConversationToUser({
      companyId: session.companyId,
      conversationId: context.params.id,
      assignedToUserId,
      assignedByUserId: session.id,
      mode: body?.userId && isAdmin(session) ? "ADMIN_MANUAL" : "CLAIM_FIRST",
      force: isAdmin(session)
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "conversation-assign",
      route: "/api/conversations/[id]/assign",
      publicErrorCode: "CONFLICT",
      status: 409,
      conversationId: context.params.id
    });

    return publicErrorResponse({
      code: "CONFLICT",
      status: 409,
      message: "Nao foi possivel assumir atendimento."
    });
  }
}
