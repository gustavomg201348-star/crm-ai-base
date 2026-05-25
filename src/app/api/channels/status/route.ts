import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

type MetaPhoneStatus = {
  ok: boolean;
  displayPhone?: string | null;
  verifiedName?: string | null;
  qualityRating?: string | null;
  error?: string | null;
};

async function checkMetaPhone({
  phoneNumberId,
  accessToken
}: {
  phoneNumberId?: string | null;
  accessToken?: string | null;
}): Promise<MetaPhoneStatus> {
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: "Phone Number ID ou token ausente." };
  }

  const apiVersion = process.env.META_GRAPH_VERSION || "v20.0";
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store"
    }
  );
  const data = (await response.json().catch(() => null)) as
    | {
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
        error?: { message?: string };
      }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      error: data?.error?.message ?? "Falha ao consultar Meta Graph API."
    };
  }

  return {
    ok: true,
    displayPhone: data?.display_phone_number ?? null,
    verifiedName: data?.verified_name ?? null,
    qualityRating: data?.quality_rating ?? null
  };
}

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const channels = await prisma.channel.findMany({
      where: { companyId: session.companyId, type: "whatsapp" },
      orderBy: { createdAt: "asc" }
    });
    const origin = request.nextUrl.origin;
    const webhookUrl = `${origin}/api/webhooks/whatsapp`;

    const statuses = await Promise.all(
      channels.map(async (channel) => {
        const channelKey = `whatsapp:${channel.id}`;
        const [lastConversation, inboundCount, outboundCount, meta] = await Promise.all([
          prisma.conversation.findFirst({
            where: {
              channel: channelKey,
              contact: { companyId: session.companyId }
            },
            include: {
              contact: { select: { name: true, phone: true } },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { body: true, direction: true, status: true, createdAt: true }
              }
            },
            orderBy: { updatedAt: "desc" }
          }),
          prisma.message.count({
            where: {
              direction: "inbound",
              conversation: {
                channel: channelKey,
                contact: { companyId: session.companyId }
              }
            }
          }),
          prisma.message.count({
            where: {
              direction: "outbound",
              conversation: {
                channel: channelKey,
                contact: { companyId: session.companyId }
              }
            }
          }),
          channel.provider === "meta"
            ? checkMetaPhone({
                phoneNumberId: channel.phoneNumberId,
                accessToken: channel.accessToken
              })
            : Promise.resolve<MetaPhoneStatus>({ ok: channel.status === "ACTIVE" })
        ]);

        const checks = {
          active: ["ACTIVE", "CONNECTED"].includes(channel.status),
          phoneNumberId: Boolean(channel.phoneNumberId),
          wabaId: Boolean(channel.wabaId),
          accessToken: Boolean(channel.accessToken),
          verifyToken: Boolean(channel.verifyToken || process.env.META_VERIFY_TOKEN),
          appSecret: Boolean(channel.appSecret || process.env.META_APP_SECRET),
          metaReachable: meta.ok
        };
        const ready =
          channel.provider !== "meta"
            ? checks.active
            : checks.active &&
              checks.phoneNumberId &&
              checks.wabaId &&
              checks.accessToken &&
              checks.verifyToken &&
              checks.metaReachable;
        const warnings = [
          !checks.active ? "Canal inativo." : null,
          channel.provider === "meta" && !checks.phoneNumberId
            ? "Phone Number ID ausente."
            : null,
          channel.provider === "meta" && !checks.wabaId ? "WABA ID ausente." : null,
          channel.provider === "meta" && !checks.accessToken ? "Token ausente." : null,
          channel.provider === "meta" && !checks.verifyToken
            ? "Verify token ausente."
            : null,
          channel.provider === "meta" && !checks.appSecret
            ? "App secret ausente. Assinatura do webhook nao esta validando."
            : null,
          channel.provider === "meta" && !checks.metaReachable ? meta.error : null
        ].filter(Boolean);

        return {
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          status: channel.status,
          displayPhone: channel.displayPhone ?? meta.displayPhone ?? null,
          phoneNumberId: channel.phoneNumberId,
          wabaId: channel.wabaId,
          webhookUrl,
          ready,
          checks,
          meta: {
            ok: meta.ok,
            verifiedName: meta.verifiedName ?? null,
            qualityRating: meta.qualityRating ?? null,
            error: meta.error ?? null
          },
          metrics: {
            inboundCount,
            outboundCount,
            lastActivityAt:
              lastConversation?.messages[0]?.createdAt?.toISOString() ??
              lastConversation?.updatedAt?.toISOString() ??
              null,
            lastDirection: lastConversation?.messages[0]?.direction ?? null,
            lastMessagePreview: lastConversation?.messages[0]?.body ?? null,
            lastMessageStatus: lastConversation?.messages[0]?.status ?? null,
            lastContactName: lastConversation?.contact.name ?? null,
            lastContactPhone: lastConversation?.contact.phone ?? null
          },
          warnings
        };
      })
    );

    return NextResponse.json({
      webhookUrl,
      channels: statuses,
      summary: {
        total: statuses.length,
        ready: statuses.filter((item) => item.ready).length,
        withWarnings: statuses.filter((item) => item.warnings.length > 0).length
      }
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar status dos canais." },
      { status: 500 }
    );
  }
}
