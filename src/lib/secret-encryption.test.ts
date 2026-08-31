import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretEnvelope,
  readSecret,
  SecretEncryptionError,
  type SecretEncryptionOptions
} from "./secret-encryption";

const plaintext = "segredo-de-teste-nao-real";
const keyV1 = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");
const keyV2 = Buffer.from("1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100", "hex");

function options(overrides: Partial<SecretEncryptionOptions> = {}): SecretEncryptionOptions {
  return {
    activeKeyId: "v1",
    keys: {
      v1: keyV1,
      v2: keyV2
    },
    ...overrides
  };
}

function assertSecretError(error: unknown, code: SecretEncryptionError["code"]) {
  assert.equal(error instanceof SecretEncryptionError, true);
  assert.equal((error as SecretEncryptionError).code, code);
}

function replaceEnvelopePart(envelope: string, index: number, value: string) {
  const parts = envelope.split(":");
  parts[index] = value;
  return parts.join(":");
}

test("round-trip encrypt/decrypt preserva plaintext", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.equal(isEncryptedSecretEnvelope(encrypted), true);
  assert.equal(decryptSecret(encrypted, options()), plaintext);
});

test("IV aleatorio gera envelopes diferentes para o mesmo plaintext", () => {
  const first = encryptSecret(plaintext, options());
  const second = encryptSecret(plaintext, options());

  assert.notEqual(first, second);
  assert.equal(decryptSecret(first, options()), plaintext);
  assert.equal(decryptSecret(second, options()), plaintext);
});

test("tampering no ciphertext falha no decrypt", () => {
  const encrypted = encryptSecret(plaintext, options());
  const parts = encrypted.split(":");
  const ciphertext = parts[6];
  const tampered = replaceEnvelopePart(
    encrypted,
    6,
    `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`
  );

  assert.throws(() => decryptSecret(tampered, options()), (error) => {
    assertSecretError(error, "decryption_failed");
    return true;
  });
});

test("authentication tag adulterada falha no decrypt", () => {
  const encrypted = encryptSecret(plaintext, options());
  const parts = encrypted.split(":");
  const tagBytes = Buffer.from(parts[5], "base64url");

  tagBytes[0] ^= 1;
  const tamperedTag = tagBytes.toString("base64url");
  const tampered = replaceEnvelopePart(encrypted, 5, tamperedTag);

  assert.equal(Buffer.from(tamperedTag, "base64url").length, 16);
  assert.equal(isEncryptedSecretEnvelope(tampered), true);

  assert.throws(() => decryptSecret(tampered, options()), (error) => {
    assertSecretError(error, "decryption_failed");
    return true;
  });
});

test("IV adulterado falha no decrypt", () => {
  const encrypted = encryptSecret(plaintext, options());
  const parts = encrypted.split(":");
  const iv = parts[4];
  const tampered = replaceEnvelopePart(
    encrypted,
    4,
    `${iv.slice(0, -1)}${iv.endsWith("A") ? "B" : "A"}`
  );

  assert.throws(() => decryptSecret(tampered, options()), (error) => {
    assertSecretError(error, "decryption_failed");
    return true;
  });
});

test("kid adulterado para outra chave valida falha no decrypt", () => {
  const encrypted = encryptSecret(plaintext, options({ activeKeyId: "v1" }));
  const tampered = replaceEnvelopePart(encrypted, 3, "v2");

  assert.throws(() => decryptSecret(tampered, options()), (error) => {
    assertSecretError(error, "decryption_failed");
    return true;
  });
});

test("chave errada falha no decrypt", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.throws(
    () =>
      decryptSecret(
        encrypted,
        options({
          keys: { v1: randomBytes(32) }
        })
      ),
    (error) => {
      assertSecretError(error, "decryption_failed");
      return true;
    }
  );
});

