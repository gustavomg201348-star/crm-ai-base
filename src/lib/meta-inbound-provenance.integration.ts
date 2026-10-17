import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { readFileSync, existsSync, unlinkSync, openSync, closeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import Module from "node:module";
import { before, after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { assertInboundEventTestDatabase } from "./conversation-inbound-event-test.guard";
import { inboundEventTransaction, createInboundMessageWithDurableEvent } from "./conversation-inbound-event";
import { persistInboundMessage, validateAuthenticatedInboundReplay } from "./meta-reply-ingestion";
import { installReplySqliteIntegrity } from "./meta-reply-sqlite-integrity";
import { classifyPhoneNormalization } from "./phone-normalization.service";

const provider = assertInboundEventTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
const independent = new PrismaClient({ log: [] });
let security: typeof import("./meta-inbound-provenance");
let webhook: typeof import("../app/api/webhooks/whatsapp/route");
let manual: typeof import("../app/api/conversations/[id]/messages/route");
let simulate: typeof import("../app/api/channels/simulate/route");
let ingestion: typeof import("./inbound-message");
let sessionCompany = "";
let sessionUser = "";
const secret = "synthetic-material-app-secret";
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw new Error("EXTERNAL_HTTP_FORBIDDEN_IN_MATERIAL_TEST"); };
  if (provider === "sqlite") {
    for (const sql of readFileSync("prisma/sqlite/conversation-inbound-event-guards.sql", "utf8").split("-- statement").map(v => v.trim()).filter(Boolean)) await db.$executeRawUnsafe(sql);
    await installReplySqliteIntegrity(db, process.env.DATABASE_URL!);
  }
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => {
    if (specifier === "server-only") return {};
    if (specifier === "@/lib/db") return { prisma: db };
    if (specifier === "@/lib/auth") return { getSessionFromRequest: async () => ({ id: sessionUser, companyId: sessionCompany, role: "ADMIN" }) };
    if (specifier === "@/lib/ai-attendant.service") return { maybeSendAutomaticAiReply: async () => null };
    if (specifier === "@/lib/safe-logger") return { safeLogError: () => {}, safeLogWarn: () => {}, safeLogInfo: () => {} };
    return original.call(loader, specifier, ...args);
  };
  try {
    security = await import("./meta-inbound-provenance");
    ingestion = await import("./inbound-message");
    webhook = await import("../app/api/webhooks/whatsapp/route");
    manual = await import("../app/api/conversations/[id]/messages/route");
    simulate = await import("../app/api/channels/simulate/route");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await independent.$disconnect(); await db.$disconnect(); });
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic provenance" } });
  const other = await db.company.create({ data: { name: "Synthetic other provenance" } });
  const user = await db.user.create({ data: { companyId: company.id, name: "Synthetic", email: randomUUID() + "@invalid.test", passwordHash: "synthetic-not-a-password", role: "ADMIN" } });
  sessionUser = user.id;
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5547999999999", normalizedPhone: classifyPhoneNormalization("5547999999999").normalizedPhone } });
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: secret, phoneNumberId: randomUUID() } });
  const alternative = await db.channel.create({ data: { companyId: company.id, name: "Synthetic alternative", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: secret, phoneNumberId: randomUUID() } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
  const legacy = await db.conversation.create({ data: { contactId: contact.id, channelId: null } });
  const providerId = randomUUID();
  const raw = (id = providerId, phoneNumberId = channel.phoneNumberId!, body = "Synthetic authenticated message") => JSON.stringify({ entry: [{ changes: [{ value: {
    metadata: { phone_number_id: phoneNumberId }, messages: [{ id, from: contact.phone, type: "text", text: { body }, timestamp: "1792238400" }],
  } }] }] });
  const authenticate = async (rawBody = raw()) => (await security.authenticateMetaInboundBatch({ db, rawBody, signature: sign(rawBody) }))[0];
  const write = async (client = db, item?: Awaited<ReturnType<typeof authenticate>>) => {
    const value = item ?? await authenticate(); const { input, capability } = value;
    return persistInboundMessage(client, { conversationId: conversation.id, direction: "inbound", senderType: "customer",
      body: input.body.trim(), type: input.type ?? "text", mediaId: input.mediaId, fileName: input.fileName, mimeType: input.mimeType,
      providerMessageId: input.providerMessageId, replyToProviderMessageId: input.contextProviderMessageId ?? null }, {
      companyId: company.id, contactId: contact.id, channelId: channel.id, senderPhone: input.phone,
      contextProviderMessageId: input.contextProviderMessageId, metadata: input.replyMetadata,
    }, company.id, capability);
  };
  const events = () => db.conversationInboundEvent.findMany({ where: { conversationId: conversation.id }, orderBy: { sequence: "asc" } });
  const counter = async () => (await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).inboundEventSequence;
  return { company, other, contact, channel, alternative, conversation, legacy, providerId, raw, authenticate, write, events, counter };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, work: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    try { await work(await fixture()); }
    catch (error) {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : error instanceof security.InboundProvenanceError ? error.code : "ASSERTION_OR_OTHER";
      throw new Error("PROVENANCE_MATERIAL_FAILED:" + code);
    }
  });
}
const sign = (body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
const request = (body: string, signature?: string) => new NextRequest("https://synthetic.invalid/api/webhooks/whatsapp", {
  method: "POST", body, headers: { "Content-Type": "application/json", ...(signature ? { "x-hub-signature-256": signature } : {}) },
});
material("verified Message/Event committed atomically with only two extra fields", async f => {
  const message = await f.write(); const [event] = await f.events();
  assert.equal(event.messageId, message.id); assert.equal(event.provenanceKind, "META_WEBHOOK_HMAC_SHA256_VERIFIED");
  assert.equal(event.provenanceVersion, 1); assert.equal(await f.counter(), BigInt(1));
  assert.deepEqual(Object.keys(event).sort(), ["id", "companyId", "contactId", "channelId", "conversationId", "messageId", "sequence", "createdAt", "provenanceKind", "provenanceVersion"].sort());
});
material("rollback after actual verified Message/snapshot/Event undoes all allocation", async f => {
  const item = await f.authenticate(); let observed = false;
  await assert.rejects(db.$transaction(async tx => {
    const { createReplySnapshot, replyContentDigest } = await import("./meta-reply-snapshot");
    const data = { conversationId: f.conversation.id, direction: "inbound", body: item.input.body, providerMessageId: f.providerId,
      metaReplySnapshot: createReplySnapshot({ companyId: f.company.id, channelId: f.channel.id, contactId: f.contact.id,
        conversationId: f.conversation.id, providerMessageId: f.providerId, senderPhone: item.input.phone,
        metadata: item.input.replyMetadata, contentDigest: replyContentDigest({ body: item.input.body }) }) };
    await createInboundMessageWithDurableEvent(tx, f.company.id, data, { contactId: f.contact.id, channelId: f.channel.id }, item.capability);
    observed = await tx.conversationInboundEvent.count({ where: { conversationId: f.conversation.id, provenanceVersion: 1 } }) === 1;
    throw new Error("SYNTHETIC_ROLLBACK");
  }));
  assert.equal(observed, true); assert.equal(await f.counter(), BigInt(0)); assert.equal((await f.events()).length, 0);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 0);
});
for (const data of [
  { provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: null }, { provenanceKind: null, provenanceVersion: 1 },
  { provenanceKind: "unknown", provenanceVersion: 1 }, { provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 2 },
]) material("incoherent kind/version rejected: " + JSON.stringify(data), async f => {
  await inboundEventTransaction(db, tx => createInboundMessageWithDurableEvent(tx, f.company.id, { conversationId: f.conversation.id, direction: "inbound", body: "Synthetic" }));
  const original = (await f.events())[0]; const { id: _id, createdAt: _at, ...base } = original;
  // Delete only test Event in this disposable fixture, leaving allocated sequence for raw constraint probe.
  await db.conversationInboundEvent.delete({ where: { id: original.id } });
  await assert.rejects(db.conversationInboundEvent.create({ data: { ...base, ...data } }));
});
material("verified requires concrete channel and nonblank provider identity", async f => {
  for (const [target, id] of [[f.legacy, "present"], [f.conversation, null], [f.conversation, ""], [f.conversation, "   "]] as const) {
    await assert.rejects(db.$transaction(async tx => {
      const c = await tx.conversation.update({ where: { id: target.id }, data: { inboundEventSequence: { increment: 1 } } });
      const m = await tx.message.create({ data: { conversationId: c.id, direction: "inbound", body: "Synthetic", providerMessageId: id, metaReplySnapshot: "synthetic" } });
      await tx.conversationInboundEvent.create({ data: { companyId: f.company.id, contactId: f.contact.id, channelId: c.channelId,
        conversationId: c.id, messageId: m.id, sequence: c.inboundEventSequence,
        provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 } });
    }));
  }
});
material("scope: cross-company and cross-channel capability use roll back", async f => {
  const value = await f.authenticate();
  for (const binding of [{ companyId: f.other.id, channelId: f.channel.id }, { companyId: f.company.id, channelId: f.alternative.id }]) {
    await assert.rejects(persistInboundMessage(db, { conversationId: f.conversation.id, direction: "inbound", body: value.input.body, providerMessageId: f.providerId }, {
      companyId: binding.companyId, channelId: binding.channelId, contactId: f.contact.id, senderPhone: value.input.phone, metadata: value.input.replyMetadata,
    }, binding.companyId, value.capability));
  }
  assert.equal(await f.counter(), BigInt(0)); assert.equal((await f.events()).length, 0);
});
material("replay idempotent; P2002 concurrent loser rereads full proof before convergence", async f => {
  const item = await f.authenticate();
  const run = async (client: PrismaClient) => {
    try { return await f.write(client, item); } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const m = await client.message.findFirstOrThrow({ where: { providerMessageId: f.providerId } });
      await validateAuthenticatedInboundReplay(client, m, item.input, item.capability); return m;
    }
  };
  const [a, b] = await Promise.all([run(db), run(independent)]); assert.equal(a.id, b.id);
  await validateAuthenticatedInboundReplay(db, a, item.input, item.capability);
  assert.equal((await f.events()).length, 1); assert.equal(await f.counter(), BigInt(1));
});
material("replay never promotes unproven Event or historical Message without Event", async f => {
  const value = await f.authenticate();
  const m = await inboundEventTransaction(db, tx => createInboundMessageWithDurableEvent(tx, f.company.id, {
    conversationId: f.conversation.id, direction: "inbound", body: value.input.body, providerMessageId: f.providerId,
  }));
  await assert.rejects(validateAuthenticatedInboundReplay(db, m, value.input, value.capability), e => e instanceof security.InboundProvenanceError && e.code === "REPLAY_UNPROVEN");
  const event = (await f.events())[0];
  await assert.rejects(db.conversationInboundEvent.update({ where: { id: event.id }, data: { provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 } }));
  await db.conversationInboundEvent.delete({ where: { id: event.id } });
  await assert.rejects(validateAuthenticatedInboundReplay(db, m, value.input, value.capability));
  assert.equal((await f.events()).length, 0);
});
material("divergent authenticated replay preserves original and quarantines conflict", async f => {
  const original = await f.write(); const value = await f.authenticate(f.raw(f.providerId, f.channel.phoneNumberId!, "Divergent"));
  await assert.rejects(validateAuthenticatedInboundReplay(db, original, value.input, value.capability), e => e instanceof security.InboundProvenanceError && e.code === "REPLAY_CONFLICT");
  const stored = await db.message.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(stored.metaReplySnapshot, original.metaReplySnapshot); assert.ok(stored.metaReplyConflictSnapshot);
  await assert.rejects(validateAuthenticatedInboundReplay(db, original, (await f.authenticate()).input, (await f.authenticate()).capability));
});
material("verified Event cannot change proof or any binding", async f => {
  await f.write(); const event = (await f.events())[0];
  for (const data of [{ provenanceKind: null, provenanceVersion: null }, { companyId: f.other.id }, { channelId: f.alternative.id },
    { contactId: "missing" }, { conversationId: f.legacy.id }, { messageId: "missing" }, { sequence: BigInt(2) }, { createdAt: new Date(0) }]) {
    await assert.rejects(db.conversationInboundEvent.update({ where: { id: event.id }, data }));
  }
});
const frozenFields = ["id", "conversationId", "direction", "providerMessageId", "body", "type", "mediaId", "mediaUrl", "fileName", "mimeType",
  "replyToProviderMessageId", "replyToMessageId", "metaReplySnapshot", "senderType", "createdAt", "templateName", "templateLanguage", "templateVariables",
  "replyPreviewType", "replyPreviewBody", "replyPreviewFileName"] as const;
