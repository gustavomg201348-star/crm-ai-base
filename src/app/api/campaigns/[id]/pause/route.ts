import { NextResponse, type NextRequest } from "next/server";
import { campaignInclude, mapCampaign } from "@/lib/campaigns";
import { prisma } from "@/lib/db";
import { getSessionOrUnauthorized, requireAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { session, response } = getSessionOrUnauthorized(request);
    if (response) return response;

    const blocked = requireAdmin(session);
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
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel pausar campanha." },
      { status: 500 }
    );
  }
}
