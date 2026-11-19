import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { activityInclude, mapActivity } from "@/lib/activities";
import { prisma } from "@/lib/db";
import { forbidden, isAdmin } from "@/lib/permissions";
import { publicErrorResponse } from "@/lib/http-error-response";
import { safeLogError } from "@/lib/safe-logger";

type RouteContext = { params: Promise<{ id: string }> };
type Session = NonNullable<Awaited<ReturnType<typeof getSessionFromRequest>>>;

async function editableContact(id: string, session: Session) {
  const contact = await prisma.contact.findFirst({
    where: { id, companyId: session.companyId },
    select: { id: true, ownerId: true, internalNote: true }
  });
  if (!contact) return null;
  if (isAdmin(session) || contact.ownerId === session.id) return contact;
  const assigned = await prisma.conversation.findFirst({
    where: { contactId: contact.id, agentId: session.id, contact: { companyId: session.companyId } },
    select: { id: true }
  });
  return assigned ? contact : false;
}

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const { id } = await context.params;
    const contact = await prisma.contact.findFirst({
      where: { id, companyId: session.companyId },
      select: { id: true }
    });
    if (!contact) return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });

    const notes = await prisma.contactActivity.findMany({
      where: { contactId: id, type: "INTERNAL_NOTE" },
      include: activityInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50
    });
    return NextResponse.json({ notes: notes.map(mapActivity) });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contact-internal-notes-read",
      route: "/api/contacts/[id]/notes",
      publicErrorCode: "INTERNAL_NOTES_READ_FAILED",
      status: 500
    });
    return publicErrorResponse({
      code: "INTERNAL_NOTES_READ_FAILED",
      status: 500,
      message: "Nao foi possivel carregar as observacoes."
    });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    const { id } = await context.params;
    const contact = await editableContact(id, session);
    if (contact === null) return NextResponse.json({ error: "Contato nao encontrado." }, { status: 404 });
    if (contact === false) return forbidden("Voce nao tem permissao para adicionar observacoes neste contato.");

    const body = await request.json().catch(() => null) as { note?: unknown } | null;
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) return NextResponse.json({ error: "Digite uma observacao." }, { status: 400 });
    if (note.length > 2000) {
      return NextResponse.json({ error: "A observacao deve ter no maximo 2000 caracteres." }, { status: 400 });
    }

    const created = await prisma.$transaction(async tx => {
      const hasHistory = await tx.contactActivity.findFirst({
        where: { contactId: id, type: "INTERNAL_NOTE" },
        select: { id: true }
      });
      if (!hasHistory && contact.internalNote?.trim()) {
        await tx.contactActivity.create({
          data: {
            contactId: id,
            userId: null,
            type: "INTERNAL_NOTE",
            title: "Observacao anterior",
            detail: contact.internalNote.trim()
          }
        });
      }

      const activity = await tx.contactActivity.create({
        data: {
          contactId: id,
          userId: session.id,
          type: "INTERNAL_NOTE",
          title: "Observacao interna",
          detail: note
        },
        include: activityInclude
      });
      await tx.contact.update({ where: { id }, data: { internalNote: note } });
      return activity;
    });

    return NextResponse.json({ note: mapActivity(created) }, { status: 201 });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "contact-internal-note-create",
      route: "/api/contacts/[id]/notes",
      publicErrorCode: "INTERNAL_NOTE_CREATE_FAILED",
      status: 500
    });
    return publicErrorResponse({
      code: "INTERNAL_NOTE_CREATE_FAILED",
      status: 500,
      message: "Nao foi possivel salvar a observacao."
    });
  }
}
