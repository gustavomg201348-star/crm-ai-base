import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID, createHmac } from "node:crypto";
import Module, { createRequire } from "node:module";
import { PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import type { SessionUser } from "./auth";
import { createOpenCreditIntegrationService } from "./opencredit-integration.service";
import { resolveOpenCreditWebhookSecret, prepareOpenCreditWebhookSecret } from "./opencredit-secrets";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_MATERIALIZATION_CONFIGURATION_POSTGRES_TEST !== "1") throw Error("DISPOSABLE_CONFIG_OPT_IN_REQUIRED");
const db = new PrismaClient({ log: [] }), other = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-materialization-configuration.service");
let inbound: typeof import("./opencredit-passive-inbound-handler");
let persistence: typeof import("./opencredit-passive-inbound.service");
let pilot: typeof import("./opencredit-materialization-single-admission.service");
let protectIdentity: typeof import("./opencredit-lead-materialization-payload").protectMaterializationIdentity;
const oldPlatform = process.env.PLATFORM_COMPANY_ID, oldKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1, oldFetch = globalThis.fetch;
const encryption = { activeKeyId: "v1", keys: { v1: Buffer.alloc(32, 7) } }, secret = "PRIVATE_SYNTHETIC_WEBHOOK_SECRET";
before(() => {
  globalThis.fetch = async () => { throw Error("PROVIDER_FORBIDDEN"); };
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 19).toString("base64");
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try {
    const require = createRequire(import.meta.url);
    service = require("./opencredit-materialization-configuration.service");
    inbound = require("./opencredit-passive-inbound-handler");
    persistence = require("./opencredit-passive-inbound.service");
    pilot = require("./opencredit-materialization-single-admission.service");
    protectIdentity = require("./opencredit-lead-materialization-payload").protectMaterializationIdentity;
  }
  finally { loader._load = original; }
});
after(async () => {
  globalThis.fetch = oldFetch;
  if (oldPlatform === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = oldPlatform;
  if (oldKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1; else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = oldKey;
  await other.$disconnect(); await db.$disconnect();
});
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic config" } });
  const user = await db.user.create({ data: { companyId: company.id, role: "ADMIN", name: "PRIVATE_NAME", email: randomUUID() + "@invalid.test", passwordHash: "private" } });
  process.env.PLATFORM_COMPANY_ID = company.id;
  const actor: SessionUser = { ...user, role: "ADMIN" };
  const scope = "synthetic-scope" as Parameters<typeof service.setMaterializationConfiguration>[1]["providerScope"];
  const integration = await db.openCreditIntegration.create({ data: { companyId: company.id, providerScope: scope,
    passiveInboundEnabled: true, publicWebhookId: randomUUID().replaceAll("-", "") + "a".repeat(16), webhookSecret: prepareOpenCreditWebhookSecret(secret, encryption) } });
  const channel = await db.channel.create({ data: {
    companyId: company.id, name: "Config AutoStart channel", type: "whatsapp", provider: "meta", status: "ACTIVE",
  } });
  await db.openCreditWhatsappConfig.create({ data: { integrationId: integration.id, companyId: company.id, providerScope: scope,
    configuredByUserId: user.id, autoStartEnabled: true, defaultWhatsappChannelId: channel.id,
    initialTemplateName: "synthetic_template", initialTemplateLanguage: "pt_BR" } });
  const binding = { companyId: company.id, integrationId: integration.id, providerScope: scope };
  const get = () => db.openCreditIntegration.findUniqueOrThrow({ where: { id: integration.id } });
  const input = async (enabled: boolean) => ({ actor, providerScope: scope, command: { action: "SET" as const, companyId: company.id,
    integrationId: integration.id, materializationEnabled: enabled, expectedUpdatedAt: (await get()).updatedAt.toISOString() } });
  const set = async (enabled: boolean) => service.setMaterializationConfiguration(db, await input(enabled));
  const handler = inbound.createPassiveInboundHandler({
    lookup: async publicWebhookId => { const row = await db.openCreditIntegration.findUnique({ where: { publicWebhookId } }); return row?.providerScope ? { ...row, providerScope: row.providerScope } : null; },
    secret: value => resolveOpenCreditWebhookSecret(value, encryption), limit: async () => ({ status: "allowed" }),
    persist: (receipt, deadline, onEntry) => persistence.persistPassiveInbound(db, receipt, deadline, onEntry),
  });
  const send = async (eventId: string) => {
    const raw = JSON.stringify({ event: "lead.assigned", eventId: `${eventId}:synthetic-partner`, lead: { id: eventId }, contractVersion: 2, client: { cpf: "52998224725" } });
    return handler(new Request("https://synthetic.invalid/inbound", { method: "POST", body: raw, headers: { "content-type": "application/json", "x-creditcore-sig": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") } }), { params: Promise.resolve({ publicWebhookId: integration.publicWebhookId }) });
  };
  return { company, user, actor, scope, integration, binding, get, set, input, send,
    async cleanup() {
      const where = { companyId: company.id };
      await db.openCreditMaterializationRolloutAdmission.deleteMany({ where });
      await db.openCreditLeadMaterialization.deleteMany({ where }); await db.openCreditInboundEvent.deleteMany({ where });
      await db.openCreditMaterializationRolloutBudget.deleteMany({ where }); await db.openCreditWhatsappConfig.deleteMany({ where });
      await db.openCreditIntegration.deleteMany({ where });
      await db.conversation.deleteMany({ where: { contact: where } });
      await db.contact.deleteMany({ where });
      await db.channel.deleteMany({ where }); await db.user.deleteMany({ where }); await db.company.delete({ where: { id: company.id } });
    } };
}
type F = Awaited<ReturnType<typeof fixture>>;
const pg = (name: string, run: (f: F) => Promise<void>) => test(name, async () => { const f = await fixture(); try { await run(f); } finally { await f.cleanup(); } });
const code = (value: unknown) => (value as { code?: string }).code;

const quietPilot = { env: {}, bootstrap: async () => { throw Error("UNEXPECTED_BOOTSTRAP"); } };
const target = (f: F) => ({ ...f.binding, actor: f.actor });
const startBudget = (f: F, maxAdmitted = 1, data = {}) => db.openCreditMaterializationRolloutBudget.create({
  data: { ...f.binding, maxAdmitted, expiresAt: new Date(Date.now() + 60000), ...data },
});
async function enablePilot(f: F) {
  await f.set(true);
  await db.company.update({ where: { id: f.company.id }, data: { aiMode: "OFF" } });
}
pg("single admission fails closed on missing, closed, or expired reservation", async f => {
  await enablePilot(f);
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), quietPilot), e => code(e) === "CONFLICT");
  const budget = await startBudget(f, 1, { state: "CLOSED", closedAt: new Date() });
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), quietPilot), e => code(e) === "CONFLICT");
  await db.openCreditMaterializationRolloutBudget.update({ where: { id: budget.id },
    data: { state: "ACTIVE", closedAt: null, createdAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 60000) } });
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), quietPilot), e => code(e) === "CONFLICT");
  assert.equal(await db.openCreditMaterializationRolloutAdmission.count({ where: f.binding }), 0);
});
pg("single admission checks persisted Platform Admin, AutoStart, AI OFF and worker mode", async f => {
  await enablePilot(f);
  const budget = await startBudget(f);
  const run = () => pilot.runOpenCreditSingleAdmission(db, target(f), quietPilot);
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), { ...quietPilot, env: {
    OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true", OPENCREDIT_MATERIALIZATION_WORKER_MODE: "NORMAL",
  } }), e => code(e) === "GATES_INVALID");
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), { ...quietPilot, env: {
    OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "true", OPENCREDIT_MATERIALIZATION_WORKER_MODE: "ROLLOUT",
    OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID: budget.id,
  } }), e => code(e) === "GATES_INVALID");
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, { ...target(f), providerScope: "wrong-scope" }, quietPilot),
    e => code(e) === "GATES_INVALID");
  await db.company.update({ where: { id: f.company.id }, data: { aiMode: "AUTO" } });
  await assert.rejects(run(), e => code(e) === "GATES_INVALID");
  await db.company.update({ where: { id: f.company.id }, data: { aiMode: "OFF" } });
  await db.openCreditWhatsappConfig.update({ where: { integrationId: f.integration.id }, data: { autoStartEnabled: false } });
  await assert.rejects(run(), e => code(e) === "GATES_INVALID");
  await db.user.update({ where: { id: f.actor.id }, data: { role: "AGENT" } });
  await assert.rejects(run(), e => code(e) === "NOT_AUTHORIZED");
});
pg("single admission excludes old jobs and preserves a closed reservation after real completion", async f => {
  await enablePilot(f);
  const window = await db.openCreditWhatsappConfig.findUniqueOrThrow({ where: { integrationId: f.integration.id }, select: { updatedAt: true } });
  async function createJob(externalLeadId: string, createdAt: Date) {
    const binding = { ...f.binding, externalLeadId };
    const eventId = externalLeadId + ":synthetic-partner";
    const event = await db.openCreditInboundEvent.create({ data: { ...binding, eventId, eventType: "lead.assigned",
      provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1 } });
    await db.openCreditLeadMaterialization.create({ data: { ...binding, inboundEventId: event.id, state: "PENDING",
      createdAt, expiresAt: new Date(Date.now() + 60000),
      protectedEnvelope: protectIdentity({ ...binding, eventId }, { cpf: null, phone: "5511987654321", name: null, email: null }) } });
  }
  await createJob("old-pilot", new Date(window.updatedAt.getTime() - 60000));
  const budget = await startBudget(f);
  let bootstraps = 0;
  const deps = { ...quietPilot, bootstrap: async (jobId: string) => {
    bootstraps++;
    assert.equal((await db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id: jobId } })).state, "COMPLETED");
    return { status: "SENT" };
  } };
  assert.equal((await pilot.runOpenCreditSingleAdmission(db, target(f), deps)).status, "NO_ELIGIBLE_JOB");
  await createJob("new-pilot", window.updatedAt);
  await createJob("neighbor-pilot", window.updatedAt);
  const results = await Promise.allSettled([pilot.runOpenCreditSingleAdmission(db, target(f), deps),
    pilot.runOpenCreditSingleAdmission(other, target(f), deps)]);
  const completed = results.filter(r => r.status === "fulfilled" && r.value.outcome === "COMPLETED");
  assert.equal(completed.length, 1, JSON.stringify(results));
  assert.deepEqual(completed[0], { status: "fulfilled", value: { status: "PROCESSED", outcome: "COMPLETED", bootstrapAttempted: true, bootstrapResult: "SENT" } });
  assert.equal(bootstraps, 1);
  const final = await db.openCreditMaterializationRolloutBudget.findUniqueOrThrow({ where: { id: budget.id }, include: { admissions: true } });
  assert.equal(final.state, "CLOSED"); assert.equal(final.releasedAt, null);
  assert.equal(final.admittedCount, 1); assert.equal(final.admissions.length, 1); assert.equal(final.admissions[0].reconciledAt, null);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: { ...f.binding, state: "PENDING", attempts: 0 } }), 2);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: { ...f.binding, externalLeadId: "old-pilot", state: "PENDING", attempts: 0 } }), 1);
  assert.equal(await db.message.count({ where: { conversation: { contact: { companyId: f.company.id } } } }), 0);
  assert.equal((await db.company.findUniqueOrThrow({ where: { id: f.company.id } })).aiMode, "OFF");
  await assert.rejects(pilot.runOpenCreditSingleAdmission(db, target(f), deps), e => code(e) === "CONFLICT");
});

