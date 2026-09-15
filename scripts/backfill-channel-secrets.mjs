import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const ENVELOPE_PREFIX = "enc";
const ENVELOPE_VERSION = "v1";
const ENVELOPE_ALGORITHM = "aes-256-gcm";
const ENVELOPE_PARTS = 7;
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const TAG_LENGTH_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const DEFAULT_BATCH_SIZE = 25;
const SECRET_FIELDS = ["accessToken", "verifyToken", "appSecret"];
const KEY_ENV = "QEVORA_DATA_ENCRYPTION_KEY_V1";

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function normalizeBase64Key(value) {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const asBase64Url = normalized.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (!/^[A-Za-z0-9_-]+$/.test(asBase64Url)) return null;

  const decoded = Buffer.from(asBase64Url, "base64url");
  if (decoded.length !== KEY_LENGTH_BYTES || decoded.toString("base64url") !== asBase64Url) {
    return null;
  }

  return decoded;
}

function decodeCanonicalBase64Url(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;

  const decoded = Buffer.from(value, "base64url");
  return decoded.toString("base64url") === value ? decoded : null;
}

function parseEnvelope(value) {
  if (typeof value !== "string" || !value.startsWith(`${ENVELOPE_PREFIX}:`)) {
    return { reserved: false, valid: false };
  }

  const parts = value.split(":");
  if (parts.length !== ENVELOPE_PARTS || parts[0] !== ENVELOPE_PREFIX) {
    return { reserved: true, valid: false, code: "invalid_envelope" };
  }

  const [, version, algorithm, keyId, ivPart, tagPart, ciphertextPart] = parts;
  if (version !== ENVELOPE_VERSION) {
    return { reserved: true, valid: false, code: "unsupported_version" };
  }
  if (algorithm !== ENVELOPE_ALGORITHM) {
    return { reserved: true, valid: false, code: "unsupported_algorithm" };
  }
  if (!KEY_ID_PATTERN.test(keyId)) {
    return { reserved: true, valid: false, code: "invalid_key_id" };
  }

  const iv = decodeCanonicalBase64Url(ivPart);
  const tag = decodeCanonicalBase64Url(tagPart);
  const ciphertext = decodeCanonicalBase64Url(ciphertextPart);

  if (
    !iv ||
    !tag ||
    !ciphertext ||
    iv.length !== IV_LENGTH_BYTES ||
    tag.length !== TAG_LENGTH_BYTES ||
    ciphertext.length === 0
  ) {
    return { reserved: true, valid: false, code: "invalid_envelope" };
  }

  return { reserved: true, valid: true, keyId, iv, tag, ciphertext };
}

function getKey(options, keyId) {
  if (!options?.keys?.[keyId]) return null;

  const key = Buffer.from(options.keys[keyId]);
  return key.length === KEY_LENGTH_BYTES ? key : null;
}

function validateEncryptedEnvelope(parsedEnvelope, options) {
  const key = getKey(options, parsedEnvelope.keyId);
  if (!key) return { ok: false, code: "unknown_key" };

  try {
    const decipher = createDecipheriv(ENVELOPE_ALGORITHM, key, parsedEnvelope.iv);
    decipher.setAuthTag(parsedEnvelope.tag);
    Buffer.concat([
      decipher.update(parsedEnvelope.ciphertext),
      decipher.final()
    ]);
    return { ok: true };
  } catch {
    return { ok: false, code: "decryption_failed" };
  }
}

export function classifyChannelSecret(value, options = null) {
  if (value === null || value === undefined || value === "" || value.trim() === "") {
    return { classification: "null_or_blank" };
  }

  const envelope = parseEnvelope(value);
  if (envelope.reserved && !envelope.valid) {
    return { classification: "invalid_envelope", blockerCode: envelope.code };
  }

  if (envelope.reserved && envelope.valid) {
    if (!options) {
      return {
        classification: "encrypted_valid",
        warningCode: "envelope_validation_key_unavailable"
      };
    }

    const validation = validateEncryptedEnvelope(envelope, options);
    if (!validation.ok) {
      return { classification: "invalid_envelope", blockerCode: validation.code };
    }

    return { classification: "encrypted_valid" };
  }

  return { classification: "plaintext" };
}

export function getBackfillEncryptionOptions(env = process.env) {
  const key = normalizeBase64Key(env[KEY_ENV]);
  if (!key) return null;

  return {
    activeKeyId: "v1",
    keys: { v1: key }
  };
}

export function encryptChannelSecretForBackfill(value, options) {
  const key = getKey(options, options.activeKeyId);
  if (!key) throw new Error("INVALID_KEY");

  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ENVELOPE_ALGORITHM, key, iv);
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

