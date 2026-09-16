import assert from "node:assert/strict";
import test from "node:test";
import {
  CltSecretResolutionError,
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
