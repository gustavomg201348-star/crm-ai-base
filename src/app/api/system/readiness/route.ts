import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }

    const [users, contacts, channels, conversations, messages] = await Promise.all([
      prisma.user.count({ where: { companyId: session.companyId } }),
      prisma.contact.count({ where: { companyId: session.companyId } }),
      prisma.channel.findMany({
        where: { companyId: session.companyId, type: "whatsapp" },
        select: {
          id: true,
          name: true,
          provider: true,
          phoneNumberId: true,
          wabaId: true,
          displayPhone: true,
          accessToken: true,
          verifyToken: true,
          appSecret: true,
          status: true
        },
        orderBy: { createdAt: "asc" }
      }),
      prisma.conversation.count({
        where: { contact: { companyId: session.companyId } }
      }),
      prisma.message.count({
        where: { conversation: { contact: { companyId: session.companyId } } }
      })
    ]);

    const origin = request.nextUrl.origin;
    const webhookUrl = `${origin}/api/webhooks/whatsapp`;
    const metaChannels = channels.filter((channel) => channel.provider === "meta");
    const readyMetaChannels = metaChannels.filter(
      (channel) =>
        channel.phoneNumberId &&
        channel.wabaId &&
        channel.accessToken &&
        (channel.verifyToken || process.env.META_VERIFY_TOKEN) &&
        ["ACTIVE", "CONNECTED"].includes(channel.status)
    );

    return NextResponse.json({
      ok: true,
      app: {
        service: "crm-ai-base",
        environment: process.env.NODE_ENV ?? "unknown",
        timestamp: new Date().toISOString()
      },
      database: {
        ok: true,
        users,
        contacts,
        conversations,
        messages
      },
      whatsapp: {
        webhookUrl,
        totalChannels: channels.length,
        metaChannels: metaChannels.length,
        readyMetaChannels: readyMetaChannels.length,
        channels: channels.map((channel) => ({
          id: channel.id,
          name: channel.name,
          provider: channel.provider,
          displayPhone: channel.displayPhone,
          status: channel.status,
          hasPhoneNumberId: Boolean(channel.phoneNumberId),
          hasWabaId: Boolean(channel.wabaId),
          hasAccessToken: Boolean(channel.accessToken),
          hasVerifyToken: Boolean(channel.verifyToken || process.env.META_VERIFY_TOKEN),
          hasAppSecret: Boolean(channel.appSecret || process.env.META_APP_SECRET)
        }))
      }
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel gerar diagnostico." },
      { status: 500 }
    );
  }
}
