import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized } from "@/lib/permissions";
import {
  createRetirementLeadEvent,
  listRetirementLeadEvents
} from "@/lib/retirement-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapEvent(event: Awaited<ReturnType<typeof createRetirementLeadEvent>>) {
  if (!event) return null;
  return {
    id: event.id,
    eventType: event.eventType,
    description: event.description,
    createdAt: event.createdAt,
    createdBy: event.createdBy
      ? { id: event.createdBy.id, name: event.createdBy.name, email: event.createdBy.email }
      : null
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, response } = getSessionOrUnauthorized(request);
  if (response) return response;

  const events = await listRetirementLeadEvents(session.companyId, params.id);
  if (!events) {
    return NextResponse.json({ error: "Lead nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    events: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      description: event.description,
      createdAt: event.createdAt,
      createdBy: event.createdBy
        ? { id: event.createdBy.id, name: event.createdBy.name, email: event.createdBy.email }
        : null
    }))
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const body = (await request.json().catch(() => null)) as
      | { eventType?: string; description?: string | null }
      | null;

    const event = await createRetirementLeadEvent({
      companyId: session.companyId,
      userId: session.id,
      retirementLeadId: params.id,
      eventType: body?.eventType ?? "NOTE",
      description: body?.description
    });

    if (!event) {
      return NextResponse.json({ error: "Lead nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ event: mapEvent(event) }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel registrar evento." },
      { status: 500 }
    );
  }
}
