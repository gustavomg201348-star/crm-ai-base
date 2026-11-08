import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import Module, { createRequire } from "node:module";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import { createOpenCreditWhatsappConfigService } from "./opencredit-whatsapp-config.service";
import { createConversationAuthorityService } from "./conversation-authority.service";
import { bootstrapPhone } from "./opencredit-whatsapp-policy";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_WHATSAPP_POSTGRES_TEST !== "1") throw Error("DISPOSABLE_WHATSAPP_TEST_OPT_IN_REQUIRED");
const db = new PrismaClient({ log: [] }), independent = new PrismaClient({ log: [] });
const originalFetch = globalThis.fetch;
const oldKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1, oldAi = process.env.OPENAI_API_KEY;
let templates: typeof import("./whatsapp-template.service");
let ai: typeof import("./ai-attendant.service");
let webhook: typeof import("../app/api/webhooks/whatsapp/route");
let core: typeof import("./opencredit-domain-materializer");
let crypto: typeof import("./opencredit-lead-materialization-payload");
let queue: ReturnType<typeof import("./opencredit-materialization-queue.service")["createOpenCreditMaterializationQueue"]>;
let createOpenCreditWhatsappBootstrap: typeof import("./opencredit-whatsapp-bootstrap.service")["createOpenCreditWhatsappBootstrap"];
const pendingAi: Promise<unknown>[] = [];
const pipelineErrors: string[] = [];
let network: Array<{ type: string; template?: string }> = [], failNetwork = false, missingAck = false, rejectProvider = false;
const secret = "synthetic-whatsapp-app-secret";
before(async () => {
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 19).toString("base64");
  process.env.OPENAI_API_KEY = "synthetic-key-not-a-credential";
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith("https://graph.facebook.com/") && String(url).endsWith("/messages")) {
      const payload = JSON.parse(String(options?.body));
      network.push({ type: payload.type, template: payload.template?.name });
      if (payload.type === "template") {
        const dispatching = await db.openCreditWhatsappHandoff.findFirstOrThrow({ where: { state: "DISPATCHING" }, orderBy: { createdAt: "desc" } });
        assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: dispatching.outboundOperationId! } })).status, "DISPATCHING");
      }
      if (failNetwork) throw Error("SYNTHETIC_NETWORK_TIMEOUT");
      if (rejectProvider) return Response.json({ error: { message: "synthetic-private-error-must-not-be-logged", code: 100 } }, { status: 400 });
      return Response.json(missingAck ? {} : { messages: [{ id: "synthetic-ack-" + randomUUID() }] });
    }
    if (String(url) === "https://api.openai.com/v1/responses") {
      network.push({ type: "ai" });
      return Response.json({ output_text: JSON.stringify({ summary: "Synthetic", temperature: "WARM", nextAction: "Synthetic",
        suggestedReply: "Synthetic response", confidence: 90, tags: [], shouldTransferToHuman: false }) });
    }
    throw Error("UNEXPECTED_EXTERNAL_HTTP_FORBIDDEN");
  };
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
  const original = loader._load, require = createRequire(import.meta.url);
  loader._load = (name, ...args) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db") return { prisma: db };
    if (name === "@/lib/safe-logger") return { safeLogError(_area: string, error: unknown) {
      const e = error as { code?: string };
      pipelineErrors.push(["P2002", "P2034", "INVALID_CAPABILITY"].includes(e?.code ?? "") ? e.code! : "PIPELINE_ERROR");
    }, safeLogWarn() {}, safeLogInfo() {} };
    return original.call(loader, name, ...args);
  };
  try {
    ({ createOpenCreditWhatsappBootstrap } = require("./opencredit-whatsapp-bootstrap.service"));
    templates = require("./whatsapp-template.service");
    ai = require("./ai-attendant.service");
    core = require("./opencredit-domain-materializer");
    crypto = require("./opencredit-lead-materialization-payload");
    queue = require("./opencredit-materialization-queue.service").createOpenCreditMaterializationQueue(db);
    const base = loader._load;
    loader._load = (name, ...args) => name === "@/lib/ai-attendant.service" ? {
      maybeSendAutomaticAiReply: (input: Parameters<typeof ai.maybeSendAutomaticAiReply>[0]) => {
        const p = ai.maybeSendAutomaticAiReply(input); pendingAi.push(p); return p;
      }
    } : base.call(loader, name, ...args);
    // Match the existing provenance harness: ESM import and lazy persistence
    // imports must share the same private capability issuer under Node 20.
    await import("./meta-inbound-provenance");
    await import("./inbound-message");
    webhook = await import("../app/api/webhooks/whatsapp/route");
  } finally { loader._load = original; }
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (oldKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1; else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = oldKey;
  if (oldAi === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldAi;
  await independent.$disconnect(); await db.$disconnect();
});
async function fixture() {
  network = []; failNetwork = false; missingAck = false; rejectProvider = false; pendingAi.length = 0; pipelineErrors.length = 0;
  const company = await db.company.create({ data: { name: "Synthetic bridge", aiMode: "HYBRID" } });
  const actor = await db.user.create({ data: { companyId: company.id, name: "Synthetic", email: randomUUID() + "@invalid.test", role: "ADMIN", passwordHash: "synthetic" } });
  const integration = await db.openCreditIntegration.create({ data: { companyId: company.id, providerScope: "synthetic-scope", publicWebhookId: randomUUID(),
    webhookSecret: "synthetic", passiveInboundEnabled: true, materializationEnabled: true } });
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic Meta", type: "whatsapp", provider: "meta", status: "ACTIVE",
    phoneNumberId: String(Date.now()) + String(Math.floor(Math.random() * 100000)), wabaId: randomUUID(), appSecret: secret, accessToken: "synthetic-token" } });
  const template = await db.metaTemplate.create({ data: { companyId: company.id, wabaId: channel.wabaId!, name: "synthetic_welcome", language: "pt_BR",
    metaStatus: "APPROVED", operationalStatus: "READY", components: JSON.stringify([{ type: "BODY", text: "Synthetic welcome" }]) } });
  const binding = { companyId: company.id, integrationId: integration.id, providerScope: integration.providerScope!, externalLeadId: randomUUID(), eventId: randomUUID() };
  const { eventId, ...origin } = binding;
  const inbound = await db.openCreditInboundEvent.create({ data: { ...origin, eventId, eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1 } });
  const job = await db.openCreditLeadMaterialization.create({ data: { ...origin, inboundEventId: inbound.id, state: "PENDING",
    expiresAt: new Date(Date.now() + 600000), protectedEnvelope: crypto.protectMaterializationIdentity(binding, {
      cpf: "12345678909", phone: "5511987654321", name: "Synthetic", email: null }) } });
  const lease = await queue.claimPilotJob({ id: job.id, companyId: company.id, integrationId: integration.id, providerScope: integration.providerScope! });
  assert(lease); assert.equal((await core.createOpenCreditDomainMaterializer(db).process(lease))?.state, "COMPLETED");
  const completed = await db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id: job.id } });
  const contact = await db.contact.findUniqueOrThrow({ where: { id: completed.contactId! } });
  const source = await db.conversation.findUniqueOrThrow({ where: { id: completed.conversationId! } });
  const credential = (c: { accessToken: string | null }) => { if (!c.accessToken) throw Error("SYNTHETIC_NO_CREDENTIAL"); };
  const config = createOpenCreditWhatsappConfigService({ db, provider: "postgresql", credential, templates: templates.getApprovedBootstrapTemplatesForChannel });
  const input = { defaultWhatsappChannelId: channel.id, initialTemplateName: template.name, initialTemplateLanguage: template.language, autoStartEnabled: true, expectedRevision: 0 };
  const session = { id: actor.id, companyId: company.id, name: actor.name, email: actor.email, role: "ADMIN" as const };
  const deps = { db, provider: "postgresql" as const, credential, template: templates.findReadyLocalMetaTemplate, sendTemplate: templates.sendConversationTemplate,
    canAutomate: ai.shouldAutoReply, limited: async () => false };
  const bootstrap = createOpenCreditWhatsappBootstrap(deps);
  const target = { companyId: company.id, integrationId: integration.id, jobId: job.id };
  const setup = () => config.save(session, integration.id, input);
  const handoff = () => db.openCreditWhatsappHandoff.findUniqueOrThrow({ where: { jobId: job.id } });
  const sendInbound = async (messageId = "synthetic-in-" + randomUUID()) => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId },
      messages: [{ id: messageId, from: bootstrapPhone(contact), type: "text", text: { body: "Synthetic inbound" }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
    const response = await webhook.POST(new NextRequest("https://synthetic.invalid/api/webhooks/whatsapp", { method: "POST", body: raw,
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }));
    await Promise.all(pendingAi.splice(0)); assert.equal(response.status, 200, pipelineErrors.join(";")); return response;
  };
  return { company, actor, integration, channel, template, job, contact, source, config, input, session, deps, bootstrap, target, setup, handoff, sendInbound };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) { test(name, async () => run(await fixture())); }
