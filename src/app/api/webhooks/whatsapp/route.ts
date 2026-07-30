import { NextResponse, type NextRequest } from "next/server";
import { processInboundMessage } from "@/lib/inbound-message";
import {
  parseMetaWebhookMessages,
  parseMetaWebhookStatuses,
  verifyMetaSignature
} from "@/lib/meta-whatsapp";
import { prisma } from "@/lib/db";
import { updateCampaignDeliveryStatus } from "@/lib/campaigns";
import { publicErrorResponse } from "@/lib/http-error-response";
import { updateMessageDeliveryStatus } from "@/lib/message-delivery";
import { safeLogError, safeLogInfo } from "@/lib/safe-logger";

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ wa_id?: string }>;
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
        }>;
      };
    }>;
  }>;
};

function summarizeMetaWebhookPayload(payload: unknown) {
  const body = payload as MetaWebhookPayload | null;
  const entries = body?.entry ?? [];
  const changes = entries.flatMap((entry) => entry.changes ?? []);
  const messages = changes.flatMap((change) => change.value?.messages ?? []);
  const contacts = changes.flatMap((change) => change.value?.contacts ?? []);

  return {
    object: body?.object ?? null,
    entryCount: entries.length,
    changeCount: changes.length,
    contactCount: contacts.length,
    messageCount: messages.length,
    messageTypes: Array.from(new Set(messages.map((message) => message.type ?? "unknown"))),
    hasMetadataExternalId: changes.some((change) => Boolean(change.value?.metadata?.phone_number_id)),
    hasContacts: contacts.length > 0,
    hasMessages: messages.length > 0
  };
}

function logWebhookAudit(event: string, details: Record<string, unknown>) {
  safeLogInfo("whatsapp-webhook-audit", event, {
    event,
    ...details
  });
}

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

    return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
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

    logWebhookAudit("received", summarizeMetaWebhookPayload(body));

    const metaMessages = parseMetaWebhookMessages(body);
    if (metaMessages.length) {
      const results = [];

      for (const message of metaMessages) {
        logWebhookAudit("message-parsed", {
          hasChannelExternalId: Boolean(message.phoneNumberId),
          hasSender: Boolean(message.from),
          type: message.type ?? null,
          hasBody: Boolean(message.body),
          hasMedia: Boolean(message.mediaId),
          hasProviderMessageId: Boolean(message.messageId)
        });

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
          logWebhookAudit("message-discarded", {
            reason: "channel-not-found",
            hasChannelExternalId: Boolean(message.phoneNumberId),
            hasSender: Boolean(message.from)
          });
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
          logWebhookAudit("message-discarded", {
            reason: "invalid-signature",
            channelId: channel.id,
            companyId: channel.companyId,
            hasChannelExternalId: Boolean(message.phoneNumberId),
            hasSender: Boolean(message.from)
          });
          return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
        }

        await prisma.channel.update({
          where: { id: channel.id },
          data: { lastWebhookReceivedAt: new Date() }
        });

        const conversation = await processInboundMessage({
          companyId: channel.companyId,
          channelId: channel.id,
          name: message.name,
          phone: message.from,
          body: message.body,
          type: message.type,
          mediaId: message.mediaId,
          fileName: message.fileName,
          mimeType: message.mimeType,
          providerMessageId: message.messageId,
          contextProviderMessageId: message.contextMessageId
        });

        logWebhookAudit("message-processed", {
          channelId: channel.id,
          companyId: channel.companyId,
          hasChannelExternalId: Boolean(message.phoneNumberId),
          hasSender: Boolean(message.from)
        });
        results.push({ phoneNumberId: message.phoneNumberId, ok: true, conversation });
      }

      return NextResponse.json({ ok: true, mode: "meta", results });
    }

    const metaStatuses = parseMetaWebhookStatuses(body);
    if (metaStatuses.length) {
      const results = [];

      for (const status of metaStatuses) {
        logWebhookAudit("status-parsed", {
          hasChannelExternalId: Boolean(status.phoneNumberId),
          hasMessageId: Boolean(status.messageId),
          status: status.status,
          errorCode: status.errorCode ?? null,
          hasErrorMessage: Boolean(status.errorMessage)
        });

        const channel = await prisma.channel.findFirst({
          where: {
            type: "whatsapp",
            provider: "meta",
            OR: [
              { phoneNumberId: status.phoneNumberId },
              { externalId: status.phoneNumberId }
            ]
          },
          select: { id: true }
        });

        if (channel) {
          await prisma.channel.update({
            where: { id: channel.id },
            data: { lastWebhookReceivedAt: new Date() }
          });
        } else {
          logWebhookAudit("status-discarded", {
            reason: "channel-not-found",
            hasChannelExternalId: Boolean(status.phoneNumberId),
            hasMessageId: Boolean(status.messageId),
            status: status.status
          });
        }

        const [campaignUpdated, messageUpdated] = await Promise.all([
          updateCampaignDeliveryStatus({
            providerMessageId: status.messageId,
            status: status.status,
            errorCode: status.errorCode,
            errorMessage: status.errorMessage
          }),
          updateMessageDeliveryStatus({
            providerMessageId: status.messageId,
            status: status.status,
            errorMessage: status.errorMessage
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
      logWebhookAudit("meta-payload-discarded", {
        reason: "no-messages-or-statuses",
        ...summarizeMetaWebhookPayload(body)
      });
      return NextResponse.json({ ok: true, mode: "meta", results: [] });
    }

    if (
      process.env.NODE_ENV === "production" ||
      process.env.RAILWAY_ENVIRONMENT === "production"
    ) {
      return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
    }

    const companyId = body?.companyId ?? "seed-company";

    if (!body?.phone || !body?.message) {
      logWebhookAudit("sandbox-discarded", {
        reason: "missing-phone-or-message",
        hasSandboxContact: Boolean(body?.phone),
        hasMessage: Boolean(body?.message)
      });
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
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
  } catch (error) {
    safeLogError("whatsapp-webhook-audit", error, {
      operation: "webhook-post"
    });
    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}
