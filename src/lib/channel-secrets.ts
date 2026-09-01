import {
  isEncryptedSecretEnvelope,
  encryptSecret,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionErrorCode,
  type SecretEncryptionOptions
} from "@/lib/secret-encryption";
import {
  getSecretEncryptionOptionsFromEnv,
  isChannelSecretEncryptedWritesEnabled
} from "@/lib/secret-encryption-env";

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

export type ChannelSecretStorageErrorCode =
  | SecretEncryptionErrorCode
  | "missing_key"
  | "reserved_envelope";

export class ChannelSecretStorageError extends Error {
  constructor(
    readonly code: ChannelSecretStorageErrorCode,
    readonly field: ChannelSecretField
  ) {
    super(`channel_secret_storage_${field}_${code}`);
    this.name = "ChannelSecretStorageError";
  }
}

type ResolveChannelSecretOptions = {
  channelId?: string;
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

type PrepareChannelSecretForStorageOptions = {
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

type ChannelSecretStorageInput = Partial<Record<ChannelSecretField, string | null | undefined>>;
type ChannelSecretCreateStorageData = Record<ChannelSecretField, string | null>;
type ChannelSecretUpdateStorageData = Partial<Record<ChannelSecretField, string>>;

const channelSecretFields: ChannelSecretField[] = ["accessToken", "verifyToken", "appSecret"];

function startsLikeEncryptedSecret(value: string) {
  return value.startsWith("enc:");
}

export function prepareChannelSecretForStorage(
  value: string | null | undefined,
  field: ChannelSecretField,
  options: PrepareChannelSecretForStorageOptions = {}
) {
  if (value === null || value === undefined || value === "") {
    return value ?? null;
  }

  if (startsLikeEncryptedSecret(value)) {
    throw new ChannelSecretStorageError("reserved_envelope", field);
  }

  const encryptedWritesEnabled = isChannelSecretEncryptedWritesEnabled(options.env);

  if (!encryptedWritesEnabled) {
    return value;
  }

  const encryptionOptions =
    options.encryptionOptions !== undefined
      ? options.encryptionOptions
      : getSecretEncryptionOptionsFromEnv(options.env);

  if (!encryptionOptions) {
    throw new ChannelSecretStorageError("missing_key", field);
  }

  try {
    return encryptSecret(value, encryptionOptions);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new ChannelSecretStorageError(error.code, field);
    }

    throw error;
  }
}

export function prepareChannelSecretsForCreateStorage(
  input: ChannelSecretStorageInput,
  options: PrepareChannelSecretForStorageOptions = {}
): ChannelSecretCreateStorageData {
  return {
    accessToken: prepareChannelSecretForStorage(
      input.accessToken?.trim() || null,
      "accessToken",
      options
    ),
    verifyToken: prepareChannelSecretForStorage(
      input.verifyToken?.trim() || null,
      "verifyToken",
      options
    ),
    appSecret: prepareChannelSecretForStorage(
      input.appSecret?.trim() || null,
      "appSecret",
      options
    )
  };
}

export function prepareChannelSecretsForUpdateStorage(
  input: ChannelSecretStorageInput,
  options: PrepareChannelSecretForStorageOptions = {}
): ChannelSecretUpdateStorageData {
  const data: ChannelSecretUpdateStorageData = {};

  for (const field of channelSecretFields) {
    const rawValue = input[field];
    const value = typeof rawValue === "string" ? rawValue.trim() : "";

    if (value) {
      const prepared = prepareChannelSecretForStorage(value, field, options);

      if (prepared !== null) {
        data[field] = prepared;
      }
    }
  }

  return data;
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
