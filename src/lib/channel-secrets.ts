import {
  isEncryptedSecretEnvelope,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionErrorCode,
  type SecretEncryptionOptions
} from "@/lib/secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "@/lib/secret-encryption-env";

export type ChannelSecretField = "accessToken" | "verifyToken" | "appSecret";

export type ChannelSecretResolutionErrorCode =
  | SecretEncryptionErrorCode
  | "missing_key";

export class ChannelSecretResolutionError extends Error {
  constructor(
    readonly code: ChannelSecretResolutionErrorCode,
    readonly field: ChannelSecretField,
    readonly channelId?: string
  ) {
    super(`channel_secret_${field}_${code}`);
    this.name = "ChannelSecretResolutionError";
  }
}

type ResolveChannelSecretOptions = {
  channelId?: string;
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

function startsLikeEncryptedSecret(value: string) {
  return value.startsWith("enc:");
}

export function resolveChannelSecret(
  value: string | null | undefined,
  field: ChannelSecretField,
  options: ResolveChannelSecretOptions = {}
) {
  if (value === null || value === undefined || value === "") {
    return value ?? null;
  }

  if (!startsLikeEncryptedSecret(value)) {
    return value;
  }

  if (!isEncryptedSecretEnvelope(value)) {
    throw new ChannelSecretResolutionError("invalid_envelope", field, options.channelId);
  }

  const encryptionOptions =
    options.encryptionOptions !== undefined
      ? options.encryptionOptions
      : getSecretEncryptionOptionsFromEnv(options.env);

  if (!encryptionOptions) {
    throw new ChannelSecretResolutionError("missing_key", field, options.channelId);
  }

  try {
    return readSecret(value, encryptionOptions);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new ChannelSecretResolutionError(error.code, field, options.channelId);
    }

    throw error;
  }
}

export function resolveChannelAccessToken(
  value: string | null | undefined,
  options?: ResolveChannelSecretOptions
) {
  return resolveChannelSecret(value, "accessToken", options);
}

export function resolveChannelVerifyToken(
  value: string | null | undefined,
  options?: ResolveChannelSecretOptions
) {
  return resolveChannelSecret(value, "verifyToken", options);
}

export function resolveChannelAppSecret(
  value: string | null | undefined,
  options?: ResolveChannelSecretOptions
) {
  return resolveChannelSecret(value, "appSecret", options);
}