test("kid inexistente falha", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.throws(
    () =>
      decryptSecret(
        encrypted,
        options({
          keys: { v2: keyV2 }
        })
      ),
    (error) => {
      assertSecretError(error, "unknown_key");
      return true;
    }
  );
});

test("envelope truncado falha", () => {
  const encrypted = encryptSecret(plaintext, options());
  const truncated = encrypted.split(":").slice(0, 6).join(":");

  assert.throws(() => readSecret(truncated, options()), (error) => {
    assertSecretError(error, "invalid_envelope");
    return true;
  });
});

test("algoritmo desconhecido falha", () => {
  const encrypted = encryptSecret(plaintext, options());
  const unsupported = replaceEnvelopePart(encrypted, 2, "aes-256-cbc");

  assert.throws(() => readSecret(unsupported, options()), (error) => {
    assertSecretError(error, "unsupported_algorithm");
    return true;
  });
});

test("versao desconhecida falha", () => {
  const encrypted = encryptSecret(plaintext, options());
  const unsupported = replaceEnvelopePart(encrypted, 1, "v2");

  assert.throws(() => readSecret(unsupported, options()), (error) => {
    assertSecretError(error, "unsupported_version");
    return true;
  });
});

test("null e preservado", () => {
  assert.equal(encryptSecret(null, options()), null);
  assert.equal(decryptSecret(null, options()), null);
  assert.equal(readSecret(null, options()), null);
});

test("undefined e preservado", () => {
  assert.equal(encryptSecret(undefined, options()), undefined);
  assert.equal(decryptSecret(undefined, options()), undefined);
  assert.equal(readSecret(undefined, options()), undefined);
});

test("empty string e preservada", () => {
  assert.equal(encryptSecret("", options()), "");
  assert.equal(decryptSecret("", options()), "");
  assert.equal(readSecret("", options()), "");
});

test("whitespace e preservado exatamente", () => {
  const value = "  \t segredo com espacos \n ";
  const encrypted = encryptSecret(value, options());

  assert.equal(decryptSecret(encrypted, options()), value);
  assert.equal(readSecret(encrypted, options()), value);
});

test("plaintext legado via readSecret continua legivel", () => {
  assert.equal(readSecret(plaintext, options()), plaintext);
});

test("envelope valido via readSecret e descriptografado", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.equal(readSecret(encrypted, options()), plaintext);
});

test("string parecida com envelope invalida nao cai para plaintext", () => {
  const invalidEnvelope = "enc:v1:aes-256-gcm:v1:iv:tag";

  assert.throws(() => readSecret(invalidEnvelope, options()), (error) => {
    assertSecretError(error, "invalid_envelope");
    return true;
  });
});

test("encryptSecret nao faz double-encrypt em envelope valido", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.equal(encryptSecret(encrypted, options()), encrypted);
});

test("encryptSecret falha para envelope valido com kid desconhecido", () => {
  const encrypted = encryptSecret(plaintext, options({ activeKeyId: "v2" }));

  assert.throws(
    () =>
      encryptSecret(
        encrypted,
        options({
          activeKeyId: "v1",
          keys: { v1: keyV1 }
        })
      ),
    (error) => {
      assertSecretError(error, "unknown_key");
      return true;
    }
  );
});

test("unicode faz round-trip corretamente", () => {
  const value = "ação 🔐 segredo 漢字";
  const encrypted = encryptSecret(value, options());

  assert.equal(decryptSecret(encrypted, options()), value);
});

test("valor longo faz round-trip corretamente", () => {
  const value = "abc123".repeat(5000);
  const encrypted = encryptSecret(value, options());

  assert.equal(decryptSecret(encrypted, options()), value);
});

test("duas keys no keyring descriptografam ciphertext v1 e v2", () => {
  const encryptedWithV1 = encryptSecret("valor-v1", options({ activeKeyId: "v1" }));
  const encryptedWithV2 = encryptSecret("valor-v2", options({ activeKeyId: "v2" }));

  assert.equal(decryptSecret(encryptedWithV1, options()), "valor-v1");
  assert.equal(decryptSecret(encryptedWithV2, options()), "valor-v2");
});

