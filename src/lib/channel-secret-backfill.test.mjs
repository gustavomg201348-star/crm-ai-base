import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  classifyChannelSecret,
  encryptChannelSecretForBackfill,
  getBackfillEncryptionOptions,
  runChannelSecretBackfill,
  sanitizeCliError
} from "../../scripts/backfill-channel-secrets.mjs";

function validEnv() {
  return {
    QEVORA_DATA_ENCRYPTION_KEY_V1: randomBytes(32).toString("base64")
  };
}

function validOptions() {
  const options = getBackfillEncryptionOptions(validEnv());
  assert.ok(options);
  return options;
}

function logger() {
  const lines = [];

  return {
    lines,
    log(message) {
      lines.push(message);
    }
  };
}

function createFakePrisma(initialChannels, options = {}) {
  const channels = initialChannels.map((channel) => ({ ...channel }));
  const updates = [];

  const channelApi = {
    async findMany({ where, orderBy, take, select }) {
      assert.deepEqual(orderBy, { id: "asc" });
      assert.deepEqual(select, {
        id: true,
        accessToken: true,
        verifyToken: true,
        appSecret: true
      });

      const after = where?.id?.gt ?? "";
      return channels
        .filter((channel) => channel.id > after)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take)
        .map((channel) => ({ ...channel }));
    },
    async findUnique({ where, select }) {
      assert.deepEqual(select, {
        id: true,
        accessToken: true,
        verifyToken: true,
        appSecret: true
      });

      if (options.beforeFindUnique) {
        await options.beforeFindUnique(channels, where.id);
      }

      const channel = channels.find((item) => item.id === where.id);
      return channel ? { ...channel } : null;
    },
    async updateMany({ where, data }) {
      updates.push({ where, data });

      if (options.conflictOnUpdate) {
        return { count: 0 };
      }

      const index = channels.findIndex(
        (channel) =>
          channel.id === where.id &&
          (channel.accessToken ?? null) === where.accessToken &&
          (channel.verifyToken ?? null) === where.verifyToken &&
          (channel.appSecret ?? null) === where.appSecret
      );

      if (index === -1) {
        return { count: 0 };
      }

      channels[index] = { ...channels[index], ...data };
      return { count: 1 };
    }
  };

  return {
    channels,
    updates,
    channel: channelApi,
    async $transaction(callback) {
      const before = channels.map((channel) => ({ ...channel }));
      try {
        return await callback({ channel: channelApi });
      } catch (error) {
        channels.splice(0, channels.length, ...before);
        throw error;
      }
    }
  };
}

function tamperEnvelopePart(envelope, partIndex) {
  const parts = envelope.split(":");
  const bytes = Buffer.from(parts[partIndex], "base64url");
  assert.ok(bytes.length > 0);
  bytes[0] ^= 1;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(":");
}

function replaceEnvelopePart(envelope, partIndex, value) {
  const parts = envelope.split(":");
  parts[partIndex] = value;
  return parts.join(":");
}

test("classifica plaintext accessToken como conversao necessaria", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain-access", verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    mode: "dry-run",
    logger: logger()
  });

  assert.equal(stats.fields.accessToken.plaintext, 1);
  assert.equal(stats.channelsWithPlaintext, 1);
  assert.equal(stats.plaintextSecrets, 1);
  assert.equal(prisma.updates.length, 0);
});

test("classifica plaintext verifyToken como conversao necessaria", async () => {
  const stats = await runChannelSecretBackfill({
    prisma: createFakePrisma([
      { id: "channel-1", accessToken: null, verifyToken: "plain-verify", appSecret: null }
    ]),
    logger: logger()
  });

  assert.equal(stats.fields.verifyToken.plaintext, 1);
  assert.equal(stats.channelsWithPlaintext, 1);
  assert.equal(stats.plaintextSecrets, 1);
});

test("classifica plaintext appSecret como conversao necessaria", async () => {
  const stats = await runChannelSecretBackfill({
    prisma: createFakePrisma([
      { id: "channel-1", accessToken: null, verifyToken: null, appSecret: "plain-app" }
    ]),
    logger: logger()
  });

  assert.equal(stats.fields.appSecret.plaintext, 1);
  assert.equal(stats.channelsWithPlaintext, 1);
  assert.equal(stats.plaintextSecrets, 1);
});

test("apply converte tres plaintext de um Channel", async () => {
  const prisma = createFakePrisma([
    {
      id: "channel-1",
      accessToken: "plain-access",
      verifyToken: "plain-verify",
      appSecret: "plain-app"
    }
  ]);
  const env = validEnv();
  const options = getBackfillEncryptionOptions(env);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.convertedChannels, 1);
  assert.equal(stats.convertedSecrets, 3);
  assert.equal(classifyChannelSecret(prisma.channels[0].accessToken, options).classification, "encrypted_valid");
  assert.equal(classifyChannelSecret(prisma.channels[0].verifyToken, options).classification, "encrypted_valid");
  assert.equal(classifyChannelSecret(prisma.channels[0].appSecret, options).classification, "encrypted_valid");
});

