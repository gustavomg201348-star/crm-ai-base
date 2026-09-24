import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  listCltIntegrations,
  mapCltIntegration,
  provisionCltIntegrations,
  resolveSensitivePasswordUpdate,
  resolveSensitiveTextUpdate
} from "@/lib/clt-settings";
import { prisma } from "@/lib/db";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";

const keyV1 = Buffer.from("c".repeat(32)).toString("base64url");

const cltSettingsSource = readFileSync(join(process.cwd(), "src/lib/clt-settings.ts"), "utf8");

test("CLT requests do not execute runtime DDL", () => {
  assert.doesNotMatch(cltSettingsSource, /ensureCltSchema/);
  assert.doesNotMatch(cltSettingsSource, /\$executeRaw(?:Unsafe)?/);
  assert.doesNotMatch(cltSettingsSource, /CREATE\s+(?:TABLE|INDEX)/i);
  assert.doesNotMatch(cltSettingsSource, /ALTER\s+TABLE/i);
});

test("listCltIntegrations is read-only and tenant-scoped", async () => {
  const delegate = prisma.cltIntegration as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const methodNames = ["findMany", "create", "update", "updateMany", "upsert", "delete"] as const;
  const originals = Object.fromEntries(methodNames.map((name) => [name, delegate[name]]));
  const calls: string[] = [];
  const rows = [{ id: "integration-1", bankId: "bmg", bankName: "BMG" }];

  delegate.findMany = async (args) => {
    calls.push("findMany");
    assert.deepEqual(args, {
      where: { companyId: "company-read-only" },
      orderBy: { bankName: "asc" }
    });
    return rows;
  };
  for (const name of methodNames.filter((name) => name !== "findMany")) {
    delegate[name] = async () => {
      calls.push(name);
      throw new Error(`${name} must not be called by listCltIntegrations`);
    };
  }

  try {
    assert.deepEqual(await listCltIntegrations("company-read-only"), rows);
    assert.deepEqual(calls, ["findMany"]);
  } finally {
    for (const name of methodNames) delegate[name] = originals[name];
  }
});

