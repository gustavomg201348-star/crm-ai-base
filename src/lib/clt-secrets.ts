import {
  encryptSecret,
  isEncryptedSecretEnvelope,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionErrorCode,
  type SecretEncryptionOptions
} from "@/lib/secret-encryption";
import {
  getSecretEncryptionOptionsFromEnv,
  isCltSecretEncryptedWritesEnabled
} from "@/lib/secret-encryption-env";

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

export type CltSecretStorageErrorCode =
  | SecretEncryptionErrorCode
  | "missing_key"
  | "reserved_envelope";

export class CltSecretStorageError extends Error {
  constructor(
    readonly code: CltSecretStorageErrorCode,
    readonly field: CltSecretField
  ) {
    super(`clt_secret_storage_${field}_${code}`);
    this.name = "CltSecretStorageError";
  }
}

type ResolveCltSecretOptions = {
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

type PrepareCltSecretForStorageOptions = {
  encryptionOptions?: SecretEncryptionOptions | null;
  env?: Record<string, string | undefined>;
};

function startsLikeEncryptedSecret(value: string) {
  return value.startsWith("enc:");
}

export function prepareCltSecretForStorage(
  value: string | null | undefined,
  field: CltSecretField,
  options: PrepareCltSecretForStorageOptions = {}
) {
  if (value === null || value === undefined || value === "") {
    return value ?? null;
  }

  if (startsLikeEncryptedSecret(value)) {
    throw new CltSecretStorageError("reserved_envelope", field);
  }

  const encryptedWritesEnabled = isCltSecretEncryptedWritesEnabled(options.env);

  if (!encryptedWritesEnabled) {
    return value;
  }

  const encryptionOptions =
    options.encryptionOptions !== undefined
      ? options.encryptionOptions
      : getSecretEncryptionOptionsFromEnv(options.env);

  if (!encryptionOptions) {
    throw new CltSecretStorageError("missing_key", field);
  }

  try {
    return encryptSecret(value, encryptionOptions);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new CltSecretStorageError(error.code, field);
    }

    throw error;
  }
}

function explicitSensitiveTextValue(next?: string) {
  if (next === undefined) return undefined;
  const trimmed = next.trim();
  if (trimmed.includes("****")) return undefined;
  return trimmed || undefined;
}

function explicitSensitivePasswordValue(next?: string) {
  if (next === undefined) return undefined;
  if (next.includes("****")) return undefined;
  return next.trim() ? next : undefined;
}

export function prepareCltSecretTextUpdate(
  current: string | null,
  next: string | undefined,
  field: CltSecretField,
  options: PrepareCltSecretForStorageOptions = {}
) {
  const explicitValue = explicitSensitiveTextValue(next);

  if (explicitValue === undefined) {
    return current;
  }

  return prepareCltSecretForStorage(explicitValue, field, options);
}

export function prepareCltSecretPasswordUpdate(
  current: string | null,
  next: string | undefined,
  options: PrepareCltSecretForStorageOptions = {}
) {
  const explicitValue = explicitSensitivePasswordValue(next);

  if (explicitValue === undefined) {
    return current;
  }

  return prepareCltSecretForStorage(explicitValue, "password", options);
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
