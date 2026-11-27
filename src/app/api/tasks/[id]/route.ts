import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { updateAgendaTask } from "@/lib/agenda.service";
import { agendaBody, agendaFailure } from "@/lib/agenda-http";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    return NextResponse.json(await updateAgendaTask(prisma, actor, (await params).id, await agendaBody(request)),
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agendaFailure(error); }
}
