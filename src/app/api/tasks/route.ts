import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { mapTask, taskInclude } from "@/lib/tasks";
import { parseAgendaFilters, taskScope } from "@/lib/agenda-policy";
import { createAgendaTask, listAgenda, AgendaError } from "@/lib/agenda.service";
import { agendaBody, agendaFailure } from "@/lib/agenda-http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const params = request.nextUrl.searchParams;
    if (params.get("view") === "agenda") {
      let filters;
      try { filters = parseAgendaFilters(params); } catch { throw new AgendaError("INVALID_REQUEST"); }
      return NextResponse.json(await listAgenda(prisma, actor, filters), { headers: { "Cache-Control": "no-store" } });
    }
    const status = params.get("status") ?? "PENDING";
    if (!["ALL", "PENDING", "DONE", "CANCELLED"].includes(status)) throw new AgendaError("INVALID_REQUEST");
    const tasks = await prisma.task.findMany({ where: { AND: [taskScope(actor),
      { ...(params.get("contactId") ? { contactId: params.get("contactId")! } : {}),
        ...(params.get("assigneeId") ? { assigneeId: params.get("assigneeId")! } : {}),
        ...(status === "ALL" ? {} : { status }) }] }, include: taskInclude,
      orderBy: [{ status: "asc" }, { dueAt: "asc" }, { id: "asc" }], take: 100 });
    return NextResponse.json({ tasks: tasks.map(mapTask) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agendaFailure(error); }
}
export async function POST(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const result = await createAgendaTask(prisma, actor, await agendaBody(request), request.headers.get("idempotency-key"));
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agendaFailure(error); }
}