test("chave com tamanho invalido e rejeitada", () => {
  assert.throws(() => encryptSecret(plaintext, options({ keys: { v1: Buffer.alloc(31) } })), (error) => {
    assertSecretError(error, "invalid_key");
    return true;
  });
});

test("chave base64 invalida e rejeitada", () => {
  assert.throws(() => encryptSecret(plaintext, options({ keys: { v1: "not-base64!!!" } })), (error) => {
    assertSecretError(error, "invalid_key");
    return true;
  });
});

test("base64 valido de 32 bytes pode ser usado como chave", () => {
  const encrypted = encryptSecret(plaintext, options({ keys: { v1: keyV1.toString("base64") } }));

  assert.equal(decryptSecret(encrypted, options({ keys: { v1: keyV1.toString("base64") } })), plaintext);
});

test("activeKeyId invalido e rejeitado", () => {
  assert.throws(() => encryptSecret(plaintext, options({ activeKeyId: "v1:bad" })), (error) => {
    assertSecretError(error, "invalid_key_id");
    return true;
  });
});

test("activeKeyId inexistente no keyring e rejeitado para plaintext", () => {
  assert.throws(
    () =>
      encryptSecret(
        plaintext,
        options({
          activeKeyId: "missing",
          keys: { v1: keyV1 }
        })
      ),
    (error) => {
      assertSecretError(error, "unknown_key");
      return true;
    }
  );
});

test("activeKeyId inexistente no keyring e rejeitado mesmo para envelope valido", () => {
  const encrypted = encryptSecret(plaintext, options());

  assert.throws(
    () =>
      encryptSecret(
        encrypted,
        options({
          activeKeyId: "missing",
          keys: { v1: keyV1 }
        })
      ),
    (error) => {
      assertSecretError(error, "unknown_key");
      return true;
    }
  );
});

test("keyring com chave invalida e rejeitado", () => {
  assert.throws(
    () =>
      encryptSecret(
        plaintext,
        options({
          keys: {
            v1: keyV1,
            v2: Buffer.alloc(31)
          }
        })
      ),
    (error) => {
      assertSecretError(error, "invalid_key");
      return true;
    }
  );
});

test("decryptSecret rejeita plaintext nao envelopado", () => {
  assert.throws(() => decryptSecret(plaintext, options()), (error) => {
    assertSecretError(error, "invalid_envelope");
    return true;
  });
});

test("isEncryptedSecretEnvelope reconhece somente envelope estruturalmente valido", () => {
  const encrypted = encryptSecret(plaintext, options());
  const unknownKeyEnvelope = replaceEnvelopePart(encrypted, 3, "missing");

  assert.equal(isEncryptedSecretEnvelope(encrypted), true);
  assert.equal(isEncryptedSecretEnvelope(unknownKeyEnvelope), true);
  assert.equal(isEncryptedSecretEnvelope(plaintext), false);
  assert.equal(isEncryptedSecretEnvelope("enc:v1:aes-256-gcm:v1:iv:tag"), false);
});

test("mensagens de erro nao revelam plaintext, chave ou ciphertext completo", () => {
  const sensitivePlaintext = "nao-vazar-plaintext";
  const sensitiveKey = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "hex");
  const encrypted = encryptSecret(sensitivePlaintext, options({ keys: { v1: sensitiveKey } }));

  assert.throws(
    () =>
      decryptSecret(
        encrypted,
        options({
          keys: { v1: Buffer.from("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "hex") }
        })
      ),
    (error) => {
      const message = String((error as Error).message);

      assert.equal(message.includes(sensitivePlaintext), false);
      assert.equal(message.includes(sensitiveKey.toString("hex")), false);
      assert.equal(message.includes(encrypted), false);
      assertSecretError(error, "decryption_failed");
      return true;
    }
  );
});