material("missing configuration is OFF; no handoff, Meta conversation or send", async f => {
  assert.equal((await f.config.read(f.company.id, f.integration.id)).config.autoStartEnabled, false);
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "CONFIGURATION_MISSING");
  assert.equal(await db.openCreditWhatsappHandoff.count({ where: { companyId: f.company.id } }), 0); assert.equal(network.length, 0);
});
material("real template sender, durable permit, retry and restart send exactly once; provenance unchanged", async f => {
  await f.setup(); assert.equal((await f.bootstrap.bootstrap(f.target)).status, "SENT");
  assert.equal((await createOpenCreditWhatsappBootstrap({ ...f.deps, db: independent }).bootstrap(f.target)).status, "ALREADY_STARTED");
  const h = await f.handoff(); assert.equal(h.state, "SENT"); assert.ok(h.providerMessageId);
  assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: h.outboundOperationId! } })).status, "SENT");
  assert.deepEqual(await db.conversation.findUnique({ where: { id: f.source.id } }), f.source);
  const contact = await db.contact.findUniqueOrThrow({ where: { id: f.contact.id } });
  assert.equal(contact.originId, f.contact.originId); assert.equal(contact.cpf, f.contact.cpf); assert.equal(contact.phone, f.contact.phone);
  const meta = await db.conversation.findUniqueOrThrow({ where: { id: h.metaConversationId } });
  assert.equal(meta.contactId, f.contact.id); assert.equal(meta.channelId, f.channel.id); assert.equal(meta.agentId, null); assert.equal(meta.status, "BOT");
  const messages = await db.message.findMany({ where: { conversationId: meta.id } });
  assert.equal(messages.length, 1); assert.equal(messages[0].type, "template"); assert.equal(messages[0].providerMessageId, h.providerMessageId);
  assert.deepEqual(network, [{ type: "template", template: f.template.name }]);
});
material("two independent instances cannot duplicate Conversation or template", async f => {
  await f.setup(); await Promise.all([f.bootstrap.bootstrap(f.target), createOpenCreditWhatsappBootstrap({ ...f.deps, db: independent }).bootstrap(f.target)]);
  assert.equal(network.filter(n => n.type === "template").length, 1);
  assert.equal(await db.conversation.count({ where: { contactId: f.contact.id, channelId: f.channel.id } }), 1);
  assert.equal((await f.handoff()).state, "SENT");
});
for (const field of ["foreign", "provider", "inactive", "credential"] as const) material("configuration rejects invalid channel: " + field, async f => {
  if (field === "foreign") { const other = await db.company.create({ data: { name: "Synthetic foreign" } });
    const c = await db.channel.create({ data: { companyId: other.id, name: "Foreign", type: "whatsapp", provider: "meta", status: "ACTIVE", phoneNumberId: String(Date.now()) + "99999", wabaId: "synthetic", accessToken: "synthetic" } });
    f.input.defaultWhatsappChannelId = c.id;
  } else await db.channel.update({ where: { id: f.channel.id }, data: field === "provider" ? { provider: "internal" } : field === "inactive" ? { status: "INACTIVE" } : { accessToken: null } });
  await assert.rejects(f.setup(), { message: "CHANNEL_INVALID" }); assert.equal(network.length, 0);
});
material("template from another WABA or unapproved is rejected", async f => {
  await db.metaTemplate.update({ where: { id: f.template.id }, data: { metaStatus: "REJECTED" } });
  await assert.rejects(f.setup(), { message: "TEMPLATE_UNAVAILABLE" }); assert.equal(network.length, 0);
});
for (const reason of ["phone", "config", "human", "template"] as const) material("change after preparation fails closed before provider: " + reason, async f => {
  await f.setup(); const send = f.deps.sendTemplate;
  const service = createOpenCreditWhatsappBootstrap({ ...f.deps, sendTemplate: async input => {
    if (reason === "phone") await db.contact.update({ where: { id: f.contact.id }, data: { phone: "5511976543210", normalizedPhone: "5511976543210" } });
    if (reason === "config") await db.openCreditWhatsappConfig.update({ where: { integrationId: f.integration.id }, data: { revision: { increment: 1 } } });
    if (reason === "human") await db.conversation.update({ where: { id: input.conversationId }, data: { agentId: f.actor.id } });
    if (reason === "template") await db.metaTemplate.update({ where: { id: f.template.id }, data: { components: JSON.stringify([{ type: "BODY", text: "Changed synthetic" }]) } });
    return send(input);
  } });
  assert.notEqual((await service.bootstrap(f.target)).status, "SENT"); assert.equal(network.length, 0);
  assert.equal(await db.message.count({ where: { conversationId: (await f.handoff()).metaConversationId } }), 0);
});
for (const mode of ["timeout", "missing_ack"] as const) material("ambiguous provider outcome is durable UNKNOWN and never retried: " + mode, async f => {
  await f.setup(); failNetwork = mode === "timeout"; missingAck = mode === "missing_ack";
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "UNKNOWN");
  failNetwork = false; missingAck = false;
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "UNKNOWN");
  const h = await f.handoff(); assert.equal(h.state, "UNKNOWN");
  assert.equal(network.filter(n => n.type === "template").length, 1);
  assert.equal(await db.message.count({ where: { conversationId: h.metaConversationId, status: "sent" } }), 0);
});
material("real signed Meta webhook reuses bridge Conversation; HYBRID replies, human stops, queue resumes", async f => {
  await f.setup(); assert.equal((await f.bootstrap.bootstrap(f.target)).status, "SENT");
  const h = await f.handoff(), messageId = "synthetic-in-" + randomUUID();
  assert.equal((await f.sendInbound(messageId)).status, 200);
  assert.equal(await db.conversationInboundEvent.count({ where: { conversationId: h.metaConversationId } }), 1);
  assert.equal(network.filter(n => n.type === "text").length, 1);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: h.metaConversationId } })).status, "BOT");
  assert.equal((await f.sendInbound(messageId)).status, 200); assert.equal(network.filter(n => n.type === "text").length, 1);
  const scope = { companyId: f.company.id, conversationId: h.metaConversationId, channelId: f.channel.id };
  const authority = createConversationAuthorityService({ db, provider: "postgresql" });
  const current = await authority.get(scope); assert(current);
  await authority.transition({ ...scope, actorUserId: f.actor.id, expectedGeneration: current.generation, state: "HUMAN", ownerUserId: f.actor.id,
    logicalKey: randomUUID(), reason: "SYNTHETIC_HUMAN_HANDOFF" });
  await db.conversation.update({ where: { id: h.metaConversationId }, data: { agentId: f.actor.id } });
  await f.sendInbound(); assert.equal(network.filter(n => n.type === "text").length, 1);
  const human = await authority.get(scope); assert(human);
  await authority.transition({ ...scope, actorUserId: f.actor.id, expectedGeneration: human.generation, state: "HUMAN_QUEUE", ownerUserId: null,
    logicalKey: randomUUID(), reason: "SYNTHETIC_RETURN_QUEUE" });
  await db.conversation.update({ where: { id: h.metaConversationId }, data: { agentId: null } });
  await f.sendInbound(); assert.equal(network.filter(n => n.type === "text").length, 2);
  assert.equal(await db.conversation.count({ where: { contactId: f.contact.id, channelId: f.channel.id } }), 1);
});
for (const mode of ["paused", "OFF", "COPILOT", "AUTO"] as const) material("real inbound respects automation policy: " + mode, async f => {
  await f.setup(); await f.bootstrap.bootstrap(f.target); const h = await f.handoff();
  await db.conversation.update({ where: { id: h.metaConversationId }, data: mode === "paused" ? { aiPaused: true } : { aiMode: mode } });
  await f.sendInbound(); assert.equal(network.filter(n => n.type === "text").length, mode === "AUTO" ? 1 : 0);
});
material("existing Meta lifecycle is reused and foreign target never sends", async f => {
  const existing = await db.conversation.create({ data: { contactId: f.contact.id, channelId: f.channel.id, channel: "whatsapp:" + f.channel.id, status: "PENDING" } });
  await f.setup(); assert.equal((await f.bootstrap.bootstrap({ ...f.target, companyId: "foreign-company" })).status, "IDENTITY_UNAVAILABLE");
  assert.equal(network.length, 0); assert.equal((await f.bootstrap.bootstrap(f.target)).status, "SENT");
  assert.equal((await f.handoff()).metaConversationId, existing.id);
});
material("configured but disabled stays fail closed; optimistic config revision rejects lost update", async f => {
  await f.config.save(f.session, f.integration.id, { ...f.input, autoStartEnabled: false });
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "CONFIGURATION_MISSING");
  await assert.rejects(f.setup(), { message: "CONFIGURATION_MISSING" }); assert.equal(network.length, 0);
});
material("rate limit blocks without permit or network, permits safe pre-dispatch retry", async f => {
  await f.setup(); const limited = createOpenCreditWhatsappBootstrap({ ...f.deps, limited: async () => true });
  assert.equal((await limited.bootstrap(f.target)).status, "RATE_LIMITED"); assert.equal(network.length, 0);
  const h = await f.handoff(); assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: h.outboundOperationId! } })).status, "PREPARED");
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "SENT"); assert.equal(network.length, 1);
});
material("provider ACK then local history failure retains UNKNOWN/ACK without false sent or resend", async f => {
  await f.setup(); const service = createOpenCreditWhatsappBootstrap({ ...f.deps, sendTemplate: input => f.deps.sendTemplate({ ...input,
    onProviderAccepted: id => { input.onProviderAccepted?.(id); throw Error("SYNTHETIC_HISTORY_FAILURE"); } }) });
  assert.equal((await service.bootstrap(f.target)).status, "UNKNOWN");
  const h = await f.handoff(); assert.ok(h.providerMessageId); assert.equal(h.state, "UNKNOWN");
  assert.equal(await db.message.count({ where: { conversationId: h.metaConversationId } }), 0);
  assert.equal((await f.bootstrap.bootstrap(f.target)).status, "UNKNOWN"); assert.equal(network.length, 1);
});
material("process failure after durable permit but before network blocks replay across restart", async f => {
  await f.setup(); const service = createOpenCreditWhatsappBootstrap({ ...f.deps, sendTemplate: input => f.deps.sendTemplate({ ...input,
    dispatchGuard: async context => { await input.dispatchGuard?.(context); throw Error("SYNTHETIC_PROCESS_INTERRUPTION"); } }) });
  assert.equal((await service.bootstrap(f.target)).status, "UNKNOWN"); assert.equal(network.length, 0);
  assert.equal((await createOpenCreditWhatsappBootstrap({ ...f.deps, db: independent }).bootstrap(f.target)).status, "UNKNOWN"); assert.equal(network.length, 0);
});
material("native human authority prevents bootstrap and original OPEN_CREDIT transport remains blocked", async f => {
  const meta = await db.conversation.create({ data: { contactId: f.contact.id, channelId: f.channel.id, channel: "whatsapp:" + f.channel.id } });
  await createConversationAuthorityService({ db, provider: "postgresql" }).initialize({ companyId: f.company.id, channelId: f.channel.id,
    conversationId: meta.id, actorUserId: f.actor.id, state: "HUMAN", ownerUserId: f.actor.id, logicalKey: randomUUID(), reason: "SYNTHETIC" });
  await f.setup(); assert.equal((await f.bootstrap.bootstrap(f.target)).status, "AUTOMATION_NOT_ALLOWED"); assert.equal(network.length, 0);
  await assert.rejects(templates.sendConversationTemplate({ companyId: f.company.id, conversationId: f.source.id, userId: f.actor.id,
    templateName: f.template.name, language: f.template.language, variables: [] })); assert.equal(network.length, 0);
});
material("provider rejection never logs recipient, body, credential, ACK or free exception", async f => {
  await f.setup(); rejectProvider = true; const logs: unknown[][] = [];
  const info = console.info, warn = console.warn, error = console.error;
  console.info = (...args) => { logs.push(args); }; console.warn = (...args) => { logs.push(args); }; console.error = (...args) => { logs.push(args); };
  try { assert.equal((await f.bootstrap.bootstrap(f.target)).status, "UNKNOWN"); } finally { console.info = info; console.warn = warn; console.error = error; }
  assert.deepEqual(logs, []); assert.equal(network.length, 1);
  const h = await f.handoff(); assert.equal(h.state, "UNKNOWN"); assert.equal(h.providerMessageId, null);
  assert.equal(await db.message.count({ where: { conversationId: h.metaConversationId, status: "sent" } }), 0);
});
test("clean migration and upgrade preserve historical rows and never backfill/enable/send", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qevora-whatsapp-"));
  const name = "qevora_whatsapp_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^qevora_whatsapp_[0-9a-f]{32}$/);
  const url = new URL(process.env.DATABASE_URL!); url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const schema = join(directory, "schema.postgres.prisma"), migration = "20261108210000_opencredit_whatsapp_handoff";
  const deploy = () => {
    const r = spawnSync(process.execPath, [createRequire(import.meta.url).resolve("prisma/build/index.js"), "migrate", "deploy", "--schema", schema],
      { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120000 });
    assert.equal(r.status, 0, "DISPOSABLE_WHATSAPP_MIGRATION_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", schema); mkdirSync(join(directory, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(directory, "migrations/migration_lock.toml"));
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    const copy = (entry: string) => cpSync(join("prisma/migrations", entry), join(directory, "migrations", entry), { recursive: true });
    const previous = names.filter(n => n < migration); assert.equal(previous.length, 33);
    for (const entry of previous) copy(entry); deploy();
    const company = await isolated.company.create({ data: { name: "Synthetic historical" } });
    const integration = await isolated.openCreditIntegration.create({ data: { companyId: company.id, providerScope: "synthetic-history", publicWebhookId: randomUUID(), webhookSecret: "synthetic" } });
    const contact = await isolated.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5511987654321" } });
    const channel = await isolated.channel.create({ data: { companyId: company.id, name: "OpenCredit", provider: "internal", type: "OPEN_CREDIT" } });
    await isolated.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "OPEN_CREDIT" } });
    const snapshot = () => Promise.all([isolated.company.findMany(), isolated.contact.findMany(), isolated.channel.findMany(),
      isolated.conversation.findMany(), isolated.openCreditIntegration.findMany(), isolated.message.count()]);
    const before = await snapshot(), networkBefore = network.length;
    copy(migration); deploy(); assert.deepEqual(await snapshot(), before);
    assert.equal(await isolated.openCreditWhatsappConfig.count(), 0); assert.equal(await isolated.openCreditWhatsappHandoff.count(), 0);
    const user = await isolated.user.create({ data: { companyId: company.id, name: "Synthetic", email: randomUUID() + "@invalid.test", passwordHash: "synthetic" } });
    const config = await isolated.openCreditWhatsappConfig.create({ data: { companyId: company.id, integrationId: integration.id, providerScope: integration.providerScope!, configuredByUserId: user.id } });
    assert.equal(config.autoStartEnabled, false); assert.equal(network.length, networkBefore);
    const applied = await isolated.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    assert.equal(Number(applied[0].count), 34);
  } finally {
    await isolated.$disconnect(); await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    const checked = resolve(directory); assert(checked.startsWith(resolve(tmpdir()) + sep + "qevora-whatsapp-"));
    rmSync(checked, { recursive: true, force: true });
  }
});
