import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";
import { getRetirementLead, updateRetirementLead } from "@/lib/retirement-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { session, response } = getSessionOrUnauthorized(request);
  if (response) return response;

  const lead = await getRetirementLead(session.companyId, params.id);
  if (!lead) {
    return NextResponse.json({ error: "Lead nao encontrado." }, { status: 404 });
  }

  return NextResponse.json({ lead });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ error: "Dados invalidos." }, { status: 400 });
    }

    const lead = await updateRetirementLead({
      companyId: session.companyId,
      userId: session.id,
      id: params.id,
      data: body
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead nao encontrado." }, { status: 404 });
    }

    return NextResponse.json({ lead });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel atualizar o lead."
      },
      { status: 500 }
    );
  }
}
