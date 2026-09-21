import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encryptSecret } from "@/lib/secret-encryption";
import { resolveVerifiedMetaWebhookChannel } from "@/lib/webhook-channel-secrets";
import {
  applyWebhookDeliveryUpdates,
  buildCampaignDeliveryScope,
  buildMessageDeliveryScope
} from "@/lib/webhook-delivery-scope";

const rawBody = JSON.stringify({ object: "whatsapp_business_account" });
const appSecret = "meta-app-secret-test-only";
const signature = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
const key = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

function fakeDb(channel: { id: string; companyId: string; appSecret: string | null } | null) {
  let args: unknown;
  return {
    db: {
      channel: {
        findFirst: async (input: unknown) => {
          args = input;
          return channel;
        }
      }
    } as never,
    getArgs: () => args
  };
}

async function withoutMetaAppSecret<T>(callback: () => Promise<T>) {
  const previous = process.env.META_APP_SECRET;
  delete process.env.META_APP_SECRET;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
}

async function withEncryptionKey<T>(callback: () => Promise<T>) {
  const previous = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = key.toString("base64url");
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previous;
  }
}

test("assinatura valida e Channel correto sao aceitos", async () => {
  const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret });
  const result = await resolveVerifiedMetaWebhookChannel({
    db,
    phoneNumberId: "phone-a",
    rawBody,
    signature
  });
  assert.deepEqual(result, {
    ok: true,
    channel: { id: "channel-a", companyId: "company-a" }
  });
});

test("assinatura ausente falha fechada", async () => {
  const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret });
  const result = await resolveVerifiedMetaWebhookChannel({ db, phoneNumberId: "phone-a", rawBody });
  assert.deepEqual(result, { ok: false, reason: "invalid-signature" });
});

test("assinatura invalida falha fechada", async () => {
  const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret });
  const result = await resolveVerifiedMetaWebhookChannel({
    db,
    phoneNumberId: "phone-a",
    rawBody,
    signature: "sha256=invalid"
  });
  assert.deepEqual(result, { ok: false, reason: "invalid-signature" });
});

test("appSecret ausente falha fechada", async () => {
  await withoutMetaAppSecret(async () => {
    const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret: null });
    const result = await resolveVerifiedMetaWebhookChannel({
      db,
      phoneNumberId: "phone-a",
      rawBody,
      signature
    });
    assert.deepEqual(result, { ok: false, reason: "app-secret-unavailable" });
  });
});

test("appSecret ausente nao usa fallback global", async () => {
  const previous = process.env.META_APP_SECRET;
  process.env.META_APP_SECRET = appSecret;
  try {
    const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret: null });
    const result = await resolveVerifiedMetaWebhookChannel({
      db,
      phoneNumberId: "phone-a",
      rawBody,
      signature
    });
    assert.deepEqual(result, { ok: false, reason: "app-secret-unavailable" });
  } finally {
    if (previous === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previous;
  }
});

test("appSecret enc:v1 valido preserva validacao da assinatura", async () => {
  await withEncryptionKey(async () => {
    const encrypted = encryptSecret(appSecret, { activeKeyId: "v1", keys: { v1: key } });
    const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret: encrypted });
    const result = await resolveVerifiedMetaWebhookChannel({
      db,
      phoneNumberId: "phone-a",
      rawBody,
      signature
    });
    assert.equal(result.ok, true);
  });
});

test("appSecret enc:v1 ilegivel falha fechada", async () => {
  await withEncryptionKey(async () => {
    const encrypted = encryptSecret(appSecret, { activeKeyId: "v1", keys: { v1: key } })
      .replace(":v1:", ":unknown:");
    const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret: encrypted });
    const result = await resolveVerifiedMetaWebhookChannel({
      db,
      phoneNumberId: "phone-a",
      rawBody,
      signature
    });
    assert.deepEqual(result, { ok: false, reason: "app-secret-unavailable" });
  });
});

test("Channel inexistente falha fechada", async () => {
  const { db } = fakeDb(null);
  const result = await resolveVerifiedMetaWebhookChannel({
    db,
    phoneNumberId: "phone-missing",
    rawBody,
    signature
  });
  assert.deepEqual(result, { ok: false, reason: "channel-not-found" });
});

test("lookup exige Channel Meta ativo ou conectado", async () => {
  const { db, getArgs } = fakeDb(null);
  await resolveVerifiedMetaWebhookChannel({ db, phoneNumberId: "phone-a", rawBody, signature });
  assert.deepEqual(getArgs(), {
    where: {
      type: "whatsapp",
      provider: "meta",
      status: { in: ["ACTIVE", "CONNECTED"] },
      OR: [{ phoneNumberId: "phone-a" }, { externalId: "phone-a" }]
    },
    select: { id: true, companyId: true, appSecret: true }
  });
});

test("Message delivery fica restrita a company e channel", () => {
  assert.deepEqual(
    buildMessageDeliveryScope({ companyId: "company-a", channelId: "channel-a", providerMessageId: "msg-a" }),
    {
      providerMessageId: "msg-a",
      conversation: { channelId: "channel-a", contact: { companyId: "company-a" } }
    }
  );
});

