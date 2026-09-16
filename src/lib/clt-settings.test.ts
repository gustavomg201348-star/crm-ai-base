import assert from "node:assert/strict";
import test from "node:test";
import {
  mapCltIntegration,
  resolveSensitivePasswordUpdate,
  resolveSensitiveTextUpdate
} from "@/lib/clt-settings";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";

const keyV1 = Buffer.from("c".repeat(32)).toString("base64url");

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
