import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireCompanyAdmin } from "@/lib/permissions";
import { subscribeMetaWebhook } from "@/lib/meta-whatsapp-diagnostics";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const channel = await prisma.channel.findFirst({
      where: { id, companyId: session.companyId, type: "whatsapp", provider: "meta" }
    });

    if (!channel) {
      return NextResponse.json({ error: "Canal Meta nao encontrado." }, { status: 404 });
    }

    if (!channel.wabaId || !channel.accessToken) {
      return NextResponse.json(
        { error: "Informe WABA ID e access token antes de assinar o webhook." },
        { status: 400 }
      );
    }

    const result = await subscribeMetaWebhook({
      wabaId: channel.wabaId,
      accessToken: channel.accessToken
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { lastWebhookSubscribedAt: new Date() },
      select: { id: true, lastWebhookSubscribedAt: true }
    });

    return NextResponse.json({
      ok: true,
      message: "Webhook assinado com sucesso.",
      channel: updated
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel assinar o webhook na Meta." },
      { status: 500 }
    );
  }
}
