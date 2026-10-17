import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import Module from "node:module";
import { before, test } from "node:test";
import { createReplySnapshot, replyContentDigest } from "./meta-reply-snapshot";
import { createInboundMessageWithDurableEvent } from "./conversation-inbound-event";
import type { Prisma } from "@prisma/client";

let security: typeof import("./meta-inbound-provenance");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { security = await import("./meta-inbound-provenance"); } finally { loader._load = original; }
});
const secret = "synthetic-provenance-test-secret";
function payload(items: unknown[] = [{ id: "synthetic-provider", from: "5547999999999", type: "text", text: { body: "Synthetic message" } }]) {
  return JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "synthetic-number" }, messages: items } }] }] });
}
function fakeDb(channels: Array<{ id: string; companyId: string; appSecret: string | null }> = [{ id: "channel", companyId: "company", appSecret: secret }]) {
  return { channel: { findMany: async () => channels } } as never;
}
const signature = (raw: string, key = secret) => "sha256=" + createHmac("sha256", key).update(raw).digest("hex");
async function item() {
  const rawBody = payload(); return (await security.authenticateMetaInboundBatch({ db: fakeDb(), rawBody, signature: signature(rawBody) }))[0];
}
test("valid HMAC emits runtime-bound capability, not serializable authority", async () => {
  const value = await item(); security.assertMetaInboundCapability(value.capability, value.input);
  assert.throws(() => JSON.stringify(value.capability));
  for (const forged of [{}, { ...value.capability }, structuredClone(value.capability), null, "META_WEBHOOK_HMAC_SHA256_VERIFIED"]) {
    assert.throws(() => security.assertMetaInboundCapability(forged, value.input));
  }
});
test("validated processing input is a private snapshot, not caller-owned metadata", async () => {
  const value = await item(); const trusted = security.assertMetaInboundCapability(value.capability, value.input);
  value.input.replyMetadata.optionTitle = "Changed later";
  assert.equal(trusted.replyMetadata.optionTitle, null);
  assert.throws(() => security.assertMetaInboundCapability(value.capability, value.input));
});
for (const [label, sig, channels] of [
  ["missing signature", undefined, [{ id: "channel", companyId: "company", appSecret: secret }]],
  ["invalid signature", "sha256=invalid", [{ id: "channel", companyId: "company", appSecret: secret }]],
  ["missing secret", "sha256=invalid", [{ id: "channel", companyId: "company", appSecret: null }]],
  ["missing channel", "sha256=invalid", []],
  ["ambiguous channel", "sha256=invalid", [{ id: "a", companyId: "company", appSecret: secret }, { id: "b", companyId: "company", appSecret: secret }]],
] as const) test(label + " never emits a capability", async () => {
  await assert.rejects(security.authenticateMetaInboundBatch({ db: fakeDb([...channels]), rawBody: payload(), signature: sig }), security.InboundProvenanceError);
});
for (const field of ["companyId", "channelId", "providerMessageId", "phone", "body", "name", "type", "mediaId", "fileName", "mimeType", "contextProviderMessageId", "replyMetadata"] as const) {
  test("capability rejects altered " + field, async () => {
    const value = await item(); const changed = { ...value.input, [field]: field === "replyMetadata" ? {} : "different" };
    assert.throws(() => security.assertMetaInboundCapability(value.capability, changed as never));
  });
}
test("capability cannot be used for another authenticated item", async () => {
  const rawBody = payload([{ id: "one", from: "5547999999999", type: "text", text: { body: "One" } }, { id: "two", from: "5547999999999", type: "text", text: { body: "Two" } }]);
  const [a, b] = await security.authenticateMetaInboundBatch({ db: fakeDb(), rawBody, signature: signature(rawBody) });
  assert.throws(() => security.assertMetaInboundCapability(a.capability, b.input));
});
test("malformed/skipped item invalidates whole batch", async () => {
  for (const items of [[{ from: "5547999999999", type: "text", text: { body: "No ID" } }], [{ id: "missing-content" }]]) {
    const rawBody = payload(items); await assert.rejects(security.authenticateMetaInboundBatch({ db: fakeDb(), rawBody, signature: signature(rawBody) }));
  }
});
test("oversized encoded snapshot is rejected at authentication", async () => {
  const rawBody = payload([{ id: "m".repeat(2048), context: { id: "c".repeat(2048) }, from: "5547999999999", type: "button",
    button: { text: "\u0001".repeat(1024), payload: "\u0001".repeat(2048) } }]);
  await assert.rejects(security.authenticateMetaInboundBatch({ db: fakeDb(), rawBody, signature: signature(rawBody) }), security.InboundProvenanceError);
});
test("authenticated unpaired surrogate cannot change during database UTF-8 encoding", async () => {
  const rawBody = payload([{ id: "synthetic", from: "5547999999999", type: "text", text: { body: "\ud800" } }]);
  await assert.rejects(security.authenticateMetaInboundBatch({ db: fakeDb(), rawBody, signature: signature(rawBody) }), security.InboundProvenanceError);
});
test("persistence derives only the two allowed fields from capability and exact snapshot", async () => {
  const { input, capability } = await item();
  const data = { conversationId: "conversation", direction: "inbound", body: input.body.trim(), providerMessageId: input.providerMessageId,
    metaReplySnapshot: createReplySnapshot({ companyId: input.companyId, channelId: input.channelId, contactId: "contact", conversationId: "conversation",
      providerMessageId: input.providerMessageId, senderPhone: input.phone, metadata: input.replyMetadata, contentDigest: replyContentDigest({ body: input.body.trim() }) }) };
  assert.deepEqual(security.provenanceForInboundPersistence(capability, "company", data, { contactId: "contact", channelId: "channel" }), {
    provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
  });
  for (const changed of [{ ...data, body: "Changed" }, { ...data, metaReplySnapshot: "forged" }, { ...data, mediaUrl: "https://invalid.test" }])
    assert.throws(() => security.provenanceForInboundPersistence(capability, "company", changed, { contactId: "contact", channelId: "channel" }));
});
test("generic primitive rejects nested provenance before any database call", async () => {
  for (const field of ["inboundEvent", "replies", "inboundReplyCorrelations", "sourceReplyCorrelations"]) {
    await assert.rejects(createInboundMessageWithDurableEvent({} as Prisma.TransactionClient, "company", {
      conversationId: "conversation", direction: "inbound", body: "Synthetic", [field]: { create: {} },
    } as never));
  }
});
test("static guard: sole issuer, sole Event writer, no consumer/transport or extra persistent fields", () => {
  const source = readFileSync("src/lib/meta-inbound-provenance.ts", "utf8");
  assert.match(source, /^import "server-only";/); assert.equal((source.match(/issued\.set\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /export\s+(?:const|function)\s+(?:issued|mint|issue|createCapability)|\bfetch\(/);
  for (const file of readdirSync("src", { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(file) || /\.(test|integration)\.ts$/.test(file)) continue;
    const name = file.replace(/\\/g, "/"); const text = readFileSync("src/" + file, "utf8");
    assert.doesNotMatch(text, /\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`]?ConversationInboundEvent\b/i);
    assert.doesNotMatch(text, /messages\s*:\s*\{\s*(?:create|createMany|connectOrCreate|upsert)\s*:/);
    if (name !== "lib/conversation-inbound-event.ts") assert.doesNotMatch(text, /\.conversationInboundEvent\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\(/);
    if (name !== "lib/meta-inbound-provenance.ts") assert.doesNotMatch(text, /issued\.set\(/);
    if (!["lib/meta-inbound-provenance.ts", "app/api/webhooks/whatsapp/route.ts"].includes(name))
      assert.doesNotMatch(text, /\bauthenticateMetaInboundBatch\b/);
  }
  for (const schema of ["prisma/schema.prisma", "prisma/schema.postgres.prisma"]) {
    const model = readFileSync(schema, "utf8").match(/model ConversationInboundEvent \{[\s\S]*?\n\}/)![0];
    assert.doesNotMatch(model, /\b(body|phone|payload|signature|token|secret|capability|lease|attempt)\s/i);
  }
  const route = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  assert.ok(route.indexOf("await authenticateMetaInboundBatch") < route.indexOf("data: { lastWebhookReceivedAt"));
  for (const file of ["src/app/api/channels/simulate/route.ts", "src/app/api/conversations/[id]/messages/route.ts"])
    assert.doesNotMatch(readFileSync(file, "utf8"), /provenanceKind|provenanceVersion|capability/);
});
