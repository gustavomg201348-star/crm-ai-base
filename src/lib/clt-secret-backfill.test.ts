import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  CLT_SECRET_FIELDS,
  classifyCltBackfillSecret,
  parseCltBackfillArgs,
  runCltSecretBackfill,
  sanitizeCltBackfillCliError
} from "../../scripts/backfill-clt-secrets";
import { encryptSecret, readSecret } from "@/lib/secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "@/lib/secret-encryption-env";

type Row = {
  id: string;
  apiKey: string | null;
  username: string | null;
  password: string | null;
  newcorbanIdentifier: string | null;
  digitadorCode: string | null;
  certifiedAgentCpf: string | null;
};

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    apiKey: null,
    username: null,
    password: null,
    newcorbanIdentifier: null,
    digitadorCode: null,
    certifiedAgentCpf: null,
    ...overrides
  };
}

function validEnv() {
  return { QEVORA_DATA_ENCRYPTION_KEY_V1: randomBytes(32).toString("base64") };
}

function validOptions(env = validEnv()) {
  const options = getSecretEncryptionOptionsFromEnv(env);
  assert.ok(options);
  return options;
}

function logger() {
  const lines: string[] = [];
  return { lines, log(message: string) { lines.push(message); } };
}

function createFakePrisma(initialRows: Row[], options: { conflict?: boolean } = {}) {
  const rows = initialRows.map((item) => ({ ...item }));
  const updates: Array<{ where: Record<string, unknown>; data: Record<string, string> }> = [];

  return {
    rows,
    updates,
    cltIntegration: {
      async findMany(args: {
        where: { id?: { gt?: string } };
        orderBy: { id: string };
        take: number;
        select: Record<string, boolean>;
      }) {
        assert.deepEqual(args.orderBy, { id: "asc" });
        assert.deepEqual(Object.keys(args.select).sort(), ["id", ...CLT_SECRET_FIELDS].sort());
        const after = args.where.id?.gt ?? "";
        return rows
          .filter((item) => item.id > after)
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, args.take)
          .map((item) => ({ ...item }));
      },
      async updateMany(args: {
        where: Row;
        data: Record<string, string>;
      }) {
        updates.push({ where: args.where, data: args.data });
        if (options.conflict) return { count: 0 };
        const index = rows.findIndex(
          (item) =>
            item.id === args.where.id &&
            CLT_SECRET_FIELDS.every((field) => item[field] === args.where[field])
        );
        if (index < 0) return { count: 0 };
        rows[index] = { ...rows[index], ...args.data };
        return { count: 1 };
      }
    }
  };
}

test("dry-run e o modo default fazem zero writes", async () => {
  const prisma = createFakePrisma([row("1", { apiKey: "plain" })]);
  const stats = await runCltSecretBackfill({ prisma, env: validEnv(), logger: logger() });
  assert.equal(stats.mode, "dry-run");
  assert.equal(stats.plaintextSecrets, 1);
  assert.equal(prisma.updates.length, 0);
  assert.equal(parseCltBackfillArgs([]).mode, "dry-run");
});

test("classifica plaintext nos seis campos", async () => {
  const prisma = createFakePrisma([
    row("1", Object.fromEntries(CLT_SECRET_FIELDS.map((field) => [field, `plain-${field}`])))
  ]);
  const stats = await runCltSecretBackfill({ prisma, env: validEnv(), logger: logger() });
  assert.equal(stats.plaintextSecrets, 6);
  for (const field of CLT_SECRET_FIELDS) assert.equal(stats.fields[field].plaintext, 1);
});

test("apply converte plaintext para envelope oficial legivel", async () => {
  const env = validEnv();
  const options = validOptions(env);
  const prisma = createFakePrisma([row("1", { apiKey: "plain-api-key" })]);
  const stats = await runCltSecretBackfill({
    prisma,
    env,
    mode: "apply",
    logger: logger()
  });
  assert.equal(stats.convertedIntegrations, 1);
  assert.equal(stats.convertedSecrets, 1);
  assert.match(prisma.rows[0].apiKey!, /^enc:v1:aes-256-gcm:/);
  assert.equal(readSecret(prisma.rows[0].apiKey!, options), "plain-api-key");
});

