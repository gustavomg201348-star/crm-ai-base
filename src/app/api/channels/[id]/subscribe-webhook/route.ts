import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveChannelAccessToken } from "@/lib/channel-secrets";
import { prisma } from "@/lib/db";
import { publicErrorResponse } from "@/lib/http-error-response";
import { requireCompanyAdmin } from "@/lib/permissions";
import { safeLogError } from "@/lib/safe-logger";
import { subscribeMetaWebhook } from "@/lib/meta-whatsapp-diagnostics";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return publicErrorResponse({ code: "UNAUTHENTICATED", status: 401 });
    }
    const blocked = requireCompanyAdmin(session);
    if (blocked) return blocked;

    const { id } = await params;
    const channel = await prisma.channel.findFirst({
      where: { id, companyId: session.companyId, type: "whatsapp", provider: "meta" }
    });

    if (!channel) {
      return publicErrorResponse({ code: "CHANNEL_NOT_FOUND", status: 404 });
    }

    const accessToken = resolveChannelAccessToken(channel.accessToken, {
      channelId: channel.id
    });

    if (!channel.wabaId || !accessToken) {
      return publicErrorResponse({
        code: "CHANNEL_INVALID_INPUT",
        status: 400,
        message: "Canal Meta com configuracao incompleta para assinar webhook."
      });
    }

    const result = await subscribeMetaWebhook({
      wabaId: channel.wabaId,
      accessToken
    });

    if (!result.ok) {
      safeLogError("http-api", new Error("META_WEBHOOK_SUBSCRIBE_FAILED"), {
        operation: "meta-webhook-subscribe",
        route: "/api/channels/[id]/subscribe-webhook",
        publicErrorCode: "META_PROVIDER_ERROR",
        status: 400,
        channelId: channel.id
      });

      return publicErrorResponse({
        code: "META_PROVIDER_ERROR",
        status: 400,
        message: "Nao foi possivel assinar o webhook na Meta."
      });
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
  } catch (error) {
    safeLogError("http-api", error, {
      operation: "meta-webhook-subscribe",
      route: "/api/channels/[id]/subscribe-webhook",
      publicErrorCode: "META_PROVIDER_ERROR",
      status: 500
    });

    return publicErrorResponse({
      code: "META_PROVIDER_ERROR",
      status: 500,
      message: "Nao foi possivel assinar o webhook na Meta."
    });
  }
}