test("listCltIntegrations source contains no write, raw SQL, normalization or provider call", () => {
  const readOnlySource = cltSettingsSource.slice(
    cltSettingsSource.indexOf("export async function listCltIntegrations"),
    cltSettingsSource.indexOf("export async function provisionCltIntegrations")
  );

  assert.match(readOnlySource, /cltIntegration\.findMany/);
  assert.doesNotMatch(readOnlySource, /\.(?:create|update|updateMany|upsert|delete)\s*\(/);
  assert.doesNotMatch(readOnlySource, /\$(?:executeRaw|executeRawUnsafe|queryRaw|queryRawUnsafe)/);
  assert.doesNotMatch(readOnlySource, /cltBanks|provider|normaliz/i);
});

test("provisionCltIntegrations preserves functional provisioning without runtime DDL", () => {
  assert.match(cltSettingsSource, /findMany\(\{\s*where: \{ companyId \}/);
  assert.match(cltSettingsSource, /const missingBanks = cltBanks\.filter/);
  assert.match(cltSettingsSource, /prisma\.cltIntegration\.upsert/);
  assert.match(cltSettingsSource, /where: \{ companyId_bankId: \{ companyId, bankId: bank\.id \} \}/);
  assert.match(cltSettingsSource, /bank\.provider === "newcorban"/);
  assert.match(cltSettingsSource, /prisma\.cltIntegration\.updateMany/);
  assert.match(cltSettingsSource, /provider: \{ not: "newcorban" \}/);
  assert.match(cltSettingsSource, /orderBy: \{ bankName: "asc" \}/);
});

test("provisionCltIntegrations provisions missing banks, normalizes Mercantil and preserves custom integrations", async () => {
  const delegate = prisma.cltIntegration as unknown as {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  const original = {
    findMany: delegate.findMany,
    upsert: delegate.upsert,
    updateMany: delegate.updateMany
  };
  const upserts: unknown[] = [];
  const updates: unknown[] = [];
  const finalRows = [{ id: "custom-1", bankId: "custom-bank", bankName: "Custom Bank" }];
  let reads = 0;

  delegate.findMany = async (args) => {
    reads += 1;
    assert.deepEqual(args, reads === 1 ? { where: { companyId: "company-1" } } : {
      where: { companyId: "company-1" },
      orderBy: { bankName: "asc" }
    });
    return reads === 1
      ? [
          { id: "custom-1", bankId: "custom-bank", bankName: "Custom Bank" },
          { id: "mercantil-legacy", bankId: "mercantil", bankName: "Mercantil", provider: "manual" }
        ]
      : finalRows;
  };
  delegate.upsert = async (args) => {
    upserts.push(args);
    return {};
  };
  delegate.updateMany = async (args) => {
    updates.push(args);
    return { count: 1 };
  };

  try {
    const result = await provisionCltIntegrations("company-1");

    assert.equal(reads, 2);
    assert.deepEqual(result, finalRows);
    assert.equal(upserts.length, 3);
    assert.deepEqual(
      upserts.map((entry) => (entry as { create: { bankId: string } }).create.bankId).sort(),
      ["3rn", "bmg", "c6-ficsa"]
    );
    assert.equal(
      upserts.some((entry) => (entry as { create: { bankId: string } }).create.bankId === "custom-bank"),
      false
    );
    assert.deepEqual(updates, [
      {
        where: { companyId: "company-1", bankId: "mercantil", provider: { not: "newcorban" } },
        data: {
          provider: "newcorban",
          baseUrl: "https://viva.newcorban.com.br",
          authType: "login-sms",
          status: "ASSISTED",
          lastTestMessage: "Fluxo assistido: login no Newcorban com validacao por SMS."
        }
      }
    ]);
  } finally {
    delegate.findMany = original.findMany;
    delegate.upsert = original.upsert;
    delegate.updateMany = original.updateMany;
  }
});

test("provisionCltIntegrations handles complete, one missing, three missing and empty catalogs", async () => {
  const delegate = prisma.cltIntegration as unknown as {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  const original = {
    findMany: delegate.findMany,
    upsert: delegate.upsert,
    updateMany: delegate.updateMany
  };
  const scenarios = [
    { name: "complete", existing: ["mercantil", "c6-ficsa", "bmg", "3rn"], expectedUpserts: 0 },
    { name: "one missing", existing: ["mercantil", "c6-ficsa", "bmg"], expectedUpserts: 1 },
    { name: "three missing", existing: ["mercantil"], expectedUpserts: 3 },
    { name: "empty", existing: [], expectedUpserts: 4 }
  ];

  try {
    for (const scenario of scenarios) {
      let reads = 0;
      const upserts: unknown[] = [];
      delegate.findMany = async (args) => {
        reads += 1;
        const companyId = `company-${scenario.name}`;
        assert.deepEqual(
          args,
          reads === 1
            ? { where: { companyId } }
            : { where: { companyId }, orderBy: { bankName: "asc" } }
        );
        return scenario.existing.map((bankId) => ({ bankId }));
      };
      delegate.upsert = async (args) => {
        upserts.push(args);
        return {};
      };
      delegate.updateMany = async (args) => {
        assert.deepEqual((args as { where: { companyId: string } }).where.companyId, `company-${scenario.name}`);
        return { count: 0 };
      };

      await provisionCltIntegrations(`company-${scenario.name}`);
      assert.equal(reads, 2, scenario.name);
      assert.equal(upserts.length, scenario.expectedUpserts, scenario.name);
      for (const entry of upserts) {
        assert.equal(
          (entry as { create: { companyId: string } }).create.companyId,
          `company-${scenario.name}`,
          scenario.name
        );
      }
    }
  } finally {
    delegate.findMany = original.findMany;
    delegate.upsert = original.upsert;
    delegate.updateMany = original.updateMany;
  }
});

test("provisionCltIntegrations is idempotent and preserves disabled and custom integrations", async () => {
  const delegate = prisma.cltIntegration as unknown as {
    findMany: (args: unknown) => Promise<unknown[]>;
    upsert: (args: unknown) => Promise<unknown>;
    updateMany: (args: unknown) => Promise<unknown>;
  };
  const original = {
    findMany: delegate.findMany,
    upsert: delegate.upsert,
    updateMany: delegate.updateMany
  };
  const stored = new Map<string, { bankId: string; status?: string }>([
    ["custom-bank", { bankId: "custom-bank", status: "INACTIVE" }]
  ]);
  let upsertCount = 0;

  delegate.findMany = async () => Array.from(stored.values());
  delegate.upsert = async (args) => {
    upsertCount += 1;
    const create = (args as { create: { bankId: string; status: string } }).create;
    stored.set(create.bankId, { bankId: create.bankId, status: create.status });
    return create;
  };
  delegate.updateMany = async () => ({ count: 0 });

  try {
    await provisionCltIntegrations("company-idempotent");
    assert.equal(upsertCount, 4);
    assert.deepEqual(stored.get("custom-bank"), { bankId: "custom-bank", status: "INACTIVE" });

    await provisionCltIntegrations("company-idempotent");
    assert.equal(upsertCount, 4);
    assert.deepEqual(stored.get("custom-bank"), { bankId: "custom-bank", status: "INACTIVE" });
  } finally {
    delegate.findMany = original.findMany;
    delegate.upsert = original.upsert;
    delegate.updateMany = original.updateMany;
  }
});

function encryptionOptions(): SecretEncryptionOptions {
  return {
    activeKeyId: "v1",
    keys: { v1: keyV1 }
  };
}

function withCltEncryptionKey<T>(action: () => T) {
  const previous = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = keyV1;
  try {
    return action();
  } finally {
    if (previous === undefined) {
      delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    } else {
      process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previous;
    }
  }
}

const baseIntegration = {
  id: "integration-1",
  bankId: "mercantil",
  bankName: "Mercantil",
  provider: "newcorban",
  baseUrl: "https://viva.newcorban.com.br",
  authType: "login-sms",
  apiKey: "api-key-super-secreta",
  username: "usuario.newcorban.123",
  password: "senha-super-secreta",
  newcorbanIdentifier: "identificador-newcorban-456",
  digitadorCode: "digitador-789",
  certifiedAgentCpf: "12345678900",
  actingUf: "SP",
  smsStatus: "VERIFIED",
  smsRequestedAt: new Date("2026-08-28T10:00:00.000Z"),
  status: "ASSISTED",
  lastTestAt: new Date("2026-08-28T10:05:00.000Z"),
  lastTestStatus: "SUCCESS",
  lastTestMessage: "ok",
  updatedAt: new Date("2026-08-28T10:10:00.000Z")
};

const rawSecretValues = [
  baseIntegration.apiKey,
  baseIntegration.username,
  baseIntegration.password,
  baseIntegration.newcorbanIdentifier,
  baseIntegration.digitadorCode,
  baseIntegration.certifiedAgentCpf
];

test("mapCltIntegration nao retorna campos brutos sensiveis para ADMIN", () => {
  const dto = mapCltIntegration(baseIntegration, "ADMIN");

  assert.equal("username" in dto, false);
  assert.equal("newcorbanIdentifier" in dto, false);
  assert.equal("digitadorCode" in dto, false);
  assert.equal("certifiedAgentCpf" in dto, false);
  assert.equal("password" in dto, false);
  assert.equal("apiKey" in dto, false);
  assert.equal(dto.hasUsername, true);
  assert.equal(dto.hasPassword, true);
  assert.equal(dto.hasNewcorbanIdentifier, true);
  assert.equal(dto.hasDigitadorCode, true);
  assert.equal(dto.hasCertifiedAgentCpf, true);
  assert.match(dto.usernamePreview ?? "", /\*\*\*\*/);
  assert.equal(dto.certifiedAgentCpfPreview, "***.***.***-00");

  const json = JSON.stringify(dto);
  for (const rawValue of rawSecretValues) {
    assert.equal(json.includes(rawValue), false);
  }
});

test("mapCltIntegration nao retorna campos brutos sensiveis para SUPERVISOR", () => {
  const dto = mapCltIntegration(baseIntegration, "SUPERVISOR");
  const json = JSON.stringify(dto);

  assert.equal(dto.hasUsername, true);
  assert.equal(dto.hasPassword, true);
  assert.equal(dto.hasNewcorbanIdentifier, true);
  assert.equal(dto.hasDigitadorCode, true);
  assert.equal(dto.hasCertifiedAgentCpf, true);
  assert.match(dto.usernamePreview ?? "", /\*\*\*\*/);
  assert.equal(dto.certifiedAgentCpfPreview, "***.***.***-00");
  for (const rawValue of rawSecretValues) {
    assert.equal(json.includes(rawValue), false);
  }
});

test("mapCltIntegration preserva exposicao minima para AGENT", () => {
  const dto = mapCltIntegration(baseIntegration, "AGENT");
  const json = JSON.stringify(dto);

  assert.equal(dto.hasUsername, true);
  assert.equal(dto.usernamePreview, null);
  assert.equal(dto.hasPassword, true);
  assert.equal(dto.hasNewcorbanIdentifier, true);
  assert.equal(dto.hasDigitadorCode, true);
  assert.equal(dto.hasCertifiedAgentCpf, true);
  assert.equal(dto.certifiedAgentCpfPreview, null);
  assert.equal(dto.apiKeyPreview, null);
  for (const rawValue of rawSecretValues) {
    assert.equal(json.includes(rawValue), false);
  }
});

test("mapCltIntegration gera previews a partir do plaintext resolvido de enc:v1", () => {
  withCltEncryptionKey(() => {
    const encryptedIntegration = {
      ...baseIntegration,
      apiKey: encryptSecret(baseIntegration.apiKey, encryptionOptions()),
      username: encryptSecret(baseIntegration.username, encryptionOptions()),
      password: encryptSecret(baseIntegration.password, encryptionOptions()),
      newcorbanIdentifier: encryptSecret(baseIntegration.newcorbanIdentifier, encryptionOptions()),
      digitadorCode: encryptSecret(baseIntegration.digitadorCode, encryptionOptions()),
      certifiedAgentCpf: encryptSecret(baseIntegration.certifiedAgentCpf, encryptionOptions())
    };

    const dto = mapCltIntegration(encryptedIntegration, "ADMIN");
    const json = JSON.stringify(dto);

    assert.equal(dto.hasApiKey, true);
    assert.equal(dto.hasUsername, true);
    assert.equal(dto.hasPassword, true);
    assert.equal(dto.hasNewcorbanIdentifier, true);
    assert.equal(dto.hasDigitadorCode, true);
    assert.equal(dto.hasCertifiedAgentCpf, true);
    assert.match(dto.usernamePreview ?? "", /\*\*\*\*/);
    assert.equal(dto.certifiedAgentCpfPreview, "***.***.***-00");

    for (const rawValue of rawSecretValues) {
      assert.equal(json.includes(rawValue), false);
    }

    for (const encryptedValue of [
      encryptedIntegration.apiKey,
      encryptedIntegration.username,
      encryptedIntegration.password,
      encryptedIntegration.newcorbanIdentifier,
      encryptedIntegration.digitadorCode,
      encryptedIntegration.certifiedAgentCpf
    ]) {
      assert.equal(json.includes(encryptedValue), false);
    }
  });
});

test("mapCltIntegration mantem restricoes de AGENT com secrets enc:v1", () => {
  withCltEncryptionKey(() => {
    const encryptedIntegration = {
      ...baseIntegration,
      apiKey: encryptSecret(baseIntegration.apiKey, encryptionOptions()),
      username: encryptSecret(baseIntegration.username, encryptionOptions()),
      password: encryptSecret(baseIntegration.password, encryptionOptions()),
      newcorbanIdentifier: encryptSecret(baseIntegration.newcorbanIdentifier, encryptionOptions()),
      digitadorCode: encryptSecret(baseIntegration.digitadorCode, encryptionOptions()),
      certifiedAgentCpf: encryptSecret(baseIntegration.certifiedAgentCpf, encryptionOptions())
    };

    const dto = mapCltIntegration(encryptedIntegration, "AGENT");
    const json = JSON.stringify(dto);

    assert.equal(dto.hasApiKey, true);
    assert.equal(dto.apiKeyPreview, null);
    assert.equal(dto.hasUsername, true);
    assert.equal(dto.usernamePreview, null);
    assert.equal(dto.certifiedAgentCpfPreview, null);

    for (const rawValue of rawSecretValues) {
      assert.equal(json.includes(rawValue), false);
    }
  });
});

test("resolveSensitiveTextUpdate preserva valor existente quando campo esta ausente", () => {
  assert.equal(resolveSensitiveTextUpdate("valor-atual", undefined), "valor-atual");
});

test("resolveSensitiveTextUpdate preserva valor existente com string vazia ou whitespace", () => {
  assert.equal(resolveSensitiveTextUpdate("valor-atual", ""), "valor-atual");
  assert.equal(resolveSensitiveTextUpdate("valor-atual", "   "), "valor-atual");
});

test("resolveSensitiveTextUpdate substitui somente com novo valor explicito", () => {
  assert.equal(resolveSensitiveTextUpdate("valor-atual", " novo-valor "), "novo-valor");
});

test("resolveSensitiveTextUpdate nao persiste preview mascarado como valor real", () => {
  assert.equal(resolveSensitiveTextUpdate("valor-atual", "us****23"), "valor-atual");
});

test("resolveSensitivePasswordUpdate preserva senha ausente, vazia, whitespace ou mascarada", () => {
  assert.equal(resolveSensitivePasswordUpdate("senha-atual", undefined), "senha-atual");
  assert.equal(resolveSensitivePasswordUpdate("senha-atual", ""), "senha-atual");
  assert.equal(resolveSensitivePasswordUpdate("senha-atual", "   "), "senha-atual");
  assert.equal(resolveSensitivePasswordUpdate("senha-atual", "****"), "senha-atual");
});

test("resolveSensitivePasswordUpdate substitui senha com novo valor explicito", () => {
  assert.equal(resolveSensitivePasswordUpdate("senha-atual", " nova senha "), " nova senha ");
});

test("helpers de update preservam envelope enc:v1 existente byte-identical quando input ausente/vazio", () => {
  const encrypted = encryptSecret("valor-atual", encryptionOptions());

  assert.equal(resolveSensitiveTextUpdate(encrypted, undefined), encrypted);
  assert.equal(resolveSensitiveTextUpdate(encrypted, ""), encrypted);
  assert.equal(resolveSensitiveTextUpdate(encrypted, "   "), encrypted);
  assert.equal(resolveSensitiveTextUpdate(encrypted, "ma****do"), encrypted);
  assert.equal(resolveSensitivePasswordUpdate(encrypted, undefined), encrypted);
  assert.equal(resolveSensitivePasswordUpdate(encrypted, ""), encrypted);
  assert.equal(resolveSensitivePasswordUpdate(encrypted, "   "), encrypted);
  assert.equal(resolveSensitivePasswordUpdate(encrypted, "****"), encrypted);
});

test("novos inputs continuam sendo salvos como plaintext nesta fase", () => {
  assert.equal(resolveSensitiveTextUpdate("enc:v1:existing", " novo "), "novo");
  assert.equal(resolveSensitivePasswordUpdate("enc:v1:existing", " nova senha "), " nova senha ");
});