test("enc:v1 valido permanece byte-identical", async () => {
  const env = validEnv();
  const encrypted = encryptSecret("already-encrypted", validOptions(env));
  const prisma = createFakePrisma([row("1", { apiKey: encrypted })]);
  const stats = await runCltSecretBackfill({ prisma, env, mode: "apply", logger: logger() });
  assert.equal(stats.integrationsFullyEncrypted, 1);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(prisma.rows[0].apiKey, encrypted);
  assert.equal(prisma.updates.length, 0);
});

test("null, vazio e whitespace sao blank e preservados", async () => {
  const prisma = createFakePrisma([
    row("1", { apiKey: null, username: "", password: "   " })
  ]);
  const stats = await runCltSecretBackfill({ prisma, env: validEnv(), mode: "apply", logger: logger() });
  assert.equal(stats.fields.apiKey.blank, 1);
  assert.equal(stats.fields.username.blank, 1);
  assert.equal(stats.fields.password.blank, 1);
  assert.equal(prisma.rows[0].username, "");
  assert.equal(prisma.rows[0].password, "   ");
  assert.equal(prisma.updates.length, 0);
});

test("varios plaintext da mesma integracao usam uma unica atualizacao", async () => {
  const prisma = createFakePrisma([
    row("1", { apiKey: "a", username: "u", password: "p", digitadorCode: "d" })
  ]);
  const stats = await runCltSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    logger: logger()
  });
  assert.equal(stats.convertedSecrets, 4);
  assert.equal(prisma.updates.length, 1);
  assert.deepEqual(Object.keys(prisma.updates[0].data).sort(), [
    "apiKey",
    "digitadorCode",
    "password",
    "username"
  ]);
});

test("erro em um secret causa zero write para a integracao", async () => {
  const prisma = createFakePrisma([row("1", { apiKey: "ok", password: "explode" })]);
  const stats = await runCltSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    logger: logger(),
    encryptValue(value, options) {
      if (typeof value !== "string") throw new Error("unexpected non-string");
      if (value === "explode") throw new Error("sensitive raw error");
      return encryptSecret(value, options);
    }
  });
  assert.equal(stats.errors, 1);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(prisma.updates.length, 0);
  assert.equal(prisma.rows[0].apiKey, "ok");
});

test("key ausente falha fechado antes de consultar ou escrever", async () => {
  const prisma = createFakePrisma([row("1", { apiKey: "plain" })]);
  const stats = await runCltSecretBackfill({ prisma, env: {}, mode: "apply", logger: logger() });
  assert.equal(stats.aborted, true);
  assert.equal(stats.blockers, 1);
  assert.equal(stats.totalIntegrations, 0);
  assert.equal(prisma.updates.length, 0);
});

test("key invalida falha fechado", async () => {
  const prisma = createFakePrisma([row("1", { apiKey: "plain" })]);
  const stats = await runCltSecretBackfill({
    prisma,
    env: { QEVORA_DATA_ENCRYPTION_KEY_V1: randomBytes(31).toString("base64") },
    mode: "apply",
    logger: logger()
  });
  assert.equal(stats.aborted, true);
  assert.equal(stats.blockers, 1);
  assert.equal(prisma.updates.length, 0);
});

test("envelope enc:v1 malformado vira blocker e aborta apply global", async () => {
  const prisma = createFakePrisma([
    row("1", { apiKey: "enc:v1:aes-256-gcm:v1:bad" }),
    row("2", { apiKey: "plain" })
  ]);
  const stats = await runCltSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    logger: logger()
  });
  assert.equal(stats.aborted, true);
  assert.equal(stats.blockers, 1);
  assert.equal(stats.fields.apiKey.encrypted_invalid, 1);
  assert.equal(prisma.updates.length, 0);
});