pg("enable/disable is one-column, idempotent, auditable and never creates domain data", async f => {
  const before = await f.get(), logs: unknown[][] = [], original = console.info;
  console.info = (...args) => { logs.push(args); };
  try {
    const result = await f.set(true); assert.equal(result.changed, true); assert.equal(result.interlockReady, true);
    const enabled = await f.get(); const changed = Object.keys(before).filter(k => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(enabled[k as keyof typeof enabled]));
    assert.deepEqual(changed.sort(), ["materializationEnabled", "updatedAt"].sort());
    const same = await f.set(true); assert.equal(same.changed, false); assert.equal((await f.get()).updatedAt.getTime(), enabled.updatedAt.getTime());
    assert.equal((await f.set(false)).materializationEnabled, false); assert.equal(logs.length, 2);
    const text = JSON.stringify(logs); for (const privateValue of [secret, enabled.webhookSecret, f.user.email, f.user.name, f.scope]) assert(!text.includes(privateValue));
    assert(text.includes("opencredit_materialization_configuration_changed")); assert(text.includes(f.actor.id));
    assert.equal(await db.contact.count({ where: { companyId: f.company.id } }), 0);
    assert.equal(await db.openCreditLeadMaterialization.count({ where: f.binding }), 0);
  } finally { console.info = original; }
});
for (const data of [{ enabled: true }, { paused: true }, { passiveInboundEnabled: false }]) pg("activation requires all gates: " + Object.keys(data)[0], async f => {
  await db.openCreditIntegration.update({ where: { id: f.integration.id }, data });
  await assert.rejects(f.set(true), e => code(e) === "GATES_INVALID"); assert.equal((await f.get()).materializationEnabled, false);
});
pg("any unreleased rollout, including CLOSED/expired, blocks activation; released history is allowed", async f => {
  const budget = await db.openCreditMaterializationRolloutBudget.create({ data: { ...f.binding, maxAdmitted: 3,
    state: "CLOSED", createdAt: new Date(Date.now() - 2000), closedAt: new Date(), expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(f.set(true), e => code(e) === "ROLLOUT_RESERVED");
  await db.openCreditMaterializationRolloutBudget.update({ where: { id: budget.id }, data: { releasedAt: new Date() } });
  assert.equal((await f.set(true)).materializationEnabled, true);
});
pg("disable remains available with a reservation and never releases it", async f => {
  await f.set(true);
  const b = await db.openCreditMaterializationRolloutBudget.create({ data: { ...f.binding, maxAdmitted: 1, expiresAt: new Date(Date.now() + 60000) } });
  await f.set(false); assert.equal((await db.openCreditMaterializationRolloutBudget.findUniqueOrThrow({ where: { id: b.id } })).releasedAt, null);
});
pg("two concurrent ENABLE attempts serialize; no duplicated audit or effects", async f => {
  const target = await f.input(true);
  const logs: unknown[][] = [], original = console.info; console.info = (...args) => { logs.push(args); };
  try {
    const results = await Promise.allSettled([service.setMaterializationConfiguration(db, target), service.setMaterializationConfiguration(other, target)]);
    assert(results.some(r => r.status === "fulfilled")); assert.equal((await f.get()).materializationEnabled, true);
    for (const r of results) if (r.status === "rejected") assert.equal(code(r.reason), "CONFLICT");
    assert.equal(logs.length, 1);
  } finally { console.info = original; }
});
pg("configuration can be enabled while the global worker flag is ON without starting a worker here", async f => {
  const prior = process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED;
  process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED = "true";
  try { assert.equal((await f.set(true)).materializationEnabled, true); }
  finally { if (prior === undefined) delete process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED; else process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED = prior; }
});
pg("racing legacy enable and materialization enable never commits both flags", async f => {
  const target = await f.input(true), legacy = createOpenCreditIntegrationService(other, encryption);
  await Promise.allSettled([service.setMaterializationConfiguration(db, target), legacy.setEnabled(f.company.id, f.integration.id, true)]);
  const row = await f.get(); assert(!(row.enabled && row.materializationEnabled));
});
pg("racing pause cannot commit enabled materialization with legacy/paused gates", async f => {
  const target = await f.input(true), legacy = createOpenCreditIntegrationService(other, encryption);
  await Promise.allSettled([service.setMaterializationConfiguration(db, target), legacy.setStatus(f.company.id, f.integration.id, "PAUSED")]);
  const row = await f.get(); assert(!row.materializationEnabled || !row.enabled && !row.paused && row.passiveInboundEnabled);
});
pg("rotation while materialization is active is explicitly rejected without changing secret or flags", async f => {
  await f.set(true); const before = await f.get();
  await assert.rejects(createOpenCreditIntegrationService(db, encryption).rotate(f.company.id, f.integration.id), e => code(e) === "CONFLICT");
  assert.deepEqual(await f.get(), before);
});
pg("rotation and enable serialize safely; active materialization blocks rotation", async f => {
  const target = await f.input(true), legacy = createOpenCreditIntegrationService(other, encryption);
  await Promise.allSettled([service.setMaterializationConfiguration(db, target), legacy.rotate(f.company.id, f.integration.id)]);
  const row = await f.get(); assert(!row.materializationEnabled || !row.enabled && !row.paused && row.passiveInboundEnabled);
  if (row.materializationEnabled) await assert.rejects(legacy.rotate(f.company.id, f.integration.id), e => code(e) === "CONFLICT");
});
pg("company/provider scope and revoked actor identity are revalidated inside the transaction", async f => {
  const target = await f.input(true);
  await assert.rejects(service.setMaterializationConfiguration(db, { ...target, command: { ...target.command, companyId: "foreign" } }), e => code(e) === "NOT_FOUND");
  await assert.rejects(service.setMaterializationConfiguration(db, { ...target, providerScope: "foreign-scope" as typeof f.scope }), e => code(e) === "NOT_FOUND");
  await db.user.update({ where: { id: f.user.id }, data: { role: "AGENT" } });
  await assert.rejects(service.setMaterializationConfiguration(db, target), e => code(e) === "NOT_AUTHORIZED");
  assert.equal((await f.get()).materializationEnabled, false);
});
pg("stale optimistic version conflicts without toggling or logging a change", async f => {
  const target = await f.input(true);
  await db.openCreditIntegration.update({ where: { id: f.integration.id }, data: { updatedAt: new Date(Date.now() + 1000) } });
  await assert.rejects(service.setMaterializationConfiguration(db, target), e => code(e) === "CONFLICT");
  assert.equal((await f.get()).materializationEnabled, false);
});
pg("preflight projection is authoritative and excludes candidates, secrets, envelopes and rollout IDs", async f => {
  const read = () => service.readMaterializationConfiguration(db, { actor: f.actor, providerScope: f.scope, command: { action: "READ", companyId: f.company.id, integrationId: f.integration.id } });
  assert.equal((await read()).materializationEnabled, false); await f.set(true);
  const result = await read(); assert.equal(result.materializationEnabled, true); assert.equal(result.interlockReady, true); assert.equal(result.queue.counts.PENDING, 0);
  const text = JSON.stringify(result); for (const value of [secret, "webhookSecret", "protectedEnvelope", "candidates", "rolloutId"]) assert(!text.includes(value));
});
pg("OFF -> inbox 200/no job; ON -> one new PENDING; old event replay never backfills", async f => {
  assert.equal((await f.send("synthetic-old")).status, 200);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: f.binding }), 0);
  await f.set(true);
  assert.equal((await f.send("synthetic-old")).status, 200);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: f.binding }), 0);
  assert.equal((await f.send("synthetic-new")).status, 200); assert.equal((await f.send("synthetic-new")).status, 200);
  const jobs = await db.openCreditLeadMaterialization.findMany({ where: f.binding, select: { state: true, attempts: true } });
  assert.deepEqual(jobs, [{ state: "PENDING", attempts: 0 }]);
  assert.equal(await db.contact.count({ where: { companyId: f.company.id } }), 0);
});
