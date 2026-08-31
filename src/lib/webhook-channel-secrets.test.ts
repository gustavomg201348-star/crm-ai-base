import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyMetaSignature } from "@/lib/meta-whatsapp";
import { encryptSecret, type SecretEncryptionOptions } from "@/lib/secret-encryption";
import {
  resolveWebhookAcceptedVerifyTokens,
  resolveWebhookAppSecret
} from "@/lib/webhook-channel-secrets";

const verifyToken = "verify-token-teste-nao-real";
const appSecret = "app-secret-teste-nao-real";
const key = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

const encryptionOptions: SecretEncryptionOptions = {
  activeKeyId: "v1",
  keys: { v1: key }
};

function withEncryptionKey<T>(callback: () => T) {
  const previous = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = key.toString("base64url");

  try {
    return callback();
  } finally {
    if (previous === undefined) {
      delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    } else {
      process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previous;
    }
  }
}

function signBody(rawBody: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function replaceEnvelopePart(envelope: string, index: number, value: string) {
  const parts = envelope.split(":");
  parts[index] = value;
  return parts.join(":");
}

test("webhook GET aceita verifyToken legado e enc:v1", () => {
  const encryptedVerifyToken = encryptSecret(verifyToken, encryptionOptions);

  const accepted = withEncryptionKey(() =>
    resolveWebhookAcceptedVerifyTokens(
      [
        { id: "channel-legacy", verifyToken },
        { id: "channel-encrypted", verifyToken: encryptedVerifyToken }
      ],
      undefined
    )
  );

  assert.deepEqual(accepted, [verifyToken, verifyToken]);
});

test("webhook GET preserva token plaintext saudavel quando outro Channel tem enc:v1 ilegivel", () => {
  const encryptedVerifyToken = encryptSecret(verifyToken, encryptionOptions);

  const accepted = resolveWebhookAcceptedVerifyTokens(
    [
      { id: "channel-a", verifyToken: "token-a" },
      { id: "channel-b", verifyToken: encryptedVerifyToken }
    ],
    undefined
  );

  assert.equal(accepted.includes("token-a"), true);
  assert.equal(accepted.includes(verifyToken), false);
});

test("webhook GET preserva token encrypted saudavel quando outro Channel tem enc:v1 ilegivel", () => {
  const encryptedTokenA = encryptSecret("token-a", encryptionOptions);
  const encryptedTokenB = replaceEnvelopePart(encryptSecret("token-b", encryptionOptions), 3, "unknown");

  const accepted = withEncryptionKey(() =>
    resolveWebhookAcceptedVerifyTokens(
      [
        { id: "channel-a", verifyToken: encryptedTokenA },
        { id: "channel-b", verifyToken: encryptedTokenB }
      ],
      undefined
    )
  );

  assert.equal(accepted.includes("token-a"), true);
  assert.equal(accepted.includes("token-b"), false);
});

test("webhook GET rejeita token pertencente a Channel ilegivel", () => {
  const encryptedTokenB = replaceEnvelopePart(encryptSecret("token-b", encryptionOptions), 3, "unknown");
  const accepted = withEncryptionKey(() =>
    resolveWebhookAcceptedVerifyTokens(
      [
        { id: "channel-a", verifyToken: "token-a" },
        { id: "channel-b", verifyToken: encryptedTokenB }
      ],
      undefined
    )
  );

  assert.equal(accepted.includes("token-b"), false);
});

test("webhook GET rejeita quando todos os Channel tokens estao ilegiveis e nao ha env token", () => {
  const encryptedTokenA = encryptSecret("token-a", encryptionOptions);
  const encryptedTokenB = "enc:v1:aes-256-gcm:v1:iv:tag";

  const accepted = resolveWebhookAcceptedVerifyTokens(
    [
      { id: "channel-a", verifyToken: encryptedTokenA },
      { id: "channel-b", verifyToken: encryptedTokenB }
    ],
    undefined
  );

  assert.deepEqual(accepted, []);
});

test("webhook GET preserva META_VERIFY_TOKEN quando Channel tem verifyToken ilegivel", () => {
  const encryptedVerifyToken = encryptSecret(verifyToken, encryptionOptions);
  const accepted = resolveWebhookAcceptedVerifyTokens(
    [{ id: "channel-encrypted", verifyToken: encryptedVerifyToken }],
    "env-token"
  );

  assert.deepEqual(accepted, ["env-token"]);
});

test("webhook GET nao engole erro inesperado ao ler Channel", () => {
  const unexpected = new Error("unexpected-test-error");
  const channel = {
    id: "channel-broken",
    get verifyToken(): string {
      throw unexpected;
    }
  };

  assert.throws(
    () => resolveWebhookAcceptedVerifyTokens([channel], undefined),
    unexpected
  );
});

test("webhook POST usa appSecret legado para validar assinatura Meta", () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const signature = signBody(rawBody, appSecret);
  const resolved = resolveWebhookAppSecret({
    channelId: "channel-legacy",
    channelAppSecret: appSecret,
    envAppSecret: "fallback-nao-usado"
  });

  assert.equal(
    verifyMetaSignature({ appSecret: resolved, rawBody, signature }),
    true
  );
});

test("webhook POST descriptografa appSecret enc:v1 para validar assinatura Meta", () => {
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
  const signature = signBody(rawBody, appSecret);
  const encryptedAppSecret = encryptSecret(appSecret, encryptionOptions);
  const resolved = withEncryptionKey(() =>
    resolveWebhookAppSecret({
      channelId: "channel-encrypted",
      channelAppSecret: encryptedAppSecret,
      envAppSecret: "fallback-nao-usado"
    })
  );

  assert.equal(
    verifyMetaSignature({ appSecret: resolved, rawBody, signature }),
    true
  );
});