test("envelope estruturalmente valido mas ilegivel vira blocker", async () => {
  const firstEnv = validEnv();
  const encrypted = encryptSecret("secret", validOptions(firstEnv));
  const prisma = createFakePrisma([row("1", { apiKey: encrypted })]);
  const stats = await runCltSecretBackfill({ prisma, env: validEnv(), logger: logger() });
  assert.equal(stats.blockers, 1);
  assert.equal(stats.fields.apiKey.encrypted_invalid, 1);
  assert.equal(prisma.updates.length, 0);
});

test("optimistic guard detecta concorrencia sem overwrite e sem retry", async () => {
  const prisma = createFakePrisma([row("1", { apiKey: "plain", password: "plain-pass" })], {
    conflict: true
  });
  const stats = await runCltSecretBackfill({
    prisma,
    env: validEnv(),
    mode: "apply",
    logger: logger()
  });
  assert.equal(stats.conflicts, 1);
  assert.equal(stats.convertedSecrets, 0);
  assert.equal(prisma.updates.length, 1);
  assert.equal(prisma.rows[0].apiKey, "plain");
});

test("optimistic guard inclui exatamente os seis valores originais", async () => {
  const original = row("1", Object.fromEntries(CLT_SECRET_FIELDS.map((field) => [field, field])));
  const prisma = createFakePrisma([original]);
  await runCltSecretBackfill({ prisma, env: validEnv(), mode: "apply", logger: logger() });
  assert.equal(prisma.updates.length, 1);
  assert.equal(prisma.updates[0].where.id, original.id);
  for (const field of CLT_SECRET_FIELDS) {
    assert.equal(prisma.updates[0].where[field], original[field]);
  }
});

test("segundo apply e dry-run sao idempotentes", async () => {
  const env = validEnv();
  const prisma = createFakePrisma([row("1", { apiKey: "plain", username: "user" })]);
  const first = await runCltSecretBackfill({ prisma, env, mode: "apply", logger: logger() });
  const ciphertexts = { apiKey: prisma.rows[0].apiKey, username: prisma.rows[0].username };
  const second = await runCltSecretBackfill({ prisma, env, mode: "apply", logger: logger() });
  const dryRun = await runCltSecretBackfill({ prisma, env, logger: logger() });
  assert.equal(first.convertedSecrets, 2);
  assert.equal(second.convertedSecrets, 0);
  assert.equal(dryRun.plaintextSecrets, 0);
  assert.deepEqual(
    { apiKey: prisma.rows[0].apiKey, username: prisma.rows[0].username },
    ciphertexts
  );
  assert.equal(prisma.updates.length, 1);
});

test("output nao contem plaintext, ciphertext, key ou mensagem bruta", async () => {
  const env = validEnv();
  const plaintext = "secret-that-must-not-leak";
  const fakeLogger = logger();
  await runCltSecretBackfill({
    prisma: createFakePrisma([row("technical-id", { apiKey: plaintext })]),
    env,
    mode: "apply",
    logger: fakeLogger
  });
  const output = fakeLogger.lines.join("\n");
  assert.equal(output.includes(plaintext), false);
  assert.equal(output.includes(env.QEVORA_DATA_ENCRYPTION_KEY_V1), false);
  assert.equal(output.includes("enc:v1:"), false);
  assert.equal(output.includes("DATABASE_URL"), false);
  assert.equal(sanitizeCltBackfillCliError(new Error("raw secret failure")), "UNEXPECTED_ERROR");
});

test("parser aceita apply e batch size explicitos", () => {
  assert.deepEqual(parseCltBackfillArgs(["--apply", "--batch-size=10"]), {
    mode: "apply",
    batchSize: 10,
    help: false
  });
});

test("contadores distinguem integracoes vazias e totalmente criptografadas", async () => {
  const env = validEnv();
  const encrypted = encryptSecret("secret", validOptions(env));
  const stats = await runCltSecretBackfill({
    prisma: createFakePrisma([
      row("1"),
      row("2", { apiKey: encrypted, username: encrypted })
    ]),
    env,
    logger: logger()
  });
  assert.equal(stats.integrationsWithoutSecrets, 1);
  assert.equal(stats.integrationsFullyEncrypted, 1);
});
