import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  ChannelSecretStorageError,
  prepareChannelSecretForStorage,
  prepareChannelSecretsForCreateStorage,
  prepareChannelSecretsForUpdateStorage,
  ChannelSecretResolutionError,
  resolveChannelAccessToken,
  resolveChannelAppSecret,
  resolveChannelSecret,
  resolveChannelVerifyToken
} from "@/lib/channel-secrets";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";
import {
  CHANNEL_SECRET_ENCRYPTED_WRITES_ENV,
  CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV,
  getChannelSecretEncryptionReadiness,
  getSecretEncryptionKeyStatus,
  getSecretEncryptionOptionsFromEnv,
  isChannelSecretEncryptedWritesEnabled
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

function assertChannelStorageError(
  error: unknown,
  code: ChannelSecretStorageError["code"],
  field: ChannelSecretStorageError["field"]
) {
  assert.equal(error instanceof ChannelSecretStorageError, true);
  assert.equal((error as ChannelSecretStorageError).code, code);
  assert.equal((error as ChannelSecretStorageError).field, field);
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

test("encrypted writes ficam desligados por padrao e usam parsing estrito", () => {
  assert.equal(isChannelSecretEncryptedWritesEnabled({}), false);
  assert.equal(isChannelSecretEncryptedWritesEnabled({ [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "false" }), false);
  assert.equal(isChannelSecretEncryptedWritesEnabled({ [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "0" }), false);
  assert.equal(isChannelSecretEncryptedWritesEnabled({ [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "yes" }), false);
  assert.equal(isChannelSecretEncryptedWritesEnabled({ [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "TRUE" }), true);
});

test("flag ausente preserva plaintext em nova escrita", () => {
  assert.equal(
    prepareChannelSecretForStorage(plaintext, "accessToken", { env: {} }),
    plaintext
  );
});

test("flag false preserva plaintext em nova escrita", () => {
  assert.equal(
    prepareChannelSecretForStorage(plaintext, "verifyToken", {
      env: { [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "false" }
    }),
    plaintext
  );
});

test("flag true criptografa nova escrita como enc:v1", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
  };
  const stored = prepareChannelSecretForStorage(plaintext, "appSecret", { env });

  assert.ok(typeof stored === "string");
  assert.equal(stored.startsWith("enc:v1:"), true);
  assert.equal(resolveChannelAppSecret(stored, { env }), plaintext);
});

test("flag true sem chave falha fechado sem plaintext fallback", () => {
  assert.throws(
    () =>
      prepareChannelSecretForStorage(plaintext, "accessToken", {
        env: { [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true" }
      }),
    (error) => {
      assertChannelStorageError(error, "missing_key", "accessToken");
      assert.equal(String(error).includes(plaintext), false);
      return true;
    }
  );
});

test("flag true com chave invalida falha fechado sem plaintext fallback", () => {
  assert.throws(
    () =>
      prepareChannelSecretForStorage(plaintext, "verifyToken", {
        env: {
          [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true",
          [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: randomBytes(8).toString("base64url")
        }
      }),
    (error) => {
      assertChannelStorageError(error, "invalid_key", "verifyToken");
      assert.equal(String(error).includes(plaintext), false);
      return true;
    }
  );
});

test("null, undefined, vazio e whitespace preservam semantica de storage", () => {
  assert.equal(prepareChannelSecretForStorage(null, "accessToken", { env: {} }), null);
  assert.equal(prepareChannelSecretForStorage(undefined, "accessToken", { env: {} }), null);
  assert.equal(prepareChannelSecretForStorage("", "accessToken", { env: {} }), "");
  assert.equal(prepareChannelSecretForStorage("  token  ", "accessToken", { env: {} }), "  token  ");
});

test("client nao pode enviar envelope enc:v1 valido como novo valor", () => {
  const encrypted = encryptedSecret();

  assert.throws(
    () => prepareChannelSecretForStorage(encrypted, "accessToken", { env: {} }),
    (error) => {
      assertChannelStorageError(error, "reserved_envelope", "accessToken");
      assert.equal(String(error).includes(encrypted), false);
      return true;
    }
  );
});

test("client nao pode enviar prefixo enc invalido como novo valor", () => {
  assert.throws(
    () => prepareChannelSecretForStorage("enc:payload-arbitrario", "appSecret", { env: {} }),
    (error) => {
      assertChannelStorageError(error, "reserved_envelope", "appSecret");
      assert.equal(String(error).includes("payload-arbitrario"), false);
      return true;
    }
  );
});

test("decrypt enc:v1 independe da feature flag de escrita", () => {
  const encrypted = encryptedSecret();

  assert.equal(
    resolveChannelAccessToken(encrypted, {
      env: {
        [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "false",
        [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
      }
    }),
    plaintext
  );
});

test("readiness aceita flag off sem chave e degrada flag on sem chave", () => {
  assert.deepEqual(getChannelSecretEncryptionReadiness({}), {
    encryptedWrites: { enabled: false, status: "disabled" },
    keyV1: { configured: false, status: "missing" },
    ok: true
  });
  assert.deepEqual(
    getChannelSecretEncryptionReadiness({ [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true" }),
    {
      encryptedWrites: { enabled: true, status: "enabled" },
      keyV1: { configured: false, status: "missing" },
      ok: false
    }
  );
});

test("create prepara os tres secrets antes do write", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
  };

  const data = prepareChannelSecretsForCreateStorage(
    {
      accessToken: " access-token ",
      verifyToken: " verify-token ",
      appSecret: " app-secret "
    },
    { env }
  );

  assert.equal(resolveChannelAccessToken(data.accessToken, { env }), "access-token");
  assert.equal(resolveChannelVerifyToken(data.verifyToken, { env }), "verify-token");
  assert.equal(resolveChannelAppSecret(data.appSecret, { env }), "app-secret");
});

test("create falha antes do write se qualquer secret nao puder ser preparado", () => {
  assert.throws(
    () =>
      prepareChannelSecretsForCreateStorage(
        {
          accessToken: "access-token",
          verifyToken: "enc:payload-arbitrario",
          appSecret: "app-secret"
        },
        { env: {} }
      ),
    (error) => {
      assertChannelStorageError(error, "reserved_envelope", "verifyToken");
      return true;
    }
  );
});

test("update ausente e vazio preservam valor existente sem re-encryption", () => {
  assert.deepEqual(prepareChannelSecretsForUpdateStorage({}, { env: {} }), {});
  assert.deepEqual(
    prepareChannelSecretsForUpdateStorage(
      {
        accessToken: "",
        verifyToken: "   ",
        appSecret: null
      },
      { env: {} }
    ),
    {}
  );
});

test("update criptografa somente novo valor quando flag esta ligada", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
  };
  const data = prepareChannelSecretsForUpdateStorage({ accessToken: "novo-token" }, { env });

  assert.deepEqual(Object.keys(data), ["accessToken"]);
  assert.ok(typeof data.accessToken === "string");
  assert.equal(data.accessToken.startsWith("enc:v1:"), true);
  assert.equal(resolveChannelAccessToken(data.accessToken, { env }), "novo-token");
});

test("update sem alteracao nao converte plaintext legado nem re-encrypta ciphertext existente", () => {
  const env = {
    [CHANNEL_SECRET_ENCRYPTED_WRITES_ENV]: "true",
    [CHANNEL_SECRET_ENCRYPTION_KEY_V1_ENV]: key.toString("base64url")
  };
  const existingEncrypted = encryptedSecret();

  assert.deepEqual(prepareChannelSecretsForUpdateStorage({}, { env }), {});
  assert.equal(resolveChannelAccessToken("plaintext-legado", { env }), "plaintext-legado");
  assert.equal(resolveChannelAccessToken(existingEncrypted, { env }), plaintext);
});
