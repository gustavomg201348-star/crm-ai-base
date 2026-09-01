import type { SecretEncryptionOptions } from "@/lib/secret-encryption";

export const CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV = "QEVORA_DATA_ENCRYPTION_KEY_V1";
export const CHANNEL_SECRET_ENCRYPTED_WRITES_ENV = "QEVORA_ENCRYPT_CHANNEL_SECRETS";

export type SecretEncryptionKeyStatus =
  | { configured: false; status: "missing" }
  | { configured: true; status: "configured" }
  | { configured: true; status: "invalid" };

type SecretEncryptionEnv = Record<string, string | undefined>;

export function isChannelSecretEncryptedWritesEnabled(
  env: SecretEncryptionEnv = process.env
) {
  return env[CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]?.toLowerCase() === "true";
}

function isValidBase64EncodedKey(value: string) {
  const normalized = value.trim();

  if (!normalized) return false;

  const asBase64Url = normalized.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  if (!/^[A-Za-z0-9_-]+$/.test(asBase64Url)) return false;

  const decoded = Buffer.from(asBase64Url, "base64url");

  return decoded.length === 32 && decoded.toString("base64url") === asBase64Url;
}

export function getSecretEncryptionOptionsFromEnv(
  env: SecretEncryptionEnv = process.env
): SecretEncryptionOptions | null {
  const key = env[CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV];

  if (!key) return null;

  return {
    activeKeyId: "v1",
    keys: { v1: key }
  };
}

export function getSecretEncryptionKeyStatus(
  env: SecretEncryptionEnv = process.env
): SecretEncryptionKeyStatus {
  const key = env[CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV];

  if (!key) {
    return { configured: false, status: "missing" };
  }

  if (!isValidBase64EncodedKey(key)) {
    return { configured: true, status: "invalid" };
  }

  return { configured: true, status: "configured" };
}

export function getChannelSecretEncryptionReadiness(
  env: SecretEncryptionEnv = process.env
) {
  const encryptedWritesEnabled = isChannelSecretEncryptedWritesEnabled(env);
  const keyV1 = getSecretEncryptionKeyStatus(env);

  return {
    encryptedWrites: {
      enabled: encryptedWritesEnabled,
      status: encryptedWritesEnabled ? "enabled" : "disabled"
    },
    keyV1,
    ok: !encryptedWritesEnabled || keyV1.status === "configured"
  };
}
