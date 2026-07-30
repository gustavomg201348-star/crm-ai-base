import { NextResponse, type NextRequest } from "next/server";
import { campaignInclude, mapCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";

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
      include: campaignInclude
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
    }

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PAUSED" },
      include: campaignInclude
    });

    return NextResponse.json({ campaign: mapCampaign(updated) });
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "campaign-pause",
      route: "/api/campaigns/[id]/pause",
      publicErrorCode: "CAMPAIGN_PAUSE_FAILED",
      status: 500,
      campaignId: params.id
    });

    return publicErrorResponse({
      code: "CAMPAIGN_PAUSE_FAILED",
      status: 500,
      message: "Nao foi possivel pausar campanha."
    });
  }
}