test("enc:v1 valido permanece byte-identical", async () => {
  const env = validEnv();
  const options = getBackfillEncryptionOptions(env);
  const encrypted = encryptChannelSecretForBackfill("secret", options);
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: encrypted, verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.fields.accessToken.encrypted_valid, 1);
  assert.equal(prisma.channels[0].accessToken, encrypted);
  assert.equal(prisma.updates.length, 0);
});

test("enc:v1 valido com known kid e auth ok classifica encrypted_valid", () => {
  const options = validOptions();
  const encrypted = encryptChannelSecretForBackfill("secret", options);

  assert.deepEqual(classifyChannelSecret(encrypted, options), {
    classification: "encrypted_valid"
  });
});

test("null e strings em branco permanecem byte-identical e nao criptografam", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: null, verifyToken: "", appSecret: "   " },
    { id: "channel-2", accessToken: "\t", verifyToken: "\n", appSecret: null }
  ]);

  const original = prisma.channels.map((channel) => ({ ...channel }));
  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.fields.accessToken.null_or_blank, 2);
  assert.equal(stats.fields.verifyToken.null_or_blank, 2);
  assert.equal(stats.fields.appSecret.null_or_blank, 2);
  assert.deepEqual(prisma.channels, original);
  assert.equal(prisma.updates.length, 0);
});

test("envelope enc reservado malformado bloqueia preflight e gera zero writes", async () => {
  const prisma = createFakePrisma([
    {
      id: "channel-1",
      accessToken: "enc:v1:aes-256-gcm:v1:iv:tag",
      verifyToken: "plain",
      appSecret: null
    }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.aborted, true);
  assert.equal(stats.blockers, 1);
  assert.equal(stats.errors[0].code, "invalid_envelope");
  assert.equal(prisma.updates.length, 0);
});

test("envelope enc:v2 bloqueia preflight e gera zero writes", async () => {
  const options = validOptions();
  const invalidVersion = replaceEnvelopePart(
    encryptChannelSecretForBackfill("secret", options),
    1,
    "v2"
  );
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: invalidVersion, verifyToken: "plain", appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.blockers, 1);
  assert.equal(stats.errors[0].code, "unsupported_version");
  assert.equal(prisma.updates.length, 0);
});

test("envelope com unknown kid bloqueia preflight e gera zero writes", async () => {
  const env = validEnv();
  const options = getBackfillEncryptionOptions(env);
  const unknownKid = replaceEnvelopePart(
    encryptChannelSecretForBackfill("secret", options),
    3,
    "v2"
  );
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: unknownKid, verifyToken: "plain", appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.blockers, 1);
  assert.equal(stats.errors[0].code, "unknown_key");
  assert.equal(prisma.updates.length, 0);
});

test("tag adulterada estruturalmente valida bloqueia por decryption_failed", async () => {
  const env = validEnv();
  const options = getBackfillEncryptionOptions(env);
  const tampered = tamperEnvelopePart(encryptChannelSecretForBackfill("secret", options), 5);
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: tampered, verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.blockers, 1);
  assert.equal(stats.errors[0].code, "decryption_failed");
  assert.equal(prisma.updates.length, 0);
});

test("ciphertext adulterado estruturalmente valido bloqueia por decryption_failed", async () => {
  const env = validEnv();
  const options = getBackfillEncryptionOptions(env);
  const tampered = tamperEnvelopePart(encryptChannelSecretForBackfill("secret", options), 6);
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: tampered, verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.blockers, 1);
  assert.equal(stats.errors[0].code, "decryption_failed");
  assert.equal(prisma.updates.length, 0);
});

test("blocker no ultimo batch impede todas as escritas", async () => {
  const env = validEnv();
  const invalid = replaceEnvelopePart(
    encryptChannelSecretForBackfill("secret", getBackfillEncryptionOptions(env)),
    2,
    "aes-128-gcm"
  );
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain-1", verifyToken: null, appSecret: null },
    { id: "channel-2", accessToken: "plain-2", verifyToken: null, appSecret: null },
    { id: "channel-3", accessToken: invalid, verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    batchSize: 1,
    logger: logger()
  });

  assert.equal(stats.aborted, true);
  assert.equal(stats.blockers, 1);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(prisma.updates.length, 0);
  assert.equal(prisma.channels[0].accessToken, "plain-1");
  assert.equal(prisma.channels[1].accessToken, "plain-2");
});

test("key ausente em apply gera zero writes antes de ler canais", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain", verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: {},
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.errors[0].code, "missing_or_invalid_key");
  assert.equal(stats.totalChannels, 0);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(prisma.updates.length, 0);
});

test("key invalida em apply gera zero writes antes de ler canais", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain", verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: { QEVORA_DATA_ENCRYPTION_KEY_V1: "not-a-valid-key" },
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.errors[0].code, "missing_or_invalid_key");
  assert.equal(stats.totalChannels, 0);
  assert.equal(prisma.updates.length, 0);
});