function emptyFieldStats() {
  return {
    null_or_blank: 0,
    plaintext: 0,
    encrypted_valid: 0,
    invalid_envelope: 0,
    error: 0
  };
}

export function createBackfillStats() {
  return {
    mode: "dry-run",
    totalChannels: 0,
    channelsWithPlaintext: 0,
    plaintextSecrets: 0,
    blockers: 0,
    warnings: [],
    convertedSecrets: 0,
    convertedChannels: 0,
    skippedConcurrentChannels: 0,
    failedChannels: 0,
    aborted: false,
    fields: {
      accessToken: emptyFieldStats(),
      verifyToken: emptyFieldStats(),
      appSecret: emptyFieldStats()
    },
    errors: []
  };
}

function addError(stats, { phase, channelId, code, fields }) {
  stats.errors.push({
    phase,
    ...(channelId ? { channelId } : {}),
    code,
    ...(fields?.length ? { fields } : {})
  });
}

function addWarning(stats, { phase, channelId, code, fields }) {
  stats.warnings.push({
    phase,
    ...(channelId ? { channelId } : {}),
    code,
    ...(fields?.length ? { fields } : {})
  });
}

function analyzeChannelSecrets(channel, stats, options, phase) {
  const plaintextFields = [];
  const blockerFields = [];

  if (phase === "preflight") {
    stats.totalChannels += 1;
  }

  for (const field of SECRET_FIELDS) {
    try {
      const result = classifyChannelSecret(channel[field], options);
      if (phase === "preflight") {
        stats.fields[field][result.classification] += 1;
      }

      if (result.classification === "plaintext") {
        plaintextFields.push(field);
      }
      if (result.classification === "invalid_envelope") {
        blockerFields.push(field);
        stats.blockers += 1;
        if (phase !== "preflight") {
          stats.failedChannels += 1;
        }
        addError(stats, {
          phase,
          channelId: channel.id,
          code: result.blockerCode ?? "invalid_envelope",
          fields: [field]
        });
      }
      if (result.warningCode) {
        addWarning(stats, {
          phase,
          channelId: channel.id,
          code: result.warningCode,
          fields: [field]
        });
      }
    } catch {
      if (phase === "preflight") {
        stats.fields[field].error += 1;
      }
      blockerFields.push(field);
      stats.blockers += 1;
      addError(stats, {
        phase,
        channelId: channel.id,
        code: "classification_error",
        fields: [field]
      });
    }
  }

  if (phase === "preflight" && plaintextFields.length > 0) {
    stats.channelsWithPlaintext += 1;
    stats.plaintextSecrets += plaintextFields.length;
  }

  return { plaintextFields, blockerFields };
}

function summarizeStats(stats) {
  return {
    mode: stats.mode,
    totalChannels: stats.totalChannels,
    channelsWithPlaintext: stats.channelsWithPlaintext,
    plaintextSecrets: stats.plaintextSecrets,
    blockers: stats.blockers,
    convertedSecrets: stats.convertedSecrets,
    convertedChannels: stats.convertedChannels,
    skippedConcurrentChannels: stats.skippedConcurrentChannels,
    failedChannels: stats.failedChannels,
    aborted: stats.aborted,
    fields: stats.fields,
    warnings: stats.warnings,
    errors: stats.errors
  };
}

function printSafeSummary(stats, logger = console) {
  logger.log(JSON.stringify(summarizeStats(stats), null, 2));
}

function parseCliArgs(argv) {
  const args = {
    mode: "dry-run",
    confirmProductionBackfill: false,
    batchSize: DEFAULT_BATCH_SIZE
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.mode = "dry-run";
    } else if (arg === "--apply") {
      args.mode = "apply";
    } else if (arg === "--confirm-production-backfill") {
      args.confirmProductionBackfill = true;
    } else if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.slice("--batch-size=".length));
      if (Number.isInteger(value) && value > 0 && value <= 100) {
        args.batchSize = value;
      } else {
        throw new Error("INVALID_BATCH_SIZE");
      }
    } else {
      throw new Error("UNKNOWN_ARGUMENT");
    }
  }

  return args;
}

function buildStablePaginationWhere(cursor) {
  return cursor ? { id: { gt: cursor } } : {};
}

function buildConcurrentSafeWhere(channel) {
  return {
    id: channel.id,
    accessToken: channel.accessToken ?? null,
    verifyToken: channel.verifyToken ?? null,
    appSecret: channel.appSecret ?? null
  };
}

