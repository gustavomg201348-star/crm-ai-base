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
      select: { id: true }
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campanha nao encontrada." }, { status: 404 });
    }

    await prisma.campaignRecipient.updateMany({
      where: { campaignId: campaign.id, status: "PENDING" },
      data: {
        status: "CANCELED",
        failedAt: new Date(),
        errorMessage: "Campanha cancelada antes do envio."
      }
    });

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "CANCELED", finishedAt: new Date() },
      include: campaignInclude
    });

    return NextResponse.json({ campaign: mapCampaign(updated) });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel cancelar campanha." },
      { status: 500 }
    );
  }
}
