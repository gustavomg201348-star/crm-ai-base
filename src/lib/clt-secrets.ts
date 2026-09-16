import {
  isEncryptedSecretEnvelope,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionErrorCode,
  type SecretEncryptionOptions
} from "@/lib/secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "@/lib/secret-encryption-env";

export type CltSecretField =
  | "apiKey"
  | "username"
  | "password"
  | "newcorbanIdentifier"
  | "digitadorCode"
  | "certifiedAgentCpf";

export type CltSecretResolutionErrorCode =
  | SecretEncryptionErrorCode
  | "missing_key";

export class CltSecretResolutionError extends Error {
  constructor(
    readonly code: CltSecretResolutionErrorCode,
    readonly field: CltSecretField
  ) {
    super(`clt_secret_${field}_${code}`);
    this.name = "CltSecretResolutionError";
  }
}

type ResolveCltSecretOptions = {
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

function startsLikeEncryptedSecret(value: string) {
  return value.startsWith("enc:");
}

export function resolveCltSecret(
  value: string | null | undefined,
  field: CltSecretField,
  options: ResolveCltSecretOptions = {}
) {
  if (value === null || value === undefined || value === "") {
    return value ?? null;
  }

  if (!startsLikeEncryptedSecret(value)) {
    return value;
  }

  if (!isEncryptedSecretEnvelope(value)) {
    throw new CltSecretResolutionError("invalid_envelope", field);
  }

  const encryptionOptions =
    options.encryptionOptions !== undefined
      ? options.encryptionOptions
      : getSecretEncryptionOptionsFromEnv(options.env);

  if (!encryptionOptions) {
    throw new CltSecretResolutionError("missing_key", field);
  }

  try {
    return readSecret(value, encryptionOptions);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new CltSecretResolutionError(error.code, field);
    }

    throw error;
  }
}

export function resolveCltApiKey(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "apiKey", options);
}

export function resolveCltUsername(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "username", options);
}

export function resolveCltPassword(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "password", options);
}

export function resolveCltNewcorbanIdentifier(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "newcorbanIdentifier", options);
}

export function resolveCltDigitadorCode(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "digitadorCode", options);
}

export function resolveCltCertifiedAgentCpf(
  value: string | null | undefined,
  options?: ResolveCltSecretOptions
) {
  return resolveCltSecret(value, "certifiedAgentCpf", options);
}
