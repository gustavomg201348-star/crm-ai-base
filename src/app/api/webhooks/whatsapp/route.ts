import { NextResponse, type NextRequest } from "next/server";
import { processInboundMessage } from "@/lib/inbound-message";
import { ReplyEvidencePersistenceError } from "@/lib/meta-reply-ingestion";
import { authenticateMetaInboundBatch, InboundProvenanceError } from "@/lib/meta-inbound-provenance";
import {
  parseMetaWebhookMessages,
  parseMetaWebhookStatuses
} from "@/lib/meta-whatsapp";
import { prisma } from "@/lib/db";
import { updateCampaignDeliveryStatus } from "@/lib/campaigns";
import { publicErrorResponse } from "@/lib/http-error-response";
import { updateMessageDeliveryStatus } from "@/lib/message-delivery";
import { safeLogError, safeLogInfo } from "@/lib/safe-logger";
import { applyWebhookDeliveryUpdates } from "@/lib/webhook-delivery-scope";
import {
  resolveWebhookAcceptedVerifyTokens,
  resolveVerifiedMetaWebhookChannel
} from "@/lib/webhook-channel-secrets";

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
  try {
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
        select: { id: true, verifyToken: true }
      });
      const accepted = resolveWebhookAcceptedVerifyTokens(configuredTokens);

      if (verifyToken && accepted.includes(verifyToken)) {
        return new NextResponse(challenge, { status: 200 });
      }

      return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
    }

    return NextResponse.json({ ok: true, mode: "whatsapp" });
  } catch (error) {
    safeLogError("whatsapp-webhook-audit", error, {
      operation: "webhook-get"
    });
    return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Fatal decoding prevents different invalid byte sequences from becoming the same
    // replacement-character string before HMAC. Preserve BOM rather than stripping bytes.
    let rawBody: string;
    try { rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await request.arrayBuffer()); }
    catch { throw new InboundProvenanceError("INVALID_ITEM"); }
    let body:
      | {
          companyId?: string;
          channelId?: string;
          name?: string;
          phone?: string;
          message?: string;
        }
      | null;

    try { body = rawBody ? JSON.parse(rawBody) : null; }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      logWebhookAudit("invalid-json", { operation: "webhook-post", reason: "malformed-json" });
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }
    // Primitive roots can otherwise reach `in` and expose their value in TypeError.
    if (body !== null && (typeof body !== "object" || Array.isArray(body))) {
      logWebhookAudit("invalid-json", { operation: "webhook-post", reason: "invalid-payload-shape" });
      return publicErrorResponse({ code: "INVALID_REQUEST", status: 400 });
    }

    logWebhookAudit("received", summarizeMetaWebhookPayload(body));

    const metaMessages = parseMetaWebhookMessages(body);
    const hasMessageItems = Boolean((body as MetaWebhookPayload | null)?.entry?.some(entry =>
      entry.changes?.some(change => (change.value?.messages?.length ?? 0) > 0)));
    if (metaMessages.length || hasMessageItems) {
      // Authenticate the ENTIRE batch before channel touches or inbound functional writes.
      const authenticated = await authenticateMetaInboundBatch({ db: prisma, rawBody,
        signature: request.headers.get("x-hub-signature-256") });
      const results = [];
      let evidenceRetryRequired = false;

      for (const { input, capability, phoneNumberId } of authenticated) {
        logWebhookAudit("message-parsed", {
          hasChannelExternalId: true,
          hasSender: true,
          type: input.type ?? null,
          hasBody: Boolean(input.body),
          hasMedia: Boolean(input.mediaId),
          hasProviderMessageId: true
        });
        const channel = { id: input.channelId, companyId: input.companyId };

        await prisma.channel.update({
          where: { id: channel.id },
          data: { lastWebhookReceivedAt: new Date() }
        });

        try {
          const conversation = await processInboundMessage({ ...input, provenance: capability });

          logWebhookAudit("message-processed", {
            channelId: channel.id,
            companyId: channel.companyId,
            hasChannelExternalId: true,
            hasSender: true
          });
          results.push({ phoneNumberId, ok: true, conversation });
        } catch (error) {
          if (!(error instanceof ReplyEvidencePersistenceError)) throw error;
          evidenceRetryRequired = true;
          logWebhookAudit("reply-evidence-retry-required", { code: "REPLY_EVIDENCE_RETRY_REQUIRED" });
        }
      }

      if (evidenceRetryRequired) return publicErrorResponse({ code: "INTERNAL_ERROR", status: 503 });
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

        const verified = await resolveVerifiedMetaWebhookChannel({
          db: prisma,
          phoneNumberId: status.phoneNumberId,
          rawBody,
          signature: request.headers.get("x-hub-signature-256")
        });

        if (!verified.ok) {
          logWebhookAudit("status-discarded", {
            reason: verified.reason,
            hasChannelExternalId: Boolean(status.phoneNumberId),
            hasMessageId: Boolean(status.messageId),
            status: status.status
          });
          return publicErrorResponse({ code: "FORBIDDEN", status: 403 });
        }
        const channel = verified.channel;

        const errorMessage = status.errorMessage
          ?.replace(/[\u0000-\u001f\u007f]/g, " ")
          .trim()
          .slice(0, 500) || null;

        const updated = await applyWebhookDeliveryUpdates({
          updateCampaign: () => updateCampaignDeliveryStatus({
            companyId: channel.companyId,
            channelId: channel.id,
            providerMessageId: status.messageId,
            status: status.status,
            errorCode: status.errorCode,
            errorMessage
          }),
          updateMessage: () => updateMessageDeliveryStatus({
            companyId: channel.companyId,
            channelId: channel.id,
            providerMessageId: status.messageId,
            status: status.status,
            errorMessage
          }),
          touchChannel: () => prisma.channel.update({
            where: { id: channel.id },
            data: { lastWebhookReceivedAt: new Date() }
          })
        });

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
    if (error instanceof InboundProvenanceError) {
      return publicErrorResponse({ code: "FORBIDDEN", status: error.code.startsWith("REPLAY_") ? 409 : 403 });
    }
    safeLogError("whatsapp-webhook-audit", error, {
      operation: "webhook-post"
    });
    return publicErrorResponse({ code: "INTERNAL_ERROR", status: 500 });
  }
}
