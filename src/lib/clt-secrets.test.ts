import assert from "node:assert/strict";
import test from "node:test";
import {
  CltSecretResolutionError,
  CltSecretStorageError,
  prepareCltSecretForStorage,
  prepareCltSecretPasswordUpdate,
  prepareCltSecretTextUpdate,
  resolveCltApiKey,
  resolveCltCertifiedAgentCpf,
  resolveCltDigitadorCode,
  resolveCltNewcorbanIdentifier,
  resolveCltPassword,
  resolveCltSecret,
  resolveCltUsername,
  type CltSecretField
} from "@/lib/clt-secrets";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";
import {
  CLT_SECRET_ENCRYPTED_WRITES_ENV,
  CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV,
  getCltSecretEncryptionReadiness,
  isCltSecretEncryptedWritesEnabled
} from "@/lib/secret-encryption-env";

const keyV1 = Buffer.from("a".repeat(32)).toString("base64url");
const keyV2 = Buffer.from("b".repeat(32)).toString("base64url");

function options(): SecretEncryptionOptions {
  return {
    activeKeyId: "v1",
    keys: { v1: keyV1 }
  };
}

function tamperEnvelopePart(envelope: string, partIndex: number) {
  const parts = envelope.split(":");
  const bytes = Buffer.from(parts[partIndex], "base64url");
  bytes[0] ^= 1;
  parts[partIndex] = bytes.toString("base64url");
  return parts.join(":");
}

function assertCltSecretError(
  action: () => unknown,
  code: CltSecretResolutionError["code"],
  field: CltSecretField,
  forbiddenText?: string
) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof CltSecretResolutionError, true);
    assert.equal((error as CltSecretResolutionError).code, code);
    assert.equal((error as CltSecretResolutionError).field, field);
    if (forbiddenText) {
      assert.equal(String((error as Error).message).includes(forbiddenText), false);
    }
    return true;
  });
}

function assertCltStorageError(
  action: () => unknown,
  code: CltSecretStorageError["code"],
  field: CltSecretField,
  forbiddenText?: string
) {
  assert.throws(action, (error) => {
    assert.equal(error instanceof CltSecretStorageError, true);
    assert.equal((error as CltSecretStorageError).code, code);
    assert.equal((error as CltSecretStorageError).field, field);
    if (forbiddenText) {
      assert.equal(String((error as Error).message).includes(forbiddenText), false);
    }
    return true;
  });
}

test("resolveCltSecret retorna plaintext legado sem exigir key", () => {
  assert.equal(resolveCltSecret("plain-api-key", "apiKey", { env: {} }), "plain-api-key");
});

test("resolveCltSecret descriptografa enc:v1 valido", () => {
  const encrypted = encryptSecret("usuario-clt", options());

  assert.equal(resolveCltSecret(encrypted, "username", { encryptionOptions: options() }), "usuario-clt");
});

test("resolveCltSecret preserva null e empty", () => {
  assert.equal(resolveCltSecret(null, "password", { env: {} }), null);
  assert.equal(resolveCltSecret(undefined, "password", { env: {} }), null);
  assert.equal(resolveCltSecret("", "password", { env: {} }), "");
});

test("resolveCltSecret falha fechado para enc:v1 sem key", () => {
  const encrypted = encryptSecret("senha-clt", options());

  assertCltSecretError(
    () => resolveCltSecret(encrypted, "password", { env: {} }),
    "missing_key",
    "password",
    encrypted
  );
});

test("resolveCltSecret falha fechado para key invalida", () => {
  const encrypted = encryptSecret("senha-clt", options());

  assertCltSecretError(
    () =>
      resolveCltSecret(encrypted, "password", {
        env: { QEVORA_DATA_ENCRYPTION_KEY_V1: "invalid-key" }
      }),
    "invalid_key",
    "password",
    encrypted
  );
});

test("resolveCltSecret falha fechado para unknown kid", () => {
  const encrypted = encryptSecret("identificador", {
    activeKeyId: "v2",
    keys: { v2: keyV2 }
  });

  assertCltSecretError(
    () => resolveCltSecret(encrypted, "newcorbanIdentifier", { encryptionOptions: options() }),
    "unknown_key",
    "newcorbanIdentifier",
    encrypted
  );
});

