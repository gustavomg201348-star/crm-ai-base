import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "@/lib/secret-encryption-env";

// OpenCredit has no legacy plaintext configuration. Encryption is mandatory.
export function prepareOpenCreditWebhookSecret(
  secret: string,
  options = getSecretEncryptionOptionsFromEnv()
) {
  if (!options || !secret.trim() || secret.startsWith("enc:")) {
    throw new Error("OPENCREDIT_SECRET_CONFIGURATION_INVALID");
  }
  return encryptSecret(secret, options);
}

export function resolveOpenCreditWebhookSecret(
  encrypted: string | null,
  options: SecretEncryptionOptions | null = getSecretEncryptionOptionsFromEnv()
) {
  if (!options || !encrypted) throw new Error("OPENCREDIT_SECRET_UNAVAILABLE");
  const secret = decryptSecret(encrypted, options);
  if (!secret.trim()) throw new Error("OPENCREDIT_SECRET_UNAVAILABLE");
  return secret;
}

export function createOpenCreditPublicWebhookId() {
  return randomBytes(24).toString("hex");
}
