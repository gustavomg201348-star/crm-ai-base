import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ENVELOPE_PREFIX = "enc";
const ENVELOPE_VERSION = "v1";
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const ENVELOPE_PARTS = 7;
const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export type SecretEncryptionErrorCode =
  | "invalid_key"
  | "unknown_key"
  | "invalid_key_id"
  | "invalid_envelope"
  | "unsupported_version"
  | "unsupported_algorithm"
  | "decryption_failed";

export class SecretEncryptionError extends Error {
  constructor(readonly code: SecretEncryptionErrorCode) {
    super(`secret_encryption_${code}`);
    this.name = "SecretEncryptionError";
  }
}

export type SecretKey = Buffer | Uint8Array | string;

export type SecretEncryptionOptions = {
  activeKeyId: string;
  keys: Record<string, SecretKey>;
};

type ParsedEnvelope = {
  keyId: string;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
};

function toBase64Url(value: Buffer) {
  return value.toString("base64url");
}

function fromBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new SecretEncryptionError("invalid_envelope");
  }

  const decoded = Buffer.from(value, "base64url");

  if (toBase64Url(decoded) !== value) {
    throw new SecretEncryptionError("invalid_envelope");
  }

  return decoded;
}

function parseBase64Key(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new SecretEncryptionError("invalid_key");
  }

  const asBase64Url = normalized.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

  if (!/^[A-Za-z0-9_-]+$/.test(asBase64Url)) {
    throw new SecretEncryptionError("invalid_key");
  }

  const decoded = Buffer.from(asBase64Url, "base64url");

  if (toBase64Url(decoded) !== asBase64Url) {
    throw new SecretEncryptionError("invalid_key");
  }

  return decoded;
}

function assertValidKeyId(keyId: string) {
  if (!KEY_ID_PATTERN.test(keyId)) {
    throw new SecretEncryptionError("invalid_key_id");
  }
}

function normalizeKey(key: SecretKey) {
  const normalized =
    typeof key === "string"
      ? parseBase64Key(key)
      : Buffer.from(key);

  if (normalized.length !== KEY_LENGTH_BYTES) {
    throw new SecretEncryptionError("invalid_key");
  }

  return normalized;
}

function getKey(options: SecretEncryptionOptions, keyId: string) {
  assertValidKeyId(keyId);
  const key = options.keys[keyId];

  if (!key) {
    throw new SecretEncryptionError("unknown_key");
  }

  return normalizeKey(key);
}

function validateEncryptionOptions(options: SecretEncryptionOptions) {
  assertValidKeyId(options.activeKeyId);

  for (const [keyId, key] of Object.entries(options.keys)) {
    assertValidKeyId(keyId);
    normalizeKey(key);
  }

  return getKey(options, options.activeKeyId);
}

function parseEnvelope(value: string): ParsedEnvelope | null {
  if (!value.startsWith(`${ENVELOPE_PREFIX}:`)) {
    return null;
  }

  const parts = value.split(":");

  if (parts.length !== ENVELOPE_PARTS || parts[0] !== ENVELOPE_PREFIX) {
    throw new SecretEncryptionError("invalid_envelope");
  }

  const [, version, algorithm, keyId, ivPart, tagPart, ciphertextPart] = parts;

  if (version !== ENVELOPE_VERSION) {
    throw new SecretEncryptionError("unsupported_version");
  }

  if (algorithm !== ENVELOPE_ALGORITHM) {
    throw new SecretEncryptionError("unsupported_algorithm");
  }

  assertValidKeyId(keyId);

  const iv = fromBase64Url(ivPart);
  const tag = fromBase64Url(tagPart);
  const ciphertext = fromBase64Url(ciphertextPart);

  if (iv.length !== IV_LENGTH_BYTES || tag.length !== TAG_LENGTH_BYTES || ciphertext.length === 0) {
    throw new SecretEncryptionError("invalid_envelope");
  }

  return { keyId, iv, tag, ciphertext };
}

// Structural check only: true means the value is a valid QEVORA envelope.
// It does not prove that the required key is available or that decrypt will succeed.
export function isEncryptedSecretEnvelope(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  try {
    return parseEnvelope(value) !== null;
  } catch {
    return false;
  }
}

export function encryptSecret(value: null, options: SecretEncryptionOptions): null;
export function encryptSecret(value: undefined, options: SecretEncryptionOptions): undefined;
export function encryptSecret(value: string, options: SecretEncryptionOptions): string;
export function encryptSecret(
  value: string | null | undefined,
  options: SecretEncryptionOptions
) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  const parsedEnvelope = parseEnvelope(value);
  const activeKey = validateEncryptionOptions(options);

  if (parsedEnvelope) {
    getKey(options, parsedEnvelope.keyId);
    return value;
  }

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENVELOPE_ALGORITHM, activeKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENVELOPE_PREFIX,
    ENVELOPE_VERSION,
    ENVELOPE_ALGORITHM,
    options.activeKeyId,
    toBase64Url(iv),
    toBase64Url(tag),
    toBase64Url(ciphertext)
  ].join(":");
}

export function decryptSecret(value: null, options: SecretEncryptionOptions): null;
export function decryptSecret(value: undefined, options: SecretEncryptionOptions): undefined;
export function decryptSecret(value: string, options: SecretEncryptionOptions): string;
export function decryptSecret(
  value: string | null | undefined,
  options: SecretEncryptionOptions
) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  const envelope = parseEnvelope(value);

  if (!envelope) {
    throw new SecretEncryptionError("invalid_envelope");
  }

  const key = getKey(options, envelope.keyId);

  try {
    const decipher = createDecipheriv(ENVELOPE_ALGORITHM, key, envelope.iv);
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final()
    ]).toString("utf8");
  } catch {
    throw new SecretEncryptionError("decryption_failed");
  }
}

export function readSecret(value: null, options: SecretEncryptionOptions): null;
export function readSecret(value: undefined, options: SecretEncryptionOptions): undefined;
export function readSecret(value: string, options: SecretEncryptionOptions): string;
export function readSecret(
  value: string | null | undefined,
  options: SecretEncryptionOptions
) {
  if (value === null || value === undefined || value === "") {
    return value;
  }

  if (!value.startsWith(`${ENVELOPE_PREFIX}:`)) {
    return value;
  }

  return decryptSecret(value, options);
}
