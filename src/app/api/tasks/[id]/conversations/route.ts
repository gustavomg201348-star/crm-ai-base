import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { conversationVisibilityWhere } from "@/lib/permissions";
import { taskScope } from "@/lib/agenda-policy";
import { AgendaError } from "@/lib/agenda.service";
import { agendaFailure } from "@/lib/agenda-http";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const task = await prisma.task.findFirst({ where: { AND: [taskScope(actor), { id: (await params).id }] }, select: { contactId: true } });
    if (!task) throw new AgendaError("NOT_FOUND", 404);
    const conversations = await prisma.conversation.findMany({ where: { contactId: task.contactId, contact: { companyId: actor.companyId },
      ...conversationVisibilityWhere(actor), channel: { not: "OPEN_CREDIT" } },
      select: { id: true, channel: true, status: true, channelRef: { select: { name: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 50 });
    return NextResponse.json({ conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agendaFailure(error); }
}
