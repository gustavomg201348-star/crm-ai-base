import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionOrUnauthorized, requireCompanyAdmin } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
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

    const recipients = await prisma.campaignRecipient.findMany({
      where: { campaignId: campaign.id },
      include: { contact: { select: { id: true, name: true, cpf: true, phone: true } } },
      orderBy: { createdAt: "asc" }
    });

    return NextResponse.json({ recipients });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar destinatarios." },
      { status: 500 }
    );
  }
}
