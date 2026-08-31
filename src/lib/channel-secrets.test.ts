import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  ChannelSecretResolutionError,
  resolveChannelAccessToken,
  resolveChannelAppSecret,
  resolveChannelSecret,
  resolveChannelVerifyToken
} from "@/lib/channel-secrets";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";
import {
  CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV,
  getSecretEncryptionKeyStatus,
  getSecretEncryptionOptionsFromEnv
} from "@/lib/secret-encryption-env";

const plaintext = "segredo-legado-de-teste-nao-real";
const key = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
const otherKey = Buffer.from("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", "hex");

function options(overrides: Partial<SecretEncryptionOptions> = {}): SecretEncryptionOptions {
  return {
    activeKeyId: "v1",
    keys: { v1: key },
    ...overrides
  };
}

function encryptedSecret() {
  return encryptSecret(plaintext, options());
}

function assertChannelSecretError(
  error: unknown,
  code: ChannelSecretResolutionError["code"],
  field: ChannelSecretResolutionError["field"]
) {
  assert.equal(error instanceof ChannelSecretResolutionError, true);
  assert.equal((error as ChannelSecretResolutionError).code, code);
  assert.equal((error as ChannelSecretResolutionError).field, field);
}

function replaceEnvelopePart(envelope: string, index: number, value: string) {
  const parts = envelope.split(":");
  parts[index] = value;
  return parts.join(":");
}

test("plaintext legado e lido sem chave de criptografia", () => {
  assert.equal(resolveChannelAccessToken(plaintext, { encryptionOptions: null }), plaintext);
});

test("plaintext legado preserva whitespace exatamente", () => {
  const value = "  token-legado  ";

  assert.equal(resolveChannelAccessToken(value, { encryptionOptions: null }), value);
});

test("null, undefined e string vazia permanecem sem descriptografia", () => {
  assert.equal(resolveChannelAccessToken(null, { encryptionOptions: null }), null);
  assert.equal(resolveChannelAccessToken(undefined, { encryptionOptions: null }), null);
  assert.equal(resolveChannelAccessToken("", { encryptionOptions: null }), "");
});

test("accessToken enc:v1 e descriptografado com chave disponivel", () => {
  assert.equal(
    resolveChannelAccessToken(encryptedSecret(), { encryptionOptions: options() }),
    plaintext
  );
});

test("verifyToken enc:v1 e descriptografado com chave disponivel", () => {
  assert.equal(
    resolveChannelVerifyToken(encryptedSecret(), { encryptionOptions: options() }),
    plaintext
  );
});

test("appSecret enc:v1 e descriptografado com chave disponivel", () => {
  assert.equal(
    resolveChannelAppSecret(encryptedSecret(), { encryptionOptions: options() }),
    plaintext
  );
});

test("enc:v1 sem chave configurada falha fechado", () => {
  assert.throws(
    () => resolveChannelAccessToken(encryptedSecret(), { encryptionOptions: null }),
    (error) => {
      assertChannelSecretError(error, "missing_key", "accessToken");
      return true;
    }
  );
});

test("envelope invalido falha fechado sem cair para plaintext", () => {
  assert.throws(
    () => resolveChannelVerifyToken("enc:v1:aes-256-gcm:v1:iv:tag", { encryptionOptions: null }),
    (error) => {
      assertChannelSecretError(error, "invalid_envelope", "verifyToken");
      return true;
    }
  );
});

test("kid desconhecido falha fechado", () => {
  const encrypted = replaceEnvelopePart(encryptedSecret(), 3, "unknown");

  assert.throws(
    () => resolveChannelAppSecret(encrypted, { encryptionOptions: options() }),
    (error) => {
      assertChannelSecretError(error, "unknown_key", "appSecret");
      return true;
    }
  );
});

test("chave incorreta falha fechado", () => {
  assert.throws(
    () =>
      resolveChannelAccessToken(encryptedSecret(), {
        encryptionOptions: options({ keys: { v1: otherKey } })
      }),
    (error) => {
      assertChannelSecretError(error, "decryption_failed", "accessToken");
      return true;
    }
  );
});

test("chave de ambiente valida gera opcoes sem expor segredo", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
  };

  assert.deepEqual(getSecretEncryptionKeyStatus(env), {
    configured: true,
    status: "configured"
  });
  assert.equal(getSecretEncryptionOptionsFromEnv(env)?.activeKeyId, "v1");
});

test("chave de ambiente ausente e lazy e nao quebra plaintext legado", () => {
  const env = {};

  assert.deepEqual(getSecretEncryptionKeyStatus(env), {
    configured: false,
    status: "missing"
  });
  assert.equal(resolveChannelSecret(plaintext, "accessToken", { env }), plaintext);
});

test("chave de ambiente invalida e sinalizada pela readiness", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: randomBytes(8).toString("base64url")
  };

  assert.deepEqual(getSecretEncryptionKeyStatus(env), {
    configured: true,
    status: "invalid"
  });
});
