import { NextResponse, type NextRequest } from "next/server";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";
import {
  createRetirementLead,
  listRetirementLeads
} from "@/lib/retirement-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const result = await listRetirementLeads({
      companyId: session.companyId,
      searchParams: request.nextUrl.searchParams
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel listar recem-aposentados."
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as
      | {
          contactId?: string;
          grantDate?: string | null;
          benefitType?: string | null;
          benefitNumber?: string | null;
          state?: string | null;
          city?: string | null;
          desiredAmount?: string | number | null;
          interestLevel?: string | null;
          hasCorrespondent?: boolean | null;
          score?: number | null;
          journeyStatus?: string | null;
          nextContactDate?: string | null;
          lastContactDate?: string | null;
          notes?: string | null;
        }
      | null;

    if (!body?.contactId) {
      return NextResponse.json(
        { error: "Contato e obrigatorio para criar o lead." },
        { status: 400 }
      );
    }

    const lead = await createRetirementLead({
      companyId: session.companyId,
      userId: session.id,
      contactId: body.contactId,
      data: body
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel criar o lead recem-aposentado."
      },
      { status: 500 }
    );
  }
}