test("resolveCltSecret falha fechado para ciphertext adulterado", () => {
  const encrypted = encryptSecret("digitador", options());
  const tampered = tamperEnvelopePart(encrypted, 6);

  assertCltSecretError(
    () => resolveCltSecret(tampered, "digitadorCode", { encryptionOptions: options() }),
    "decryption_failed",
    "digitadorCode",
    tampered
  );
});

test("resolveCltSecret falha fechado para tag adulterada", () => {
  const encrypted = encryptSecret("12345678900", options());
  const tampered = tamperEnvelopePart(encrypted, 5);

  assertCltSecretError(
    () => resolveCltSecret(tampered, "certifiedAgentCpf", { encryptionOptions: options() }),
    "decryption_failed",
    "certifiedAgentCpf",
    tampered
  );
});

test("resolveCltSecret falha fechado para envelope enc invalido", () => {
  const invalid = "enc:v1:aes-256-gcm:v1:iv:tag";

  assertCltSecretError(
    () => resolveCltSecret(invalid, "apiKey", { encryptionOptions: options() }),
    "invalid_envelope",
    "apiKey",
    invalid
  );
});

test("resolveCltSecret falha fechado para versao nao suportada", () => {
  const encrypted = encryptSecret("api-key", options()).replace("enc:v1:", "enc:v2:");

  assertCltSecretError(
    () => resolveCltSecret(encrypted, "apiKey", { encryptionOptions: options() }),
    "invalid_envelope",
    "apiKey",
    encrypted
  );
});

test("resolveCltSecret falha fechado para algoritmo nao suportado", () => {
  const encrypted = encryptSecret("api-key", options()).replace("aes-256-gcm", "aes-128-gcm");

  assertCltSecretError(
    () => resolveCltSecret(encrypted, "apiKey", { encryptionOptions: options() }),
    "invalid_envelope",
    "apiKey",
    encrypted
  );
});

test("wrappers cobrem os seis campos CLT", () => {
  assert.equal(resolveCltApiKey(encryptSecret("api", options()), { encryptionOptions: options() }), "api");
  assert.equal(resolveCltUsername(encryptSecret("user", options()), { encryptionOptions: options() }), "user");
  assert.equal(resolveCltPassword(encryptSecret("pass", options()), { encryptionOptions: options() }), "pass");
  assert.equal(
    resolveCltNewcorbanIdentifier(encryptSecret("newcorban", options()), { encryptionOptions: options() }),
    "newcorban"
  );
  assert.equal(
    resolveCltDigitadorCode(encryptSecret("digitador", options()), { encryptionOptions: options() }),
    "digitador"
  );
  assert.equal(
    resolveCltCertifiedAgentCpf(encryptSecret("12345678900", options()), { encryptionOptions: options() }),
    "12345678900"
  );
});

test("encrypted writes CLT ficam desligados por padrao e usam parsing estrito", () => {
  assert.equal(isCltSecretEncryptedWritesEnabled({}), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "false" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "0" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "1" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "yes" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: " true " }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "random" }), false);
  assert.equal(isCltSecretEncryptedWritesEnabled({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "TRUE" }), true);
});

