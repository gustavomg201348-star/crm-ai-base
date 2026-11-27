import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth";
import { contactSelection } from "@/lib/agenda.service";
import { agendaFailure } from "@/lib/agenda-http";

export async function GET(request: NextRequest) {
  try {
    const actor = await getSessionFromRequest(request);
    if (!actor) return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    const contacts = await prisma.contact.findMany({ where: contactSelection(actor, request.nextUrl.searchParams.get("search") ?? ""),
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 20 });
    return NextResponse.json({ contacts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return agendaFailure(error); }
}
