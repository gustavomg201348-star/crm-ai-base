import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import Module from "node:module";
import { before, test } from "node:test";
import { createReplySnapshot, replyContentDigest } from "./meta-reply-snapshot";
import { createInboundMessageWithDurableEvent } from "./conversation-inbound-event";
import type { Prisma } from "@prisma/client";
import ts from "typescript";
import { NextRequest, NextResponse } from "next/server";
import * as realLogger from "./safe-logger";
import * as metaWhatsapp from "./meta-whatsapp";
import { publicErrorResponse } from "./http-error-response";
import { ReplyEvidencePersistenceError } from "./meta-reply-ingestion";

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
function assertNoSecondMetaIssuer(text: string) {
  // A private registry for an unrelated capability is not a Meta issuer.
  // Check Meta's branded type, including a copied issuer with a renamed registry.
  if (/\bMetaInboundCapability\b/.test(text)) {
    assert.doesNotMatch(text, /\btype\s+MetaInboundCapability\b/);
    assert.doesNotMatch(text, /\.set\s*\(/);
    assert.doesNotMatch(text, /\bas\s+MetaInboundCapability\b/);
  }
}
test("issuer guard accepts unrelated registries but rejects second Meta issuers", () => {
  assert.doesNotThrow(() => assertNoSecondMetaIssuer("const issued = new WeakMap<object, PassiveReceipt>(); issued.set(receipt, metadata);"));
  for (const source of [
    "type MetaInboundCapability = { readonly [capabilityBrand]: never };",
    "import type { MetaInboundCapability } from './meta-inbound-provenance'; issued.set(capability, input);",
    "import type { MetaInboundCapability } from './meta-inbound-provenance'; anotherRegistry.set(capability, input);",
    "const forged = {} as MetaInboundCapability;",
  ]) assert.throws(() => assertNoSecondMetaIssuer(source));
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
    if (name !== "lib/meta-inbound-provenance.ts") assertNoSecondMetaIssuer(text);
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

// Run the actual route body with the real logger and response serializer. Only
// persistence/providers are replaced; invalid input must never reach either.
async function jsonBoundaryProbe(body: string | Uint8Array, options: {
  signature?: string; production?: boolean; failure?: Error;
} = {}) {
  const calls = { reads: 0, writes: 0, ingestion: 0, external: 0 };
  const logs: unknown[][] = [];
  const unexpected = () => { calls.external++; throw new Error("UNEXPECTED_FUNCTIONAL_EFFECT"); };
  const db = new Proxy({}, { get(_target, key) {
    if (key !== "channel") { calls.writes++; throw new Error("UNEXPECTED_DATABASE_ACCESS"); }
    return {
      findMany: async () => { calls.reads++; return [{ id: "channel", companyId: "company", appSecret: secret }]; },
      update: async () => { calls.writes++; return {}; },
    };
  } });
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse },
    "@/lib/safe-logger": realLogger,
    "@/lib/http-error-response": { publicErrorResponse },
    "@/lib/meta-inbound-provenance": security,
    "@/lib/meta-whatsapp": metaWhatsapp,
    "@/lib/db": { prisma: db },
    "@/lib/meta-reply-ingestion": { ReplyEvidencePersistenceError },
    "@/lib/inbound-message": { processInboundMessage: async (input: SecurityInput & { provenance: unknown }) => {
      calls.ingestion++;
      security.assertMetaInboundCapability(input.provenance, input);
      if (options.failure) throw options.failure;
      return { id: "synthetic-conversation" };
    } },
    "@/lib/campaigns": { updateCampaignDeliveryStatus: unexpected },
    "@/lib/message-delivery": { updateMessageDeliveryStatus: unexpected },
    "@/lib/webhook-delivery-scope": { applyWebhookDeliveryUpdates: unexpected },
    "@/lib/webhook-channel-secrets": { resolveWebhookAcceptedVerifyTokens: unexpected, resolveVerifiedMetaWebhookChannel: unexpected },
  };
  const compiled = ts.transpileModule(readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as { POST(request: NextRequest): Promise<Response> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), "Unmocked route dependency"); return dependencies[name];
  }, loaded, loaded.exports);
  const env: Record<string, string | undefined> = process.env;
  const saved = { info: console.info, warn: console.warn, error: console.error, fetch: globalThis.fetch, env: env.NODE_ENV };
  try {
    console.info = console.warn = console.error = (...args: unknown[]) => { logs.push(args); };
    globalThis.fetch = async () => { calls.external++; throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
    env.NODE_ENV = options.production ? "production" : "test";
    const response = await loaded.exports.POST(new NextRequest("https://synthetic.invalid/api/webhooks/whatsapp", {
      method: "POST", body: typeof body === "string" ? body : new Uint8Array(body),
      headers: options.signature ? { "x-hub-signature-256": options.signature } : {},
    }));
    return { status: response.status, response: await response.json(), logs, calls };
  } finally {
    console.info = saved.info; console.warn = saved.warn; console.error = saved.error; globalThis.fetch = saved.fetch;
    if (saved.env === undefined) delete env.NODE_ENV; else env.NODE_ENV = saved.env;
  }
}
type SecurityInput = import("./meta-inbound-provenance").MetaInboundInput;