test("dry-run gera zero writes mesmo com plaintext", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain", verifyToken: "plain", appSecret: "plain" }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    logger: logger()
  });

  assert.equal(stats.mode, "dry-run");
  assert.equal(stats.plaintextSecrets, 3);
  assert.equal(prisma.updates.length, 0);
});

test("apply sem confirmacao explicita gera zero writes", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain", verifyToken: null, appSecret: null }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    logger: logger()
  });

  assert.equal(stats.mode, "dry-run");
  assert.equal(stats.aborted, true);
  assert.equal(stats.errors[0].code, "apply_requires_confirmation");
  assert.equal(stats.totalChannels, 0);
  assert.equal(prisma.updates.length, 0);
});

test("apply e idempotente", async () => {
  const prisma = createFakePrisma([
    { id: "channel-1", accessToken: "plain", verifyToken: "plain", appSecret: null }
  ]);

  const env = validEnv();
  const first = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });
  const second = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(first.convertedSecrets, 2);
  assert.equal(second.convertedSecrets, 0);
  assert.equal(second.fields.accessToken.encrypted_valid, 1);
  assert.equal(second.fields.verifyToken.encrypted_valid, 1);
});

test("falha em um secret impede update parcial do Channel", async () => {
  const prisma = createFakePrisma([
    {
      id: "channel-1",
      accessToken: "plain",
      verifyToken: "enc:v9:aes-256-gcm:v1:iv:tag:cipher",
      appSecret: "plain"
    }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.blockers, 1);
  assert.deepEqual(prisma.channels[0], {
    id: "channel-1",
    accessToken: "plain",
    verifyToken: "enc:v9:aes-256-gcm:v1:iv:tag:cipher",
    appSecret: "plain"
  });
  assert.equal(prisma.updates.length, 0);
});

test("conflito concorrente nao sobrescreve valor novo", async () => {
  const prisma = createFakePrisma(
    [{ id: "channel-1", accessToken: "plain", verifyToken: null, appSecret: null }],
    { conflictOnUpdate: true }
  );

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.skippedConcurrentChannels, 1);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(stats.errors[0].code, "concurrent_update_detected");
  assert.equal(prisma.channels[0].accessToken, "plain");
});

test("invalid envelope surgido entre preflight e apply bloqueia o canal sem update", async () => {
  let mutated = false;
  const prisma = createFakePrisma(
    [
      { id: "channel-1", accessToken: "plain", verifyToken: null, appSecret: null },
      { id: "channel-2", accessToken: "plain", verifyToken: null, appSecret: null }
    ],
    {
      beforeFindUnique(channels, id) {
        if (id === "channel-2" && !mutated) {
          mutated = true;
          const channel = channels.find((item) => item.id === id);
          channel.accessToken = "enc:v1:aes-256-gcm:v1:iv:tag";
        }
      }
    }
  );

  const stats = await runChannelSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.aborted, true);
  assert.equal(stats.convertedChannels, 1);
  assert.equal(stats.errors.at(-1).code, "invalid_envelope");
  assert.equal(prisma.channels[1].accessToken, "enc:v1:aes-256-gcm:v1:iv:tag");
});

test("logs agregados nao contem secret nem raw error message", async () => {
  const fakeLogger = logger();
  const secret = "plain-secret-should-not-appear";

  await runChannelSecretBackfill({
    prisma: createFakePrisma([
      { id: "channel-1", accessToken: secret, verifyToken: null, appSecret: null }
    ]),
    logger: fakeLogger
  });

  assert.equal(fakeLogger.lines.join("\n").includes(secret), false);
  assert.equal(sanitizeCliError(new Error("secret raw failure message")), "UNEXPECTED_ERROR");
});

test("Channel smoke ja encrypted nao sofre alteracao", async () => {
  const env = validEnv();
  const encrypted = encryptChannelSecretForBackfill("smoke-token", getBackfillEncryptionOptions(env));
  const prisma = createFakePrisma([
    {
      id: "cmtrc6wy8001051uul2sa105n",
      accessToken: null,
      verifyToken: encrypted,
      appSecret: null
    }
  ]);

  const stats = await runChannelSecretBackfill({
    prisma,
    env,
    mode: "apply",
    confirmProductionBackfill: true,
    logger: logger()
  });

  assert.equal(stats.fields.verifyToken.encrypted_valid, 1);
  assert.equal(prisma.channels[0].verifyToken, encrypted);
  assert.equal(prisma.updates.length, 0);
});

test("batching usa paginas estaveis por id", async () => {
  const stats = await runChannelSecretBackfill({
    prisma: createFakePrisma([
      { id: "channel-1", accessToken: null, verifyToken: null, appSecret: null },
      { id: "channel-2", accessToken: "plain", verifyToken: null, appSecret: null },
      { id: "channel-3", accessToken: null, verifyToken: null, appSecret: null }
    ]),
    batchSize: 1,
    logger: logger()
  });

  assert.equal(stats.totalChannels, 3);
  assert.equal(stats.plaintextSecrets, 1);
});
