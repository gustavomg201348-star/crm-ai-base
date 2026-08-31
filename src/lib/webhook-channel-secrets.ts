import {
  ChannelSecretResolutionError,
  resolveChannelAppSecret,
  resolveChannelVerifyToken
} from "@/lib/channel-secrets";

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
