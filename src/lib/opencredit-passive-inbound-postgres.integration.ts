import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import Module, { createRequire } from "node:module";
import { mkdtempSync, readdirSync, copyFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { setImmediate as nextTurn } from "node:timers/promises";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import { prepareOpenCreditWebhookSecret, resolveOpenCreditWebhookSecret } from "./opencredit-secrets";
import { createOpenCreditWebhookHandler } from "./opencredit-webhook-handler";
import { ingestOpenCreditLead } from "./opencredit-lead.service";
assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_PASSIVE_INBOUND_POSTGRES_TEST !== "1") throw Error("PASSIVE_INBOUND_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let handler: typeof import("./opencredit-passive-inbound-handler");
let service: typeof import("./opencredit-passive-inbound.service");
let materializationPayload: typeof import("./opencredit-lead-materialization-payload");
type IngestionEvent = Parameters<NonNullable<Parameters<typeof handler.createPassiveInboundHandler>[0]["logIngestionUnavailable"]>>[0];
const originalFetch = globalThis.fetch, secret = "synthetic-inbound-secret";
const encryption = { activeKeyId: "synthetic", keys: { synthetic: Buffer.alloc(32, 3) } };
function installMaterializationKey() {
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 17).toString("base64");
}
before(async () => {
  globalThis.fetch = async () => { throw Error("EXTERNAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, old = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : old.call(loader, s, ...a);
  const require = createRequire(import.meta.url);
  try {
    handler = require("./opencredit-passive-inbound-handler");
    service = require("./opencredit-passive-inbound.service");
    materializationPayload = require("./opencredit-lead-materialization-payload");
  } finally { loader._load = old; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
async function fixture() {
  const companies = await Promise.all([db.company.create({ data: { name: "Synthetic A" } }), db.company.create({ data: { name: "Synthetic B" } })]);
  const companyIds = companies.map(c => c.id), scope = "synthetic-scope";
  const create = (companyId: string, providerScope: string | null) => db.openCreditIntegration.create({ data: { companyId, providerScope, publicWebhookId: randomUUID().replaceAll("-", "") + "a".repeat(16), webhookSecret: prepareOpenCreditWebhookSecret(secret, encryption), enabled: true, passiveInboundEnabled: true } });
  const a = await create(companies[0].id, scope), b = await create(companies[1].id, scope), other = await create(companies[0].id, "synthetic-other"), same = await create(companies[0].id, scope), legacy = await create(companies[0].id, null);
  const payload = (version: number | undefined = 2) => JSON.stringify({ event: "lead.assigned", eventId: "external-lead:partner", lead: { id: "external-lead" }, ...(version === undefined ? {} : { contractVersion: version }), client: { cpf: "00000000000", phone: "5511999999999", name: "PRIVATE_SENTINEL", email: "private@example.invalid" }, companyId: companies[1].id, providerScope: "attacker" });
  const ingestionEvents: IngestionEvent[] = [];
  const receiver = (storage: Parameters<typeof service.persistPassiveInbound>[0] = db, beforePersist?: () => Promise<void>) => handler.createPassiveInboundHandler({
    lookup: async publicWebhookId => { const row = await db.openCreditIntegration.findUnique({ where: { publicWebhookId } }); return row?.providerScope ? { ...row, providerScope: row.providerScope } : null; },
    secret: e => resolveOpenCreditWebhookSecret(e, encryption), limit: async () => ({ status: "allowed" }),
    logIngestionUnavailable: event => { ingestionEvents.push(event); },
    persist: async (receipt, deadline, onEntry) => { if (beforePersist) await beforePersist(); return service.persistPassiveInbound(storage, receipt, deadline, onEntry); },
  });
  const send = (target = a, h = receiver(), raw = payload()) => h(new Request("https://crm.example.invalid/inbound", { method: "POST", headers: { "content-type": "application/json", "x-creditcore-sig": "sha256=" + createHmac("sha256", secret).update(Buffer.from(raw)).digest("hex") }, body: raw }), { params: Promise.resolve({ publicWebhookId: target.publicWebhookId }) });
  const inbox = () => db.openCreditInboundEvent.findMany({ where: { companyId: { in: companyIds } }, orderBy: { receivedAt: "asc" } });
  const jobs = () => db.openCreditLeadMaterialization.findMany({ where: { companyId: { in: companyIds } } });
  const setOptIn = (target = a, materializationEnabled = true) => db.openCreditIntegration.update({ where: { id: target.id }, data: { materializationEnabled } });
  const effects = async () => ({ contacts: await db.contact.count({ where: { companyId: { in: companyIds } } }), leads: await db.openCreditLead.count({ where: { companyId: { in: companyIds } } }), legacyEvents: await db.openCreditEvent.count({ where: { companyId: { in: companyIds } } }), conversations: await db.conversation.count({ where: { contact: { companyId: { in: companyIds } } } }), operations: await db.openCreditCommercialOperation.count({ where: { companyId: { in: companyIds } } }) });
  return { a, b, other, same, legacy, send, receiver, payload, inbox, jobs, effects, companyIds, setOptIn, ingestionEvents };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => { const f = await fixture(); const previousKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1; delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    try { await run(f); } finally {
    if (previousKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
    else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previousKey;
    await db.openCreditLeadMaterialization.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.openCreditInboundEvent.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.openCreditEvent.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.openCreditLead.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.openCreditIntegration.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.contact.deleteMany({ where: { companyId: { in: f.companyIds } } });
    await db.company.deleteMany({ where: { id: { in: f.companyIds } } });
  } });
}
material("valid event commits only inbox technical metadata before 200", async f => {
  const before = await f.effects(), r = await f.send(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const rows = await f.inbox(); assert.equal(rows.length, 1); const row = rows[0]; assert.equal(row.companyId, f.a.companyId); assert.equal(row.providerScope, f.a.providerScope); assert.equal(row.integrationId, f.a.id); assert.equal(row.provenanceKind, "OPENCREDIT_HMAC_SHA256_VERIFIED"); assert.equal(row.provenanceVersion, 1); assert.equal(row.processingState, "RECEIVED"); assert(row.receivedAt instanceof Date);
  assert.deepEqual(Object.keys(row).sort(), ["id","companyId","providerScope","integrationId","eventId","eventType","externalLeadId","contractVersion","provenanceKind","provenanceVersion","receivedAt","processingState"].sort());
  for (const pii of ["PRIVATE_SENTINEL","00000000000","5511999999999","private@example.invalid",secret]) assert(!JSON.stringify(row).includes(pii));
  assert.deepEqual(await f.effects(), before);
  assert.equal(f.a.materializationEnabled, false);
  assert.deepEqual(await f.jobs(), []);
});
material("duplicate delivery is acknowledged without timestamp or row mutation", async f => { assert.equal((await f.send()).status, 200); const rows = await f.inbox(); assert.equal((await f.send()).status, 200); assert.deepEqual(await f.inbox(), rows); });
material("200 waits for the real PostgreSQL transaction commit", async f => {
  let entered!:()=>void, release!:()=>void, returned=false;
  const started=new Promise<void>(r=>{entered=r;}), gate=new Promise<void>(r=>{release=r;});
  const held={ $transaction:(fn:(tx:unknown)=>unknown,options:never)=>db.$transaction(async tx=>{const value=await fn(tx);entered();await gate;return value;},options) } as unknown as Parameters<typeof service.persistPassiveInbound>[0];
  const pending=f.send(f.a,f.receiver(held)).then(r=>{returned=true;return r;});
  try { await Promise.race([started,pending]); assert.equal(returned,false); assert.equal((await f.inbox()).length,0); }
  finally { release(); }
  assert.equal((await pending).status,200); assert.equal((await f.inbox()).length,1);
});
material("disabling passive ingress rejects duplicate acknowledgement without touching legacy enabled", async f => {
  assert.equal((await f.send()).status,200); const rows=await f.inbox();
  await db.openCreditIntegration.update({where:{id:f.a.id},data:{passiveInboundEnabled:false}});
  assert.equal((await f.send()).status,403); assert.deepEqual(await f.inbox(),rows);
  assert.equal((await db.openCreditIntegration.findUniqueOrThrow({where:{id:f.a.id}})).enabled,true);
});
material("database unique independently rejects a second row with the same company/scope/event", async f => {
  assert.equal((await f.send()).status,200); const { id, ...data } = (await f.inbox())[0]; void id;
  await assert.rejects(() => db.openCreditInboundEvent.create({data}), (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "P2002");
  assert.equal((await f.inbox()).length,1);
});
material("concurrent forced INSERT race -> one material row and two successful deliveries", async f => {
  installMaterializationKey();
  await f.setOptIn();
  let entered = 0, release!: () => void; const gate = new Promise<void>(r => { release = r; });
  const race = { $transaction: (fn: (tx: unknown) => unknown, options: never) => db.$transaction(async tx => fn(new Proxy(tx, { get(target, key) {
    if (key !== "openCreditInboundEvent") return Reflect.get(target, key);
    return new Proxy(tx.openCreditInboundEvent, { get(delegate, method) { if (method !== "create") return Reflect.get(delegate, method); return async (args: Parameters<typeof delegate.create>[0]) => { if (++entered === 2) release(); await gate; return delegate.create(args); }; } });
  } })), options) } as unknown as Parameters<typeof service.persistPassiveInbound>[0];
  const responses = await Promise.all([f.send(f.a, f.receiver(race)), f.send(f.a, f.receiver(race))]); assert.deepEqual(responses.map(r => r.status), [200,200]); assert.equal(entered, 2); assert.equal((await f.inbox()).length, 1); assert.deepEqual(await f.effects(), { contacts:0,leads:0,legacyEvents:0,conversations:0,operations:0 });
  assert.equal((await f.jobs()).length, 1);
});
material("same company/scope/event deduplicates across integrations", async f => { assert.equal((await f.send()).status, 200); assert.equal((await f.send(f.same)).status, 200); const rows = await f.inbox(); assert.equal(rows.length, 1); assert.equal(rows[0].integrationId, f.a.id); });
material("same event in different company or providerScope is isolated", async f => { for (const target of [f.a,f.b,f.other]) assert.equal((await f.send(target)).status, 200); assert.equal((await f.inbox()).length, 3); });
for (const changed of ["providerScope","webhookSecret","passiveInboundEnabled"] as const) material("binding revalidated transactionally: " + changed, async f => {
  const h = f.receiver(db, async () => { await db.openCreditIntegration.update({ where: { id:f.a.id }, data: changed === "passiveInboundEnabled" ? { passiveInboundEnabled:false } : changed === "providerScope" ? { providerScope:"changed-scope" } : { webhookSecret:prepareOpenCreditWebhookSecret("rotated-synthetic",encryption) } }); });
  assert.equal((await f.send(f.a,h)).status, 403); assert.equal((await f.inbox()).length, 0);
});
material("historical integration without explicit scope fails new route, legacy still ingests", async f => {
  assert.equal((await f.send(f.legacy)).status, 403); assert.equal((await f.inbox()).length, 0);
  const old = createOpenCreditWebhookHandler({ resolveIntegration: async () => f.legacy, resolveSecret: s => resolveOpenCreditWebhookSecret(s,encryption), ingest: (b,p,d) => ingestOpenCreditLead(db,b,p,d) });
  const raw=JSON.stringify({ event:"lead.assigned", eventId:"external-lead:partner", lead:{id:"external-lead"}, contractVersion:2, assignedAt:"2026-10-29T12:00:00Z" });
  const r=await old(new Request("https://crm.example.invalid/legacy",{method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":"sha256="+createHmac("sha256",secret).update(raw).digest("hex")},body:raw}),{params:Promise.resolve({publicWebhookId:f.legacy.publicWebhookId})});
  assert.equal(r.status,200); assert.equal((await f.effects()).legacyEvents,1); assert.equal((await f.inbox()).length,0);
});
material("integration without decryptable secret fails closed", async f => { await db.openCreditIntegration.update({ where:{id:f.a.id},data:{webhookSecret:""} }); assert.equal((await f.send()).status,403); assert.equal((await f.inbox()).length,0); });
material("invalid encrypted secret and invalid RAW HMAC never persist", async f => {
  await db.openCreditIntegration.update({ where:{id:f.a.id},data:{webhookSecret:"invalid-envelope"} });
  assert.equal((await f.send()).status,403);
  await db.openCreditIntegration.update({ where:{id:f.a.id},data:{webhookSecret:f.a.webhookSecret} });
  const raw=f.payload(); const r=await f.receiver()(new Request("https://crm.example.invalid/inbound",{method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":"sha256="+"0".repeat(64)},body:raw}),{params:Promise.resolve({publicWebhookId:f.a.publicWebhookId})});
  assert.equal(r.status,403); assert.equal((await f.inbox()).length,0);
});

for (const [label, enabled, passiveInboundEnabled] of [
  ["A",false,false], ["B",false,true], ["C",true,false], ["D",true,true],
] as const) material("independent route flags matrix " + label, async f => {
  await db.openCreditIntegration.update({where:{id:f.a.id},data:{enabled,passiveInboundEnabled}});
  const passive=await f.send(); assert.equal(passive.status,passiveInboundEnabled ? 200 : 403);
  // Even with the complete client payload, passive handling must never ingest a legacy lead/contact/event.
  assert.deepEqual(await f.effects(),{contacts:0,leads:0,legacyEvents:0,conversations:0,operations:0});
  const legacy=createOpenCreditWebhookHandler({
    resolveIntegration: publicWebhookId => db.openCreditIntegration.findUnique({where:{publicWebhookId}}),
    resolveSecret: s=>resolveOpenCreditWebhookSecret(s,encryption),
    ingest:(b,p,d)=>ingestOpenCreditLead(db,b,p,d),
  });
  const raw=JSON.stringify({...JSON.parse(f.payload()),assignedAt:"2026-10-29T12:00:00Z"});
  const response=await legacy(new Request("https://crm.example.invalid/legacy",{method:"POST",headers:{"content-type":"application/json","x-creditcore-sig":"sha256="+createHmac("sha256",secret).update(raw).digest("hex")},body:raw}),{params:Promise.resolve({publicWebhookId:f.a.publicWebhookId})});
  assert.equal(response.status,enabled ? 200 : 403);
  const effects=await f.effects(); assert.equal(effects.contacts,enabled ? 1 : 0); assert.equal(effects.leads,enabled ? 1 : 0); assert.equal(effects.legacyEvents,enabled ? 1 : 0);
  assert.equal((await f.inbox()).length,passiveInboundEnabled ? 1 : 0);
  assert.equal(effects.conversations,0); assert.equal(effects.operations,0);
});

material("legacy disable during passive processing does not revoke passive receipt", async f => {
  const h=f.receiver(db,async()=>{await db.openCreditIntegration.update({where:{id:f.a.id},data:{enabled:false,paused:true}});});
  assert.equal((await f.send(f.a,h)).status,200); assert.equal((await f.inbox()).length,1);
  assert.deepEqual(await f.effects(),{contacts:0,leads:0,legacyEvents:0,conversations:0,operations:0});
});
material("composite FK and provenance CHECK reject forged scope/company and signature", async f => {
  await f.send(); const row=(await f.inbox())[0]; const { id:ignored,...data }=row; void ignored;
  await assert.rejects(() => db.openCreditInboundEvent.create({data:{...data,eventId:"different:partner",companyId:f.b.companyId}}));
  await assert.rejects(() => db.openCreditInboundEvent.create({data:{...data,eventId:"different:partner",providerScope:"synthetic-other"}}));
  await assert.rejects(() => db.openCreditInboundEvent.create({data:{...data,eventId:"different:partner",provenanceKind:"UNVERIFIED"}}));
  await assert.rejects(() => db.openCreditIntegration.update({where:{id:f.a.id},data:{providerScope:"changed-scope"}}));
  assert.equal((await f.inbox()).length,1);
});
material("failed transaction rolls back inbox and returns 503 rather than 2xx", async f => {
  const failing = { $transaction: (fn: (tx: unknown) => unknown, options: never) => db.$transaction(async tx => { await fn(tx); throw Error("SYNTHETIC_ROLLBACK"); },options) } as unknown as Parameters<typeof service.persistPassiveInbound>[0];
  assert.equal((await f.send(f.a,f.receiver(failing))).status,503); assert.equal((await f.inbox()).length,0); assert.equal((await f.send()).status,200);
});
material("same event with inconsistent metadata is conflict, not overwrite", async f => { assert.equal((await f.send()).status,200); const p=JSON.parse(f.payload()); delete p.contractVersion; assert.equal((await f.send(f.a,f.receiver(),JSON.stringify(p))).status,409); assert.equal((await f.inbox())[0].contractVersion,2); });

const privateIdentity = { cpf: "12345678909", phone: "5511987654321", name: "PRIVATE_SENTINEL", email: "private@example.invalid" };
function assertNoPlaintext(...values: unknown[]) {
  const encoded = JSON.stringify(values);
  for (const value of Object.values(privateIdentity)) assert(!encoded.includes(value), "identity escaped ciphertext");
}
function distinctEvent(f: Fixture) {
  return JSON.stringify({ ...JSON.parse(f.payload()), eventId: "external-lead:another-partner", client: { ...privateIdentity, name: "Another Person" } });
}
material("opt-in commits event and bound ciphertext together before 200", async f => {
  installMaterializationKey();
  await f.setOptIn();
  let enter!: () => void, release!: () => void;
  const started = new Promise<void>(r => { enter = r; });
  const gate = new Promise<void>(r => { release = r; });
  const held = { $transaction: (run: (tx: unknown) => Promise<unknown>, options: never) => db.$transaction(async tx => {
    const result = await run(tx);
    enter();
    await gate;
    return result;
  }, options) } as Parameters<typeof service.persistPassiveInbound>[0];
  const raw = JSON.stringify({ ...JSON.parse(f.payload()), client: { ...privateIdentity, financial: "DISCARD_ME" } });
  const pending = f.send(f.a, f.receiver(held), raw);
  try {
    await Promise.race([started, pending]);
    assert.equal((await f.inbox()).length, 0);
    assert.equal((await f.jobs()).length, 0);
  } finally { release(); }
  const response = await pending;
  assert.equal(response.status, 200);
  const responseBody = await response.text();
  const [event] = await f.inbox();
  const [job] = await f.jobs();
  assert.equal(job.state, "PENDING");
  assert.equal(job.reviewCode, null);
  assert.equal(job.inboundEventId, event.id);
  assert.equal(job.expiresAt.getTime() - event.receivedAt.getTime(), 7 * 86400000);
  assert(job.protectedEnvelope);
  assert.deepEqual(materializationPayload.openMaterializationIdentity(job.protectedEnvelope, event), privateIdentity);
  assert.throws(() => materializationPayload.openMaterializationIdentity(job.protectedEnvelope!, { ...event, eventId: "external-lead:other" }), /ENVELOPE_INVALID/);
  assertNoPlaintext(event, job, responseBody, f.ingestionEvents);
  assert.equal(responseBody, '{"ok":true}');
  assert.deepEqual(await f.effects(), { contacts: 0, leads: 0, legacyEvents: 0, conversations: 0, operations: 0 });
});

material("insufficient identity goes to NEEDS_REVIEW with only validated attributes protected", async f => {
  installMaterializationKey();
  await f.setOptIn();
  const raw = JSON.stringify({ ...JSON.parse(f.payload()), client: { ...privateIdentity, cpf: "not-a-cpf", phone: "+12125550199" } });
  assert.equal((await f.send(f.a, f.receiver(), raw)).status, 200);
  const [event] = await f.inbox();
  const [job] = await f.jobs();
  assert.equal(job.state, "NEEDS_REVIEW");
  assert.equal(job.reviewCode, "IDENTITY_INSUFFICIENT");
  assert(job.protectedEnvelope);
  assert.deepEqual(materializationPayload.openMaterializationIdentity(job.protectedEnvelope, event), { ...privateIdentity, cpf: null, phone: null });
  assertNoPlaintext(event, job);
});

material("review with no usable attributes stores no envelope and requires no key", async f => {
  await f.setOptIn();
  const raw = JSON.stringify({ ...JSON.parse(f.payload()), client: { cpf: "invalid", phone: "invalid", email: "invalid" } });
  assert.equal((await f.send(f.a, f.receiver(), raw)).status, 200);
  const [job] = await f.jobs();
  assert.equal(job.state, "NEEDS_REVIEW");
  assert.equal(job.reviewCode, "IDENTITY_INSUFFICIENT");
  assert.equal(job.protectedEnvelope, null);
});

for (const enabled of [false, true]) material("materialization uses the opt-in revalidated during persistence: " + enabled, async f => {
  if (enabled) installMaterializationKey();
  await f.setOptIn(f.a, !enabled);
  const receiver = f.receiver(db, async () => { await f.setOptIn(f.a, enabled); });
  assert.equal((await f.send(f.a, receiver)).status, 200);
  assert.equal((await f.inbox()).length, 1);
  assert.equal((await f.jobs()).length, enabled ? 1 : 0);
});

for (const invalidKey of [undefined, "invalid-key"]) material("required envelope failure rolls back both records: " + (invalidKey ? "invalid key" : "no key"), async f => {
  if (invalidKey) process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = invalidKey;
  await f.setOptIn();
  const raw = JSON.stringify({ ...JSON.parse(f.payload()), client: privateIdentity });
  const response = await f.send(f.a, f.receiver(), raw);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body, '{"code":"INGESTION_UNAVAILABLE"}');
  assert.equal((await f.inbox()).length, 0);
  assert.equal((await f.jobs()).length, 0);
  await nextTurn();
  assert.equal(f.ingestionEvents.length, 1);
  assert.equal(f.ingestionEvents[0].stage, "persistence");
  assertNoPlaintext(body, f.ingestionEvents);
});

material("a replay never backfills an event accepted before opt-in", async f => {
  assert.equal((await f.send()).status, 200);
  await f.setOptIn();
  const before = await f.inbox();
  assert.equal((await f.send()).status, 200);
  assert.deepEqual(await f.inbox(), before);
  assert.deepEqual(await f.jobs(), []);
});

material("new events of the same lead do not mutate the original job or its retention", async f => {
  installMaterializationKey();
  await f.setOptIn();
  await f.setOptIn(f.same);
  assert.equal((await f.send()).status, 200);
  const original = await f.jobs();
  assert.equal(original.length, 1);
  delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  assert.equal((await f.send()).status, 200);
  assert.equal((await f.send(f.same, f.receiver(), distinctEvent(f))).status, 200);
  assert.equal((await f.inbox()).length, 2);
  assert.deepEqual(await f.jobs(), original);
});

material("two concurrent event IDs for one lead commit two inbox rows and one immutable job", async f => {
  installMaterializationKey();
  await f.setOptIn();
  await f.setOptIn(f.same);
  let entered = 0, release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const storage = { $transaction: (run: (tx: unknown) => Promise<unknown>, options: never) => db.$transaction(tx => run(new Proxy(tx, {
    get(target, key) {
      if (key !== "openCreditLeadMaterialization") return Reflect.get(target, key);
      return new Proxy(tx.openCreditLeadMaterialization, {
        get(delegate, method) {
          if (method !== "create") return Reflect.get(delegate, method);
          return async (args: Parameters<typeof delegate.create>[0]) => {
            if (++entered === 2) release();
            await gate;
            return delegate.create(args);
          };
        },
      });
    },
  })), options) } as Parameters<typeof service.persistPassiveInbound>[0];
  const receiver = f.receiver(storage);
  const responses = await Promise.all([f.send(f.a, receiver), f.send(f.same, receiver, distinctEvent(f))]);
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(entered, 2);
  const events = await f.inbox();
  assert.equal(events.length, 2);
  const jobs = await f.jobs();
  assert.equal(jobs.length, 1);
  const origin = events.find(event => event.id === jobs[0].inboundEventId);
  assert(origin && jobs[0].protectedEnvelope);
  assert.equal(jobs[0].integrationId, origin.integrationId);
  assert.equal(jobs[0].expiresAt.getTime() - origin.receivedAt.getTime(), 7 * 86400000);
  const identity = materializationPayload.openMaterializationIdentity(jobs[0].protectedEnvelope, origin);
  assert.equal(identity.name, origin.eventId.endsWith(":partner") ? "PRIVATE_SENTINEL" : "Another Person");
});

material("one lead materializes independently across companies and scopes", async f => {
  installMaterializationKey();
  for (const target of [f.a, f.b, f.other]) {
    await f.setOptIn(target);
    assert.equal((await f.send(target)).status, 200);
  }
  const jobs = await f.jobs();
  assert.equal(jobs.length, 3);
  assert.equal(new Set(jobs.map(job => [job.companyId, job.providerScope].join(":"))).size, 3);
});

material("materialization FK rejects every mismatched origin component and accepts the exact binding", async f => {
  assert.equal((await f.send()).status, 200);
  assert.equal((await f.send(f.b)).status, 200);
  const rows = await f.inbox();
  const event = rows.find(row => row.integrationId === f.a.id)!;
  const otherTenant = rows.find(row => row.integrationId === f.b.id)!;
  const { companyId, providerScope, integrationId, externalLeadId } = event;
  const data = { inboundEventId: event.id, companyId, providerScope, integrationId, externalLeadId, state: "NEEDS_REVIEW", reviewCode: "IDENTITY_INSUFFICIENT", expiresAt: event.receivedAt };
  for (const mismatch of [
    { companyId: f.b.companyId }, { providerScope: f.other.providerScope! }, { integrationId: f.same.id },
    { externalLeadId: "wrong-lead" }, { inboundEventId: otherTenant.id },
  ]) {
    await assert.rejects(() => db.openCreditLeadMaterialization.create({ data: { ...data, ...mismatch } }), (error: unknown) => {
      assertNoPlaintext(String(error), error);
      return !!error && typeof error === "object" && "code" in error && error.code === "P2003";
    });
  }
  assert.deepEqual(await f.jobs(), []);
  const exact = await db.openCreditLeadMaterialization.create({ data });
  assert.equal(exact.inboundEventId, event.id);
});

const foundationMigration = "20261105190000_opencredit_lead_materialization_foundation";
for (const cutoff of ["20261029190000_add_opencredit_passive_inbound", "20261030150000_separate_opencredit_passive_inbound_enable", foundationMigration]) test("historical upgrade preserves rows and defaults new flags false: " + cutoff, async () => {
  const name="qevora_inbound_upgrade_"+randomUUID().replaceAll("-",""); assert.match(name,/^qevora_inbound_upgrade_[a-f0-9]{32}$/);
  const temp=mkdtempSync(join(tmpdir(),"qevora-passive-upgrade-")); const absolute=resolve(temp),parent=resolve(tmpdir())+sep;
  assert(absolute.startsWith(parent) && absolute.slice(parent.length).startsWith("qevora-passive-upgrade-"));
  await db.$executeRawUnsafe('CREATE DATABASE "'+name+'"');
  const url=new URL(process.env.DATABASE_URL!); url.pathname="/"+name;
  const isolated=new PrismaClient({datasources:{db:{url:url.toString()}},log:[]});
  const cli=createRequire(import.meta.url).resolve("prisma/build/index.js");
  const deploy=() => { const r=spawnSync(process.execPath,[cli,"migrate","deploy","--schema",join(temp,"schema.postgres.prisma")],{env:{...process.env,DATABASE_URL:url.toString()},encoding:"utf8",timeout:120000}); assert.equal(r.status,0,"DISPOSABLE_UPGRADE_DEPLOY_FAILED"); };
  try {
    copyFileSync("prisma/schema.postgres.prisma",join(temp,"schema.postgres.prisma")); mkdirSync(join(temp,"migrations")); copyFileSync("prisma/migrations/migration_lock.toml",join(temp,"migrations/migration_lock.toml"));
    const names=readdirSync("prisma/migrations",{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort(); assert(names.includes(cutoff));
    for(const m of names.filter(n=>n<cutoff)) cpSync(join("prisma/migrations",m),join(temp,"migrations",m),{recursive:true}); deploy();
    const c=await isolated.company.create({data:{name:"Synthetic historical"}});
    for (const enabled of [false,true]) {
      await isolated.$executeRaw`INSERT INTO "OpenCreditIntegration" ("id","companyId","publicWebhookId","webhookSecret","enabled","paused","createdAt","updatedAt") VALUES (${enabled ? "historical-on" : "historical-off"},${c.id},${(enabled ? "b" : "c").repeat(48)},'synthetic-existing-cipher',${enabled},${!enabled},NOW(),NOW())`;
    }
    if (cutoff.includes("separate")) await isolated.$executeRaw`UPDATE "OpenCreditIntegration" SET "providerScope"='synthetic-existing-scope'`;
    const existingInbox = cutoff === foundationMigration;
    if (existingInbox) {
      await isolated.$executeRaw`UPDATE "OpenCreditIntegration" SET "providerScope"='synthetic-existing-scope', "passiveInboundEnabled"=true WHERE "id"='historical-on'`;
      await isolated.openCreditInboundEvent.create({ data: {
        companyId: c.id, integrationId: "historical-on", providerScope: "synthetic-existing-scope",
        eventId: "historical-lead:partner", externalLeadId: "historical-lead", eventType: "lead.assigned",
        provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
      } });
    }
    const beforeInbox = existingInbox ? await isolated.openCreditInboundEvent.findMany() : [];
    const before=await isolated.$queryRaw<Array<Record<string,unknown>>>`SELECT * FROM "OpenCreditIntegration" ORDER BY "id"`;
    for(const m of names.filter(n=>n>=cutoff)) cpSync(join("prisma/migrations",m),join(temp,"migrations",m),{recursive:true}); deploy();
    // Reconnect across DDL: a cached SELECT * plan has the historical row type.
    await isolated.$disconnect();
    const after=await isolated.$queryRaw<Array<Record<string,unknown>>>`SELECT * FROM "OpenCreditIntegration" ORDER BY "id"`;
    for (let i=0;i<before.length;i++) {
      for (const key of Object.keys(before[i])) assert.deepEqual(after[i][key],before[i][key],key+" must be preserved");
      assert.equal(after[i].passiveInboundEnabled, existingInbox && after[i].id === "historical-on");
      assert.equal(after[i].providerScope, cutoff.includes("separate") || existingInbox && after[i].id === "historical-on" ? "synthetic-existing-scope" : null);
      assert.equal(after[i].materializationEnabled, false);
    }
    assert.deepEqual(await isolated.openCreditInboundEvent.findMany(), beforeInbox);
    assert.equal(await isolated.openCreditLeadMaterialization.count(), 0);
    const history=await isolated.$queryRaw<Array<{count:number}>>`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`; assert.equal(history[0].count,names.length);
  } finally { await isolated.$disconnect(); await db.$executeRawUnsafe('DROP DATABASE "'+name+'"'); rmSync(absolute,{recursive:true,force:true}); }
});