test("flag ausente ou false preserva plaintext em nova escrita CLT", () => {
  assert.equal(prepareCltSecretForStorage("api-plain", "apiKey", { env: {} }), "api-plain");
  assert.equal(
    prepareCltSecretForStorage("user-plain", "username", {
      env: { [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "false" }
    }),
    "user-plain"
  );
});

test("flag true criptografa nova escrita CLT como enc:v1 e read-dual resolve", () => {
  const env = {
    [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: keyV1
  };
  const stored = prepareCltSecretForStorage("senha-nova", "password", { env });

  assert.ok(typeof stored === "string");
  assert.equal(stored.startsWith("enc:v1:"), true);
  assert.equal(resolveCltPassword(stored, { env }), "senha-nova");
});

test("flag true sem key ou com key invalida falha fechado sem plaintext fallback", () => {
  assertCltStorageError(
    () =>
      prepareCltSecretForStorage("segredo", "apiKey", {
        env: { [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true" }
      }),
    "missing_key",
    "apiKey",
    "segredo"
  );
  assertCltStorageError(
    () =>
      prepareCltSecretForStorage("segredo", "username", {
        env: {
          [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true",
          [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: "invalid-key"
        }
      }),
    "invalid_key",
    "username",
    "segredo"
  );
});

test("encrypted result produzido por write CLT resolve via read-dual independente da flag", () => {
  const env = {
    [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: keyV1
  };
  const stored = prepareCltSecretForStorage("digitador", "digitadorCode", { env });

  assert.equal(
    resolveCltDigitadorCode(stored, {
      env: {
        [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "false",
        [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: keyV1
      }
    }),
    "digitador"
  );
});

test("existing enc:v1 e plaintext preservados byte-identical quando nao ha novo input", () => {
  const encrypted = encryptSecret("valor-atual", options());

  assert.equal(prepareCltSecretTextUpdate(encrypted, undefined, "apiKey", { env: {} }), encrypted);
  assert.equal(prepareCltSecretTextUpdate(encrypted, "", "apiKey", { env: {} }), encrypted);
  assert.equal(prepareCltSecretTextUpdate(encrypted, "   ", "apiKey", { env: {} }), encrypted);
  assert.equal(prepareCltSecretTextUpdate(encrypted, "ma****do", "apiKey", { env: {} }), encrypted);
  assert.equal(prepareCltSecretPasswordUpdate(encrypted, undefined, { env: {} }), encrypted);
  assert.equal(prepareCltSecretPasswordUpdate(encrypted, "", { env: {} }), encrypted);
  assert.equal(prepareCltSecretPasswordUpdate(encrypted, "   ", { env: {} }), encrypted);
  assert.equal(prepareCltSecretPasswordUpdate(encrypted, "****", { env: {} }), encrypted);
  assert.equal(prepareCltSecretTextUpdate("plain-atual", undefined, "username", { env: {} }), "plain-atual");
});

test("client nao pode enviar namespace reservado enc como novo valor CLT", () => {
  const encrypted = encryptSecret("valor-client", options());

  assertCltStorageError(
    () => prepareCltSecretForStorage(encrypted, "apiKey", { env: {} }),
    "reserved_envelope",
    "apiKey",
    encrypted
  );
  assertCltStorageError(
    () => prepareCltSecretForStorage("enc:payload-arbitrario", "password", { env: {} }),
    "reserved_envelope",
    "password",
    "payload-arbitrario"
  );
});

test("os seis campos CLT podem ser criptografados e lidos via read-dual", () => {
  const env = {
    [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: keyV1
  };

  assert.equal(resolveCltApiKey(prepareCltSecretForStorage("api", "apiKey", { env }), { env }), "api");
  assert.equal(resolveCltUsername(prepareCltSecretForStorage("user", "username", { env }), { env }), "user");
  assert.equal(resolveCltPassword(prepareCltSecretForStorage("pass", "password", { env }), { env }), "pass");
  assert.equal(
    resolveCltNewcorbanIdentifier(
      prepareCltSecretForStorage("newcorban", "newcorbanIdentifier", { env }),
      { env }
    ),
    "newcorban"
  );
  assert.equal(
    resolveCltDigitadorCode(prepareCltSecretForStorage("digitador", "digitadorCode", { env }), { env }),
    "digitador"
  );
  assert.equal(
    resolveCltCertifiedAgentCpf(
      prepareCltSecretForStorage("12345678900", "certifiedAgentCpf", { env }),
      { env }
    ),
    "12345678900"
  );
});

test("readiness CLT nao derruba ambiente com flag off e exige key valida com flag on", () => {
  assert.deepEqual(getCltSecretEncryptionReadiness({}), {
    encryptedWrites: { enabled: false, status: "disabled" },
    keyV1: { configured: false, status: "missing" },
    ok: true
  });
  assert.deepEqual(
    getCltSecretEncryptionReadiness({
      [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "false",
      [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: "invalid-key"
    }),
    {
      encryptedWrites: { enabled: false, status: "disabled" },
      keyV1: { configured: true, status: "invalid" },
      ok: true
    }
  );
  assert.deepEqual(getCltSecretEncryptionReadiness({ [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true" }), {
    encryptedWrites: { enabled: true, status: "enabled" },
    keyV1: { configured: false, status: "missing" },
    ok: false
  });
  assert.deepEqual(
    getCltSecretEncryptionReadiness({
      [CLT_SECRET_ENCRYPTED_WRITES_ENV]: "true",
      [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: keyV1
    }),
    {
      encryptedWrites: { enabled: true, status: "enabled" },
      keyV1: { configured: true, status: "configured" },
      ok: true
    }
  );
});