async function findChannelBatch(prisma, cursor, batchSize) {
  return prisma.channel.findMany({
    where: buildStablePaginationWhere(cursor),
    orderBy: { id: "asc" },
    take: batchSize,
    select: {
      id: true,
      accessToken: true,
      verifyToken: true,
      appSecret: true
    }
  });
}

async function scanAllChannels({ prisma, batchSize, stats, encryptionOptions, phase }) {
  let cursor = null;

  for (;;) {
    const channels = await findChannelBatch(prisma, cursor, batchSize);
    if (channels.length === 0) break;

    for (const channel of channels) {
      analyzeChannelSecrets(channel, stats, encryptionOptions, phase);
    }

    cursor = channels[channels.length - 1].id;
  }
}

async function applyChannelBackfill(db, channel, options, stats) {
  return db.$transaction(async (tx) => {
    const current = await tx.channel.findUnique({
      where: { id: channel.id },
      select: {
        id: true,
        accessToken: true,
        verifyToken: true,
        appSecret: true
      }
    });

    if (!current) {
      stats.skippedConcurrentChannels += 1;
      return true;
    }

    const { plaintextFields, blockerFields } = analyzeChannelSecrets(
      current,
      stats,
      options,
      "apply"
    );

    if (blockerFields.length > 0) {
      stats.aborted = true;
      return false;
    }

    if (plaintextFields.length === 0) {
      return true;
    }

    const data = {};
    for (const field of plaintextFields) {
      data[field] = encryptChannelSecretForBackfill(current[field], options);
    }

    const result = await tx.channel.updateMany({
      where: buildConcurrentSafeWhere(current),
      data
    });

    if (result.count !== 1) {
      stats.skippedConcurrentChannels += 1;
      addError(stats, {
        phase: "apply",
        channelId: current.id,
        code: "concurrent_update_detected",
        fields: plaintextFields
      });
      return true;
    }

    stats.convertedChannels += 1;
    stats.convertedSecrets += plaintextFields.length;
    return true;
  });
}

async function applyAllChannels({ prisma, batchSize, stats, encryptionOptions }) {
  let cursor = null;

  for (;;) {
    const channels = await findChannelBatch(prisma, cursor, batchSize);
    if (channels.length === 0) break;

    for (const channel of channels) {
      const shouldContinue = await applyChannelBackfill(
        prisma,
        channel,
        encryptionOptions,
        stats
      );
      if (!shouldContinue) return;
    }

    cursor = channels[channels.length - 1].id;
  }
}

export async function runChannelSecretBackfill({
  prisma,
  env = process.env,
  mode = "dry-run",
  confirmProductionBackfill = false,
  batchSize = DEFAULT_BATCH_SIZE,
  logger = console
} = {}) {
  const stats = createBackfillStats();
  const shouldApply = mode === "apply" && confirmProductionBackfill;
  stats.mode = shouldApply ? "apply" : "dry-run";

  if (mode === "apply" && !confirmProductionBackfill) {
    stats.aborted = true;
    addError(stats, { phase: "startup", code: "apply_requires_confirmation" });
    printSafeSummary(stats, logger);
    return stats;
  }

  const encryptionOptions = getBackfillEncryptionOptions(env);
  if (shouldApply && !encryptionOptions) {
    stats.aborted = true;
    addError(stats, { phase: "startup", code: "missing_or_invalid_key" });
    printSafeSummary(stats, logger);
    return stats;
  }

  await scanAllChannels({
    prisma,
    batchSize,
    stats,
    encryptionOptions,
    phase: "preflight"
  });

  if (shouldApply) {
    if (stats.blockers > 0) {
      stats.aborted = true;
      printSafeSummary(stats, logger);
      return stats;
    }

    await applyAllChannels({
      prisma,
      batchSize,
      stats,
      encryptionOptions
    });
  }

  printSafeSummary(stats, logger);
  return stats;
}

export function sanitizeCliError(error) {
  if (!(error instanceof Error)) return "UNKNOWN_ERROR";
  if (
    error.message === "INVALID_BATCH_SIZE" ||
    error.message === "UNKNOWN_ARGUMENT" ||
    error.message === "INVALID_KEY"
  ) {
    return error.message;
  }

  return "UNEXPECTED_ERROR";
}

export function isDirectRun(entrypoint = process.argv[1], moduleUrl = import.meta.url) {
  return Boolean(entrypoint && moduleUrl === pathToFileURL(entrypoint).href);
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    await runChannelSecretBackfill({
      prisma,
      ...args
    });
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(
      JSON.stringify({
        ok: false,
        code: sanitizeCliError(error)
      })
    );
    process.exitCode = 1;
  });
}
