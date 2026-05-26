import { NextResponse, type NextRequest } from "next/server";
import {
  normalizeAvailabilityStatus,
  setAttendantStatus
} from "@/lib/lead-assignment";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";
import { prisma } from "@/lib/db";

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
      return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar disponibilidade." },
      { status: 500 }
    );
  }
}
