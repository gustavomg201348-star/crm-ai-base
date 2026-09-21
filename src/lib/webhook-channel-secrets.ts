import {
  ChannelSecretResolutionError,
  resolveChannelAppSecret,
  resolveChannelVerifyToken
} from "@/lib/channel-secrets";
import { verifyMetaSignature } from "@/lib/meta-whatsapp";
import type { PrismaClient } from "@prisma/client";

type WebhookChannelLookup = Pick<PrismaClient, "channel">;

export type VerifiedMetaWebhookChannelResult =
  | {
      ok: true;
      channel: { id: string; companyId: string };
    }
  | {
      ok: false;
      reason: "channel-not-found" | "app-secret-unavailable" | "invalid-signature";
    };

export function resolveWebhookAcceptedVerifyTokens(
  channels: Array<{ id?: string; verifyToken: string | null }>,
  envVerifyToken = process.env.META_VERIFY_TOKEN
) {
  const tokens = envVerifyToken ? [envVerifyToken] : [];

  for (const channel of channels) {
    try {
      const resolved = resolveChannelVerifyToken(channel.verifyToken, {
        channelId: channel.id
      });

      if (resolved) tokens.push(resolved);
    } catch (error) {
      if (error instanceof ChannelSecretResolutionError) {
        continue;
      }

      throw error;
    }
  }

  return tokens;
}

export function resolveWebhookAppSecret({
  channelId,
  channelAppSecret,
  envAppSecret = process.env.META_APP_SECRET
}: {
  channelId?: string;
  channelAppSecret: string | null;
  envAppSecret?: string;
}) {
  return channelAppSecret !== null && channelAppSecret !== undefined
    ? resolveChannelAppSecret(channelAppSecret, { channelId })
    : envAppSecret;
}

export async function resolveVerifiedMetaWebhookChannel({
  db,
  phoneNumberId,
  rawBody,
  signature
}: {
  db: WebhookChannelLookup;
  phoneNumberId: string;
  rawBody: string;
  signature?: string | null;
}): Promise<VerifiedMetaWebhookChannelResult> {
  const channel = await db.channel.findFirst({
    where: {
      type: "whatsapp",
      provider: "meta",
      status: { in: ["ACTIVE", "CONNECTED"] },
      OR: [{ phoneNumberId }, { externalId: phoneNumberId }]
    },
    select: { id: true, companyId: true, appSecret: true }
  });

  if (!channel) {
    return { ok: false, reason: "channel-not-found" };
  }

  if (!channel.appSecret) {
    return { ok: false, reason: "app-secret-unavailable" };
  }

  let appSecret: string | null | undefined;
  try {
    appSecret = resolveWebhookAppSecret({
      channelId: channel.id,
      channelAppSecret: channel.appSecret
    });
  } catch (error) {
    if (error instanceof ChannelSecretResolutionError) {
      return { ok: false, reason: "app-secret-unavailable" };
    }
    throw error;
  }

  if (!appSecret) {
    return { ok: false, reason: "app-secret-unavailable" };
  }

  if (!verifyMetaSignature({ appSecret, rawBody, signature })) {
    return { ok: false, reason: "invalid-signature" };
  }

  return {
    ok: true,
    channel: { id: channel.id, companyId: channel.companyId }
  };
}
