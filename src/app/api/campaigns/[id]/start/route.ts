import { NextResponse, type NextRequest } from "next/server";
import { mapCampaign, processCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const campaign = await prisma.campaign.findFirst({
      where: { id: params.id, companyId: session.companyId },
      select: { id: true }
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
    }

    const processed = await processCampaign(campaign.id);
    return NextResponse.json({ campaign: mapCampaign(processed) });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Nao foi possivel iniciar campanha."
      },
      { status: 500 }
    );
  }
}