const logSentinel = "QEVORA_SYNTHETIC_SECRET_BODY_DO_NOT_LOG";
for (const [label, body, reason] of [
  ["invalid JSON", logSentinel, "malformed-json"],
  ["truncated JSON", '{"private":"' + logSentinel, "malformed-json"],
  ["invalid string escape", '"\\q' + logSentinel + '"', "malformed-json"],
  ["valid string root", JSON.stringify(logSentinel), "invalid-payload-shape"],
  ["number root", "123", "invalid-payload-shape"],
  ["boolean root", "true", "invalid-payload-shape"],
  ["array root", JSON.stringify([logSentinel]), "invalid-payload-shape"],
] as const) test("real logger: " + label + " never emits parser input or performs functional work", async () => {
  const result = await jsonBoundaryProbe(body);
  assert.equal(result.status, 400);
  assert.deepEqual(result.response, { error: "INVALID_REQUEST", message: "Requisicao invalida." });
  // Exact sink allowlist excludes raw exceptions, stack, snippets and dynamic labels.
  assert.deepEqual(result.logs, [["[whatsapp-webhook-audit]", "invalid-json", {
    event: "invalid-json", operation: "webhook-post", reason,
  }]]);
  assert.deepEqual(result.calls, { reads: 0, writes: 0, ingestion: 0, external: 0 });
  assert.doesNotMatch(JSON.stringify([result.logs, result.response]), /QEVORA|SyntaxError|TypeError|Unexpected token|stack|private/);
});

test("real logger: empty body keeps local and production contracts with zero effects", async () => {
  for (const production of [false, true]) {
    const result = await jsonBoundaryProbe("", { production });
    assert.equal(result.status, production ? 403 : 400);
    assert.equal(result.response.error, production ? "FORBIDDEN" : "INVALID_REQUEST");
    assert.deepEqual(result.calls, { reads: 0, writes: 0, ingestion: 0, external: 0 });
    assert.doesNotMatch(JSON.stringify(result.logs), /SyntaxError|TypeError|stack|rawBody/);
  }
});

test("real logger: invalid UTF-8 and invalid HMAC never emit request data", async () => {
  for (const [body, sig] of [[new Uint8Array([0x80]), undefined], [payload(), "sha256=invalid"]] as const) {
    const result = await jsonBoundaryProbe(body, { signature: sig });
    assert.equal(result.status, 403); assert.equal(result.response.error, "FORBIDDEN");
    assert.equal(result.calls.writes, 0); assert.equal(result.calls.ingestion, 0); assert.equal(result.calls.external, 0);
    assert.doesNotMatch(JSON.stringify([result.logs, result.response]), /Synthetic message|sha256|SyntaxError|stack/);
  }
});

test("real logger: valid signed JSON still reaches verified ingestion", async () => {
  const raw = payload(); const result = await jsonBoundaryProbe(raw, { signature: signature(raw) });
  assert.equal(result.status, 200); assert.equal(result.response.ok, true);
  assert.deepEqual(result.calls, { reads: 1, writes: 1, ingestion: 1, external: 0 });
  assert.doesNotMatch(JSON.stringify(result.logs), /Synthetic message|synthetic-provenance-test-secret|sha256/);
});

test("parse handling does not swallow classified persistence or unexpected failures", async () => {
  const raw = payload();
  for (const failure of [new ReplyEvidencePersistenceError(), new Error("SYNTHETIC_UNEXPECTED_FAILURE")]) {
    const result = await jsonBoundaryProbe(raw, { signature: signature(raw), failure });
    assert.equal(result.status, failure instanceof ReplyEvidencePersistenceError ? 503 : 500);
    assert.equal(result.response.error, "INTERNAL_ERROR"); assert.equal(result.calls.ingestion, 1);
    if (!(failure instanceof ReplyEvidencePersistenceError)) assert.ok(result.logs.some(row => row[1] === "error"));
  }
});