for (const field of frozenFields) material("verified Message freezes " + field, async f => {
  const m = await f.write();
  const reference = field === "replyToMessageId" ? await db.message.create({ data: { conversationId: f.conversation.id, direction: "outbound", body: "Synthetic reference" } }) : null;
  await assert.rejects(db.message.update({ where: { id: m.id }, data: { [field]: reference?.id ?? (field === "createdAt" ? new Date(0) : "different") } }));
});
material("operational status/readAt/conflict remain mutable", async f => {
  const m = await f.write(); const updated = await db.message.update({ where: { id: m.id }, data: { status: "read", readAt: new Date(), metaReplyConflictSnapshot: "synthetic-conflict" } });
  assert.equal(updated.status, "read"); assert.ok(updated.readAt); assert.equal(updated.metaReplyConflictSnapshot, "synthetic-conflict");
});
material("HTTP: valid webhook invokes real ingestion and persists verified proof", async f => {
  const raw = f.raw(); const response = await webhook.POST(request(raw, sign(raw)));
  assert.equal(response.status, 200); assert.equal((await f.events())[0].provenanceVersion, 1);
  assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 200);
  assert.equal((await f.events()).length, 1); assert.equal(await f.counter(), BigInt(1));
});
material("HTTP: existing unproven and divergent verified replay fail closed", async f => {
  const raw = f.raw(); assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 200);
  const changed = f.raw(f.providerId, f.channel.phoneNumberId!, "Changed replay");
  assert.equal((await webhook.POST(request(changed, sign(changed)))).status, 409);
  const otherId = randomUUID();
  await inboundEventTransaction(db, tx => createInboundMessageWithDurableEvent(tx, f.company.id, {
    conversationId: f.conversation.id, direction: "inbound", body: "Synthetic", providerMessageId: otherId,
  }));
  const unproven = f.raw(otherId); assert.equal((await webhook.POST(request(unproven, sign(unproven)))).status, 409);
  assert.equal((await f.events()).filter(e => e.provenanceVersion === 1).length, 1);
});
material("replay with a different authenticated Channel or Company never converges", async f => {
  const original = await f.write();
  const wrongChannel = await f.authenticate(f.raw(f.providerId, f.alternative.phoneNumberId!));
  await assert.rejects(validateAuthenticatedInboundReplay(db, original, wrongChannel.input, wrongChannel.capability), e => e instanceof security.InboundProvenanceError && e.code === "REPLAY_SCOPE");
  const foreign = await db.channel.create({ data: { companyId: f.other.id, name: "Synthetic foreign", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: secret, phoneNumberId: randomUUID() } });
  const wrongCompany = await f.authenticate(f.raw(f.providerId, foreign.phoneNumberId!));
  await assert.rejects(validateAuthenticatedInboundReplay(db, original, wrongCompany.input, wrongCompany.capability), e => e instanceof security.InboundProvenanceError && e.code === "REPLAY_SCOPE");
  assert.equal((await f.events()).length, 1); assert.equal(await f.counter(), BigInt(1));
});
material("HTTP: invalid HMAC/missing/wrong/ambiguous channel writes zero including touch", async f => {
  for (const [raw, sig] of [[f.raw(), "sha256=invalid"], [f.raw(), undefined], [f.raw(f.providerId, "unknown"), sign(f.raw(f.providerId, "unknown"))]] as const) {
    assert.equal((await webhook.POST(request(raw, sig))).status, 403);
  }
  await db.channel.update({ where: { id: f.alternative.id }, data: { externalId: f.channel.phoneNumberId } });
  assert.equal((await webhook.POST(request(f.raw(), sign(f.raw())))).status, 403);
  assert.equal(await db.message.count({ where: { conversationId: f.conversation.id } }), 0);
  assert.equal((await f.events()).length, 0); assert.equal((await db.channel.findUniqueOrThrow({ where: { id: f.channel.id } })).lastWebhookReceivedAt, null);
});
material("HTTP: invalid later batch item prevents first message and channel touch", async f => {
  const parsed = JSON.parse(f.raw()); const value = parsed.entry[0].changes[0].value;
  parsed.entry[0].changes.push({ value: { ...value, metadata: { phone_number_id: "missing" } } });
  const raw = JSON.stringify(parsed); assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 403);
  assert.equal((await f.events()).length, 0); assert.equal(await f.counter(), BigInt(0));
  assert.equal((await db.channel.findUniqueOrThrow({ where: { id: f.channel.id } })).lastWebhookReceivedAt, null);
});
material("HTTP: invalid UTF-8 cannot reuse signature of a replacement-character payload", async f => {
  const raw = f.raw(f.providerId, f.channel.phoneNumberId!, "Synthetic \ufffd");
  const bytes = Buffer.from(raw); const index = bytes.indexOf(Buffer.from("\ufffd")); assert.ok(index >= 0);
  const invalid = Buffer.concat([bytes.subarray(0, index), Buffer.from([0x80]), bytes.subarray(index + 3)]);
  assert.equal(new TextDecoder().decode(invalid), raw);
  const req = new NextRequest("https://synthetic.invalid/api/webhooks/whatsapp", { method: "POST", body: new Uint8Array(invalid),
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(raw) } });
  assert.equal((await webhook.POST(req)).status, 403);
  assert.equal((await f.events()).length, 0); assert.equal(await f.counter(), BigInt(0));
  assert.equal((await db.channel.findUniqueOrThrow({ where: { id: f.channel.id } })).lastWebhookReceivedAt, null);
});
material("HTTP: invalid late snapshot metadata is rejected before first functional write", async f => {
  const parsed = JSON.parse(f.raw());
  parsed.entry[0].changes[0].value.messages.push({ id: "m".repeat(2048), context: { id: "c".repeat(2048) }, from: f.contact.phone, type: "button",
    button: { payload: "\u0001".repeat(2048), text: "\u0001".repeat(1024) } });
  const raw = JSON.stringify(parsed); assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 403);
  assert.equal(await f.counter(), BigInt(0)); assert.equal((await f.events()).length, 0);
  assert.equal((await db.channel.findUniqueOrThrow({ where: { id: f.channel.id } })).lastWebhookReceivedAt, null);
});
material("HTTP: forged capability rejected before any Contact/Conversation/touch writes", async f => {
  const value = await f.authenticate();
  for (const forged of [{}, { ...value.capability }, structuredClone(value.capability), null]) {
    await assert.rejects(ingestion.processInboundMessage({ ...value.input, provenance: forged }));
  }
  assert.equal(await db.contact.count({ where: { companyId: f.company.id } }), 1);
  assert.equal(await db.conversation.count({ where: { contact: { companyId: f.company.id } } }), 2);
  assert.equal((await f.events()).length, 0);
});
material("HTTP: internal route ignores forged JSON provenance and writes unproven", async f => {
  sessionCompany = f.company.id;
  const response = await manual.POST(request(JSON.stringify({ body: "Synthetic internal", direction: "inbound", provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1 })), { params: Promise.resolve({ id: f.conversation.id }) });
  assert.equal(response.status, 200); const event = (await f.events())[0]; assert.equal(event.provenanceKind, null); assert.equal(event.provenanceVersion, null);
});
material("HTTP: admin simulate and sandbox persist unproven", async f => {
  sessionCompany = f.company.id;
  const data = JSON.stringify({ companyId: f.company.id, channelId: f.channel.id, phone: f.contact.phone, message: "Synthetic simulated", provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED" });
  assert.equal((await simulate.POST(request(data))).status, 201);
  // The production environment block is unchanged; this runner is a local test environment.
  assert.equal((await webhook.POST(request(data))).status, 200);
  const rows = await f.events(); assert.equal(rows.length, 2); assert.ok(rows.every(e => e.provenanceKind === null && e.provenanceVersion === null));
});
material("HTTP: delivery status stays scoped/authenticated and creates no inbound Event", async f => {
  const m = await db.message.create({ data: { conversationId: f.conversation.id, direction: "outbound", body: "Synthetic", providerMessageId: f.providerId } });
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: f.channel.phoneNumberId }, statuses: [{ id: f.providerId, status: "delivered" }] } }] }] });
  assert.equal((await webhook.POST(request(raw, "sha256=bad"))).status, 403);
  assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 200);
  assert.equal((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status, "delivered"); assert.equal((await f.events()).length, 0);
  const failed = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: f.channel.phoneNumberId },
    statuses: [{ id: f.providerId, status: "failed", errors: [{ code: 1, message: "Synthetic failure" }] }] } }] }] });
  assert.equal((await webhook.POST(request(failed, sign(failed)))).status, 200);
  assert.match((await db.message.findUniqueOrThrow({ where: { id: m.id } })).body, /Falha: Synthetic failure/);
});
material("delivery failure changes status without rewriting verified content", async f => {
  const m = await f.write();
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: f.channel.phoneNumberId },
    statuses: [{ id: f.providerId, status: "failed", errors: [{ code: 1, message: "Synthetic failure" }] }] } }] }] });
  assert.equal((await webhook.POST(request(raw, sign(raw)))).status, 200);
  const stored = await db.message.findUniqueOrThrow({ where: { id: m.id } });
  assert.equal(stored.status, "failed"); assert.equal(stored.body, m.body);
});
if (provider === "sqlite") test("SQLite schema/db push alone does not install provenance constraints", async () => {
  const file = path.join(os.tmpdir(), "qevora-inbound-event-without-guards-" + randomUUID() + ".db");
  const url = "file:" + file.replace(/\\/g, "/");
  assertInboundEventTestDatabase({ ...process.env, DATABASE_URL: url });
  const plain = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    closeSync(openSync(file, "wx"));
    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: url }, stdio: "pipe",
    });
    const c = await plain.company.create({ data: { name: "Synthetic no-bootstrap" } });
    const p = await plain.contact.create({ data: { companyId: c.id, name: "Synthetic", phone: "SYNTHETIC" } });
    const v = await plain.conversation.create({ data: { contactId: p.id } });
    const m = await plain.message.create({ data: { conversationId: v.id, direction: "inbound", body: "Synthetic" } });
    const e = await plain.conversationInboundEvent.create({ data: { companyId: c.id, contactId: p.id, conversationId: v.id,
      messageId: m.id, sequence: BigInt(1), provenanceKind: "INVALID_WITHOUT_BOOTSTRAP", provenanceVersion: null } });
    assert.equal(e.provenanceKind, "INVALID_WITHOUT_BOOTSTRAP");
  } catch { throw new Error("SQLITE_NO_BOOTSTRAP_PROBE_FAILED"); }
  finally {
    await plain.$disconnect();
    for (const suffix of ["", "-journal", "-wal", "-shm"]) if (existsSync(file + suffix)) unlinkSync(file + suffix);
  }
});
