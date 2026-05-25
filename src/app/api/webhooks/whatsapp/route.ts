import { NextResponse, type NextRequest } from "next/server";
import { processInboundMessage } from "@/lib/inbound-message";
import {
  parseMetaWebhookMessages,
  parseMetaWebhookStatuses,
  verifyMetaSignature
} from "@/lib/meta-whatsapp";
import { prisma } from "@/lib/db";
import { updateCampaignDeliveryStatus } from "@/lib/campaigns";
import { updateMessageDeliveryStatus } from "@/lib/message-delivery";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");
  const verifyToken = request.nextUrl.searchParams.get("hub.verify_token");

  if (mode === "subscribe" && challenge) {
    const configuredTokens = await prisma.channel.findMany({
      where: {
        type: "whatsapp",
        status: { in: ["ACTIVE", "CONNECTED"] },
        verifyToken: { not: null }
      },
      select: { verifyToken: true }
    });
    const accepted = [
      process.env.META_VERIFY_TOKEN,
      ...configuredTokens.map((channel) => channel.verifyToken)
    ].filter(Boolean);

    if (!accepted.length || accepted.includes(verifyToken)) {
      return new NextResponse(challenge, { status: 200 });
    }

    return NextResponse.json({ error: "Verify token invalido." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, mode: "whatsapp" });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const body = (rawBody ? JSON.parse(rawBody) : null) as
      | {
          companyId?: string;
          channelId?: string;
          name?: string;
          phone?: string;
          message?: string;
        }
      | null;

    const metaMessages = parseMetaWebhookMessages(body);
    if (metaMessages.length) {
      const results = [];

      for (const message of metaMessages) {
        const channel = await prisma.channel.findFirst({
          where: {
            type: "whatsapp",
            provider: "meta",
            status: { in: ["ACTIVE", "CONNECTED"] },
            OR: [
              { phoneNumberId: message.phoneNumberId },
              { externalId: message.phoneNumberId }
            ]
          }
        });

        if (!channel) {
          results.push({
            phoneNumberId: message.phoneNumberId,
            ok: false,
            error: "Canal nao cadastrado."
          });
          continue;
        }

        const signatureOk = verifyMetaSignature({
          appSecret: channel.appSecret ?? process.env.META_APP_SECRET,
          rawBody,
          signature: request.headers.get("x-hub-signature-256")
        });

        if (!signatureOk) {
          return NextResponse.json({ error: "Assinatura invalida." }, { status: 403 });
        }

        const conversation = await processInboundMessage({
          companyId: channel.companyId,
          channelId: channel.id,
          name: message.name,
          phone: message.from,
          body: message.body,
          providerMessageId: message.messageId
        });

        results.push({ phoneNumberId: message.phoneNumberId, ok: true, conversation });
      }

      return NextResponse.json({ ok: true, mode: "meta", results });
    }

    const metaStatuses = parseMetaWebhookStatuses(body);
    if (metaStatuses.length) {
      const results = [];

      for (const status of metaStatuses) {
        const [campaignUpdated, messageUpdated] = await Promise.all([
          updateCampaignDeliveryStatus({
            providerMessageId: status.messageId,
            status: status.status,
            errorCode: status.errorCode,
            errorMessage: status.errorMessage
          }),
          updateMessageDeliveryStatus({
            providerMessageId: status.messageId,
            status: status.status
          })
        ]);

        const updated =
          Boolean(campaignUpdated) || Boolean(messageUpdated);

        if (status.status.toLowerCase() === "failed" && !updated) {
          await updateCampaignDeliveryStatus({
            providerMessageId: status.messageId,
            status: status.status,
            errorCode: status.errorCode,
            errorMessage: status.errorMessage
          });
        }

        results.push({
          phoneNumberId: status.phoneNumberId,
          messageId: status.messageId,
          status: status.status,
          updated
        });
      }

      return NextResponse.json({ ok: true, mode: "meta-status", results });
    }

    if (body && "entry" in body) {
      return NextResponse.json({ ok: true, mode: "meta", results: [] });
    }

    const companyId = body?.companyId ?? "seed-company";

    if (!body?.phone || !body?.message) {
      return NextResponse.json(
        { error: "Payload sandbox requer phone e message." },
        { status: 400 }
      );
    }

    const channel = body.channelId
      ? await prisma.channel.findFirst({
          where: { id: body.channelId, companyId }
        })
      : await prisma.channel.findFirst({
          where: { companyId, type: "whatsapp" }
        });

    const conversation = await processInboundMessage({
      companyId,
      channelId: channel?.id ?? null,
      name: body.name,
      phone: body.phone,
      body: body.message
    });

    return NextResponse.json({ ok: true, conversation });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel processar webhook." },
      { status: 500 }
    );
  }
}
