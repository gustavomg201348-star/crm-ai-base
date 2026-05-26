import { NextResponse, type NextRequest } from "next/server";
import { assignConversationToUser } from "@/lib/lead-assignment";
import { prisma } from "@/lib/db";
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

    const body = (await request.json().catch(() => null)) as
      | { userId?: string }
      | null;

    if (!body?.userId) {
      return NextResponse.json({ error: "Informe o atendente." }, { status: 400 });
    }

    const target = await prisma.user.findFirst({
      where: {
        id: body.userId,
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
      assignedToUserId: target.id,
      assignedByUserId: session.id,
      mode: "ADMIN_MANUAL",
      force: true
    });

    return NextResponse.json({ conversation });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel transferir atendimento."
      },
      { status: 500 }
    );
  }
}