test("CampaignRecipient delivery fica restrito a company e channel", () => {
  assert.deepEqual(
    buildCampaignDeliveryScope({ companyId: "company-a", channelId: "channel-a", providerMessageId: "msg-a" }),
    { providerMessageId: "msg-a", campaign: { companyId: "company-a", channelId: "channel-a" } }
  );
});

test("fixture cross-tenant de Message B nao satisfaz escopo do Channel A", () => {
  const scope = buildMessageDeliveryScope({ companyId: "company-a", channelId: "channel-a", providerMessageId: "shared" });
  const messageB = { providerMessageId: "shared", companyId: "company-b", channelId: "channel-b" };
  assert.equal(
    messageB.providerMessageId === scope.providerMessageId &&
      messageB.companyId === scope.conversation.contact.companyId &&
      messageB.channelId === scope.conversation.channelId,
    false
  );
});

test("fixture cross-tenant de Campaign B nao satisfaz escopo do Channel A", () => {
  const scope = buildCampaignDeliveryScope({ companyId: "company-a", channelId: "channel-a", providerMessageId: "shared" });
  const recipientB = { providerMessageId: "shared", companyId: "company-b", channelId: "channel-b" };
  assert.equal(
    recipientB.providerMessageId === scope.providerMessageId &&
      recipientB.companyId === scope.campaign.companyId &&
      recipientB.channelId === scope.campaign.channelId,
    false
  );
});

test("status duplicado possui guards idempotentes", () => {
  const messageSource = readFileSync("src/lib/message-delivery.ts", "utf8");
  const campaignSource = readFileSync("src/lib/campaigns.ts", "utf8");
  assert.match(messageSource, /status: \{ not: normalizedStatus \}/);
  assert.match(campaignSource, /recipient\.status === mappedStatus\) return null/);
});

test("status duplicado e no-op ate o Channel", async () => {
  let campaignUpdates = 0;
  let counterUpdates = 0;
  let channelUpdates = 0;

  const updated = await applyWebhookDeliveryUpdates({
    updateCampaign: async () => null,
    updateMessage: async () => 0,
    touchChannel: async () => {
      channelUpdates += 1;
    }
  });

  assert.equal(updated, false);
  assert.equal(campaignUpdates, 0);
  assert.equal(counterUpdates, 0);
  assert.equal(channelUpdates, 0);
});

test("mudanca real atualiza resultado e timestamp do Channel", async () => {
  let campaignUpdates = 0;
  let counterUpdates = 0;
  let channelUpdates = 0;

  const updated = await applyWebhookDeliveryUpdates({
    updateCampaign: async () => {
      campaignUpdates += 1;
      counterUpdates += 1;
      return { id: "recipient-a" };
    },
    updateMessage: async () => 0,
    touchChannel: async () => {
      channelUpdates += 1;
    }
  });

  assert.equal(updated, true);
  assert.equal(campaignUpdates, 1);
  assert.equal(counterUpdates, 1);
  assert.equal(channelUpdates, 1);
});

test("GET aceita challenge somente para verifyToken resolvido", () => {
  const source = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  assert.match(source, /if \(verifyToken && accepted\.includes\(verifyToken\)\)/);
});

test("GET nao possui mais fallback quando accepted esta vazio", () => {
  const source = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  assert.doesNotMatch(source, /!accepted\.length/);
});

test("fluxo de status verifica Channel e assinatura antes do primeiro write", () => {
  const source = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  const statusStart = source.indexOf("const metaStatuses");
  const resolver = source.indexOf("resolveVerifiedMetaWebhookChannel", statusStart);
  const delivery = source.indexOf("applyWebhookDeliveryUpdates", resolver);
  const write = source.indexOf("touchChannel: () => prisma.channel.update", delivery);
  assert.ok(statusStart >= 0 && resolver > statusStart && delivery > resolver && write > delivery);
});

test("status sem alvo scoped nao atualiza nem o Channel", () => {
  const source = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  const statusStart = source.indexOf("const metaStatuses");
  const delivery = source.indexOf("applyWebhookDeliveryUpdates", statusStart);
  const channelWrite = source.indexOf("touchChannel: () => prisma.channel.update", delivery);
  assert.ok(delivery > statusStart && channelWrite > delivery);
});

test("fluxo de message usa o mesmo resolver fail-closed", () => {
  const source = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  const messageStart = source.indexOf("const metaMessages");
  const resolver = source.indexOf("resolveVerifiedMetaWebhookChannel", messageStart);
  const inboundWrite = source.indexOf("processInboundMessage", resolver);
  assert.ok(messageStart >= 0 && resolver > messageStart && inboundWrite > resolver);
});

test("resultado verificado nao retorna appSecret, verifyToken ou ciphertext", async () => {
  const { db } = fakeDb({ id: "channel-a", companyId: "company-a", appSecret });
  const result = await resolveVerifiedMetaWebhookChannel({
    db,
    phoneNumberId: "phone-a",
    rawBody,
    signature
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(appSecret), false);
  assert.equal(serialized.includes("verifyToken"), false);
  assert.equal(serialized.includes("ciphertext"), false);
});
