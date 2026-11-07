import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { isOpenCreditConversation } from "./conversation-channel.service";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import { ingestOpenCreditLead } from "./opencredit-lead.service";
import type { MaterializationLease } from "./opencredit-materialization-queue.service";
import { parseOpenCreditAssignedLead } from "./opencredit-webhook-contract";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_DOMAIN_MATERIALIZER_POSTGRES_TEST !== "1") throw new Error("DOMAIN_MATERIALIZER_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let queue: ReturnType<typeof import("./opencredit-materialization-queue.service")["createOpenCreditMaterializationQueue"]>;
const key = Buffer.alloc(32, 21).toString("base64");
const keyVariable = "QEVORA_DATA_ENCRYPTION_KEY_V1";
const previousKey = process.env[keyVariable];
const originalFetch = globalThis.fetch;
let fetches = 0;
let core: typeof import("./opencredit-domain-materializer");
let crypto: typeof import("./opencredit-lead-materialization-payload");
let outbound: typeof import("./conversation-message.service");
const identity = { cpf: "12345678909", phone: "5511987654321", name: "Synthetic Lead", email: "synthetic@example.invalid" };
const otherIdentity = { ...identity, cpf: null, phone: "5511976543210" };
const migration = "20261106150000_opencredit_materialization_domain_outcome";

before(() => {
  process.env[keyVariable] = key;
  globalThis.fetch = async () => { fetches++; throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
  const original = loader._load;
  const require = createRequire(import.meta.url);
  loader._load = (name, ...args) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db") return { prisma: db };
    return original.call(loader, name, ...args);
  };
  try {
    core = require("./opencredit-domain-materializer");
    queue = require("./opencredit-materialization-queue.service").createOpenCreditMaterializationQueue(db);
    crypto = require("./opencredit-lead-materialization-payload");
    outbound = require("./conversation-message.service");
  } finally { loader._load = original; }
});
after(async () => {
  if (previousKey === undefined) delete process.env[keyVariable];
  else process.env[keyVariable] = previousKey;
  globalThis.fetch = originalFetch;
  await db.$disconnect();
  assert.equal(fetches, 0);
});

async function fixture() {
  const { id: companyId } = await db.company.create({ data: { name: "Synthetic materializer" } });
  const makeIntegration = () => db.openCreditIntegration.create({ data: {
    companyId, providerScope: "synthetic-scope", publicWebhookId: randomUUID(),
    webhookSecret: "synthetic", passiveInboundEnabled: true, materializationEnabled: true
  } });
  const integration = await makeIntegration();
  const where = { companyId };
  const conversationWhere = { contact: where };
  const process = (lease: MaterializationLease) => core.createOpenCreditDomainMaterializer(db).process(lease);
  return {
    companyId, integration, makeIntegration, process,
    contact: (data: Partial<Prisma.ContactUncheckedCreateInput> = {}) => db.contact.create({
      data: { companyId, name: "Existing", phone: identity.phone, normalizedPhone: identity.phone, ...data }
    }),
    channel: (data: Partial<Prisma.ChannelUncheckedCreateInput> = {}) => db.channel.create({
      data: { companyId, name: "OpenCredit", type: "OPEN_CREDIT", provider: "internal", ...data }
    }),
    user: (name = "Attendant", role = "AGENT") => db.user.create({ data: {
      companyId, name, role, email: randomUUID() + "@example.invalid", passwordHash: "synthetic"
    } }),
    settings: (mode: string, onlineOnly = false, maxOpenPerAttendant: number | null = null) =>
      db.leadAssignmentSetting.create({ data: { companyId, mode, onlineOnly, maxOpenPerAttendant } }),
    async createJob(details: Parameters<typeof crypto.protectMaterializationIdentity>[1] = identity, integrationId = integration.id, externalLeadId: string = randomUUID()) {
      const binding = { companyId, providerScope: integration.providerScope!, integrationId, externalLeadId, eventId: randomUUID() };
      const { eventId, ...origin } = binding;
      const event = await db.openCreditInboundEvent.create({ data: {
        ...origin, eventId, eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1
      } });
      const job = await db.openCreditLeadMaterialization.create({ data: {
        ...origin, inboundEventId: event.id, state: "PENDING", expiresAt: new Date(Date.now() + 600_000),
        protectedEnvelope: crypto.protectMaterializationIdentity(binding, details)
      } });
      return { job, event };
    },
    async claim(id: string) {
      const lease = (await queue.claim()).find(row => row.id === id);
      assert(lease);
      return lease;
    },
    get: (id: string) => db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id } }),
    counts: () => Promise.all([
      db.contact.count({ where }), db.channel.count({ where }), db.conversation.count({ where: conversationWhere }),
      db.leadAssignmentHistory.count({ where }), db.message.count({ where: { conversation: conversationWhere } })
    ]),
    async cleanup() {
      await db.openCreditLeadMaterialization.deleteMany({ where });
      await db.openCreditInboundEvent.deleteMany({ where });
      await db.openCreditIntegration.deleteMany({ where });
      await db.leadAssignmentHistory.deleteMany({ where });
      await db.conversation.deleteMany({ where: conversationWhere });
      await db.channel.deleteMany({ where });
      await db.contact.deleteMany({ where });
      await db.userAvailability.deleteMany({ where });
      await db.leadAssignmentSetting.deleteMany({ where });
      await db.user.deleteMany({ where });
      await db.company.delete({ where: { id: companyId } });
    }
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function materialize(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const f = await fixture();
    try { await run(f); }
    finally { await f.cleanup(); }
  });
}
async function runJob(f: Fixture, details?: Parameters<Fixture["createJob"]>[0], defenseInDepth = false) {
  const { job } = await f.createJob(details);
  // Explicitly emulate a preexisting lease for materializer defense-in-depth cases.
  const lease = defenseInDepth
    ? await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: {
      state: "PROCESSING", attempts: 1, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000),
    }, select: { id: true, leaseToken: true } }) as MaterializationLease
    : await f.claim(job.id);
  await f.process(lease);
  return { row: await f.get(job.id), lease };
}

materialize("compatible Contact arriving after readiness is reused by the materializer", async f => {
  const { job } = await f.createJob();
  const lease = await f.claim(job.id);
  const contact = await f.contact({ cpf: identity.cpf });
  await f.process(lease);
  const row = await f.get(job.id);
  assert.equal(row.state, "COMPLETED");
  assert.equal(row.contactId, contact.id);
  assert.equal(row.attempts, 1);
  assert.deepEqual(await db.contact.findUniqueOrThrow({ where: { id: contact.id } }), contact);
  assert.deepEqual(await f.counts(), [1, 1, 1, 0, 0]);
});

materialize("conflicting Contact arriving after readiness fails closed without wrong linkage", async f => {
  const { job } = await f.createJob();
  const lease = await f.claim(job.id);
  const contact = await f.contact({ cpf: "52998224725" });
  await f.process(lease);
  const row = await f.get(job.id);
  assert.equal(row.state, "NEEDS_REVIEW");
  assert.equal(row.reviewCode, "CONTACT_IDENTITY_CONFLICT");
  assert.deepEqual([row.contactId, row.channelId, row.conversationId], [null, null, null]);
  assert.deepEqual(await db.contact.findUniqueOrThrow({ where: { id: contact.id } }), contact);
  assert.deepEqual(await f.counts(), [1, 0, 0, 0, 0]);
});

materialize("new domain and outcome commit together, replay does nothing, outbound is blocked and no message exists", async f => {
  const { row, lease } = await runJob(f);
  assert.equal(row.state, "COMPLETED");
  assert(row.contactId && row.channelId && row.conversationId);
  assert.deepEqual([row.protectedEnvelope, row.leaseToken, row.leaseUntil, row.availableAt, row.lastErrorCode, row.reviewCode], Array(6).fill(null));
  assert.deepEqual(await f.counts(), [1, 1, 1, 0, 0]);
  assert.equal(await f.process(lease), null);
  assert.deepEqual(await f.counts(), [1, 1, 1, 0, 0]);
  const conversation = await db.conversation.findFirstOrThrow({
    where: { id: row.conversationId, status: "OPEN", contact: { companyId: f.companyId, archivedAt: null } },
    include: { contact: true, channelRef: true }
  });
  assert.equal(conversation.agentId, null);
  assert.equal(conversation.contact.ownerId, null);
  assert(isOpenCreditConversation(conversation));
  assert(conversation.channelRef);
  for (const field of ["externalId", "phoneNumberId", "wabaId", "displayPhone", "accessToken", "verifyToken", "appSecret", "lastWebhookSubscribedAt", "lastWebhookReceivedAt"] as const) {
    assert.equal(conversation.channelRef[field], null);
  }
  await assert.rejects(() => outbound.getConversationIntegration({ companyId: f.companyId, conversationId: conversation.id }), /OPENCREDIT_TRANSPORT_BLOCKED/);
  await assert.rejects(() => f.createJob(otherIdentity, f.integration.id, row.externalLeadId), { code: "P2002" });
});

for (const lookup of ["cpf", "phone", "legacy phone", "both"] as const) {
  materialize("reuse exact active Contact by " + (lookup === "phone" ? "phone with no local CPF" : lookup), async f => {
    const contact = await f.contact({
      cpf: lookup === "cpf" || lookup === "both" ? identity.cpf : null,
      phone: lookup === "cpf" ? otherIdentity.phone : lookup === "legacy phone" ? "(11) 98765-4321" : identity.phone,
      normalizedPhone: lookup === "cpf" ? otherIdentity.phone : lookup === "legacy phone" ? null : identity.phone
    });
    const { row } = await runJob(f, lookup === "cpf" ? { ...identity, phone: null } : identity);
    assert.equal(row.state, "COMPLETED");
    assert.equal(row.contactId, contact.id);
    assert.deepEqual(await db.contact.findUniqueOrThrow({ where: { id: contact.id } }), contact);
  });
}

materialize("matching phone with conflicting local CPF requires review and preserves the Contact", async f => {
  const contact = await f.contact({ cpf: "52998224725" });
  const { row } = await runJob(f, identity, true);
  assert.equal(row.state, "NEEDS_REVIEW");
  assert.equal(row.reviewCode, "CONTACT_IDENTITY_CONFLICT");
  assert.deepEqual([row.contactId, row.channelId, row.conversationId], [null, null, null]);
  assert.deepEqual(await db.contact.findUniqueOrThrow({ where: { id: contact.id } }), contact);
  assert.deepEqual(await f.counts(), [1, 0, 0, 0, 0]);
});

materialize("lead without CPF can reuse the matching phone with a local CPF", async f => {
  const contact = await f.contact({ cpf: "52998224725" });
  const { row } = await runJob(f, { ...identity, cpf: null });
  assert.equal(row.state, "COMPLETED");
  assert.equal(row.contactId, contact.id);
  assert.deepEqual(await db.contact.findUniqueOrThrow({ where: { id: contact.id } }), contact);
});

for (const reason of ["CONTACT_IDENTITY_CONFLICT", "CONTACT_ARCHIVED_MATCH", "CONTACT_DATA_INCOMPLETE"] as const) {
  materialize(reason + " leaves domain unchanged", async f => {
    if (reason === "CONTACT_IDENTITY_CONFLICT") {
      await f.contact({ cpf: identity.cpf, phone: otherIdentity.phone, normalizedPhone: otherIdentity.phone });
      await f.contact();
    }
    if (reason === "CONTACT_ARCHIVED_MATCH") await f.contact({ archivedAt: new Date() });
    const before = await f.counts();
    const { row } = await runJob(f, reason === "CONTACT_DATA_INCOMPLETE" ? { ...identity, phone: null } : identity, true);
    assert.equal(row.state, "NEEDS_REVIEW");
    assert.equal(row.reviewCode, reason);
    assert.deepEqual(await f.counts(), before);
  });
}
materialize("two exact phone matches fail closed", async f => {
  await f.contact();
  await f.contact({ phone: "(11) 98765-4321", normalizedPhone: null });
  const { row } = await runJob(f, identity, true);
  assert.equal(row.reviewCode, "CONTACT_IDENTITY_CONFLICT");
  assert.deepEqual(await f.counts(), [2, 0, 0, 0, 0]);
});

for (const multiple of [false, true]) materialize("reserved Channel conflict rolls back new Contact, multiple=" + multiple, async f => {
  await f.channel({ type: "whatsapp" });
  if (multiple) await f.channel();
  const before = await f.counts();
  const { row } = await runJob(f);
  assert.equal(row.state, "NEEDS_REVIEW");
  assert.equal(row.reviewCode, "CHANNEL_CONFIGURATION_CONFLICT");
  assert.deepEqual(await f.counts(), before);
});

for (const status of ["OPEN", "PENDING", "BOT", "SOLD", "RESOLVED"] as const) {
  materialize("exact Channel and Conversation with status " + status, async f => {
    const contact = await f.contact();
    const channel = await f.channel();
    const old = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "OPEN_CREDIT", status } });
    const { row } = await runJob(f);
    assert.equal(row.state, "COMPLETED");
    assert.equal(row.channelId, channel.id);
    if (status === "SOLD" || status === "RESOLVED") {
      assert.notEqual(row.conversationId, old.id);
      assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: row.conversationId! } })).status, "OPEN");
      assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: old.id } })).status, status);
    } else assert.equal(row.conversationId, old.id);
  });
}

materialize("active Conversation marker mismatch stays untouched", async f => {
  const contact = await f.contact();
  const channel = await f.channel();
  const old = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "whatsapp" } });
  const { row } = await runJob(f);
  assert.equal(row.reviewCode, "CONVERSATION_CONFIGURATION_CONFLICT");
  assert.deepEqual(await db.conversation.findUniqueOrThrow({ where: { id: old.id } }), old);
});

for (const mode of ["CLAIM_FIRST", "ADMIN_MANUAL"]) materialize(mode + " leaves agent null", async f => {
  await f.user();
  await f.settings(mode);
  const { row } = await runJob(f);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: row.conversationId! } })).agentId, null);
  assert.deepEqual(await f.counts(), [1, 1, 1, 0, 0]);
});

materialize("ROUND_ROBIN uses load, role and availability, preserves Contact.ownerId, writes one history", async f => {
  const offline = await f.user("A");
  const loaded = await f.user("B");
  const agent = await f.user("C", "SUPERVISOR");
  const tied = await f.user("D");
  const admin = await f.user("A admin", "ADMIN");
  await db.userAvailability.createMany({ data: [loaded, agent, tied, admin].map(user => ({
    userId: user.id, companyId: f.companyId, status: "ONLINE"
  })) });
  await f.settings("ROUND_ROBIN", true, 1);
  const contact = await f.contact({ ownerId: offline.id });
  await db.conversation.create({ data: { contactId: contact.id, agentId: loaded.id, status: "BOT" } });
  const { row } = await runJob(f);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: row.conversationId! } })).agentId, agent.id);
  assert.equal((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).ownerId, offline.id);
  const history = await db.leadAssignmentHistory.findMany({ where: { companyId: f.companyId } });
  assert.equal(history.length, 1);
  assert.deepEqual([history[0].conversationId, history[0].assignedToUserId, history[0].assignedByUserId, history[0].mode, history[0].action],
    [row.conversationId, agent.id, null, "ROUND_ROBIN", "ASSIGNED"]);
  await db.conversation.update({ where: { id: row.conversationId! }, data: { agentId: admin.id } });
  const replay = await runJob(f);
  assert.equal(replay.row.conversationId, row.conversationId);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: row.conversationId! } })).agentId, admin.id);
  assert.equal(await db.leadAssignmentHistory.count({ where: { companyId: f.companyId } }), 1);
});

for (const failure of ["wrong token", "expired lease", "expired job", "mode unavailable", "invalid envelope", "misbound envelope", "missing key"] as const) {
  materialize(failure + " cannot create domain", async f => {
    const { job, event } = await f.createJob();
    const lease = await f.claim(job.id);
    if (failure === "wrong token") lease.leaseToken = randomUUID();
    if (failure === "expired lease") await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
    if (failure === "expired job") await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { expiresAt: new Date(0) } });
    if (failure === "mode unavailable") await db.openCreditIntegration.update({ where: { id: f.integration.id }, data: { materializationEnabled: false } });
    if (failure === "invalid envelope") await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { protectedEnvelope: "invalid" } });
    if (failure === "misbound envelope") await db.openCreditLeadMaterialization.update({
      where: { id: job.id },
      data: { protectedEnvelope: crypto.protectMaterializationIdentity({ ...event, eventId: randomUUID() }, identity) }
    });
    if (failure === "missing key") delete process.env[keyVariable];
    try { await f.process(lease); } finally { process.env[keyVariable] = key; }
    const row = await f.get(job.id);
    if (failure === "mode unavailable" || failure === "missing key") {
      assert.equal(row.state, "RETRY");
      assert.equal(row.lastErrorCode, failure === "mode unavailable" ? "MODE_UNAVAILABLE" : "KEY_UNAVAILABLE");
    } else if (failure === "invalid envelope" || failure === "misbound envelope") {
      assert.equal(row.state, "NEEDS_REVIEW");
      assert.equal(row.reviewCode, "ENVELOPE_INVALID");
    } else assert.equal(row.state, "PROCESSING");
    assert.deepEqual(await f.counts(), [0, 0, 0, 0, 0]);
  });
}

function observeSql(beforeQuery: (tx: Prisma.TransactionClient, sql: string) => Promise<void>) {
  return {
    $queryRaw: db.$queryRaw.bind(db),
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel }) =>
      db.$transaction(tx => run(new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== "$queryRaw") return Reflect.get(target, property, receiver);
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            await beforeQuery(target, strings.join("?"));
            return target.$queryRaw(strings, ...values);
          };
        }
      })), options)
  } as Pick<PrismaClient, "$queryRaw" | "$transaction">;
}

for (const failure of ["lost lease", "database failure"] as const) materialize("failure at completion rolls back Contact, Channel, Conversation and history: " + failure, async f => {
  await f.user();
  await f.settings("ROUND_ROBIN");
  const { job } = await f.createJob();
  const lease = await f.claim(job.id);
  let reached = false;
  const storage = observeSql(async (tx, sql) => {
    if (!sql.includes('"state" = \'COMPLETED\'')) return;
    reached = true;
    assert.equal(await tx.leadAssignmentHistory.count({ where: { companyId: f.companyId } }), 1);
    if (failure === "database failure") throw new Error("synthetic");
    await tx.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
  });
  await core.createOpenCreditDomainMaterializer(storage).process(lease);
  assert(reached);
  const row = await f.get(job.id);
  assert.equal(row.state, failure === "lost lease" ? "PROCESSING" : "RETRY");
  assert.equal(row.lastErrorCode, failure === "lost lease" ? null : "TRANSIENT_FAILURE");
  assert(row.protectedEnvelope);
  assert.deepEqual(await f.counts(), [0, 0, 0, 0, 0]);
});

async function finishAfterRetry(f: Fixture, id: string) {
  const row = await f.get(id);
  if (row.state === "RETRY") {
    assert(["TRANSIENT_FAILURE", "SERIALIZATION_CONFLICT"].includes(row.lastErrorCode!));
    await db.openCreditLeadMaterialization.update({ where: { id }, data: { availableAt: new Date(0) } });
    await f.process(await f.claim(id));
  }
  const done = await f.get(id);
  assert.equal(done.state, "COMPLETED");
  return done;
}

for (const scenario of ["same identity", "different contacts", "same existing Contact", "capacity"] as const) {
  materialize("concurrent jobs converge: " + scenario, async f => {
    if (scenario === "same existing Contact") { await f.contact(); await f.channel(); }
    if (scenario === "capacity") { await f.channel(); await f.user(); await f.settings("ROUND_ROBIN", false, 1); }
    const second = await f.makeIntegration();
    const same = scenario === "same identity" || scenario === "same existing Contact";
    const { job: a } = await f.createJob();
    const { job: b } = await f.createJob(same ? identity : otherIdentity, second.id);
    const leases = (await queue.claim()).filter(row => row.id === a.id || row.id === b.id);
    assert.equal(leases.length, 2);
    let arrived = 0;
    let release!: () => void;
    const together = new Promise<void>(done => { release = done; });
    const storage = observeSql(async (tx, sql) => {
      if (sql.includes('SELECT "id", "inboundEventId"') && sql.includes("FOR UPDATE")) {
        await tx.$queryRaw`SELECT pg_current_snapshot()::text`;
        if (++arrived === 2) release();
        await together;
      }
    });
    const materializer = core.createOpenCreditDomainMaterializer(storage);
    await Promise.all(leases.map(lease => materializer.process(lease)));
    assert.equal(arrived, 2);
    const first = await finishAfterRetry(f, a.id);
    const last = await finishAfterRetry(f, b.id);
    assert.equal(first.channelId, last.channelId);
    assert.equal(first.contactId === last.contactId, same);
    assert.equal(first.conversationId === last.conversationId, same);
    const size = same ? 1 : 2;
    assert.deepEqual(await f.counts(), [size, 1, size, scenario === "capacity" ? 1 : 0, 0]);
    if (scenario === "capacity") assert.equal(await db.conversation.count({
      where: { contact: { companyId: f.companyId }, agentId: { not: null } }
    }), 1);
  });
}

materialize("human assignment during resolution wins and produces no automatic history", async f => {
  const contact = await f.contact();
  const channel = await f.channel();
  const human = await f.user("Human", "ADMIN");
  await f.user("Automatic");
  await f.settings("ROUND_ROBIN");
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "OPEN_CREDIT" } });
  const { job } = await f.createJob();
  const lease = await f.claim(job.id);
  const storage = observeSql(async (_tx, sql) => {
    if (sql.includes('SELECT "id", "agentId", "channel"')) {
      await db.conversation.update({ where: { id: conversation.id }, data: { agentId: human.id } });
    }
  });
  await core.createOpenCreditDomainMaterializer(storage).process(lease);
  assert.equal((await finishAfterRetry(f, job.id)).conversationId, conversation.id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: conversation.id } })).agentId, human.id);
  assert.equal(await db.leadAssignmentHistory.count({ where: { companyId: f.companyId } }), 0);
});

materialize("outcome CHECK and foreign keys reject partial, unfinished, cross-tenant and mismatched outcomes", async f => {
  const { job } = await f.createJob();
  const foreign = await db.company.create({ data: { name: "Foreign fixture" } });
  try {
    const contact = await f.contact();
    const channel = await f.channel();
    const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "OPEN_CREDIT" } });
    const otherContact = await f.contact({ companyId: foreign.id });
    const outcome = { contactId: contact.id, channelId: channel.id, conversationId: conversation.id };
    const update = (data: Prisma.OpenCreditLeadMaterializationUncheckedUpdateInput) =>
      db.openCreditLeadMaterialization.update({ where: { id: job.id }, data });
    await assert.rejects(() => update({ state: "COMPLETED", contactId: contact.id }));
    await assert.rejects(() => update({ state: "NEEDS_REVIEW", ...outcome }));
    await assert.rejects(() => update({ state: "COMPLETED", ...outcome, contactId: otherContact.id }), { code: "P2003" });
    const wrong = await f.contact({ phone: otherIdentity.phone, normalizedPhone: otherIdentity.phone });
    await assert.rejects(() => update({ state: "COMPLETED", ...outcome, contactId: wrong.id }), { code: "P2003" });
    assert.equal((await f.get(job.id)).state, "PENDING");
  } finally {
    await db.contact.deleteMany({ where: { companyId: foreign.id } });
    await db.company.delete({ where: { id: foreign.id } });
  }
});

materialize("Contact and Channel of another company cannot be reused", async f => {
  const foreign = await db.company.create({ data: { name: "Foreign fixture" } });
  try {
    const contact = await f.contact({ companyId: foreign.id, cpf: identity.cpf });
    const channel = await f.channel({ companyId: foreign.id });
    const { row } = await runJob(f);
    assert.equal(row.state, "COMPLETED");
    assert.notEqual(row.contactId, contact.id);
    assert.notEqual(row.channelId, channel.id);
    assert.deepEqual(await f.counts(), [1, 1, 1, 0, 0]);
  } finally {
    await db.channel.deleteMany({ where: { companyId: foreign.id } });
    await db.contact.deleteMany({ where: { companyId: foreign.id } });
    await db.company.delete({ where: { id: foreign.id } });
  }
});

test("upgrade from 31 migrations preserves historical jobs, inbox, legacy and domain rows without backfill", async () => {
  const name = "qevora_materializer_" + randomUUID().replaceAll("-", "");
  const directory = mkdtempSync(join(resolve(tmpdir()), "qevora-materializer-"));
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const schema = join(directory, "schema.postgres.prisma");
  const deploy = () => {
    const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120_000
    });
    assert.equal(result.status, 0, "DISPOSABLE_MATERIALIZER_UPGRADE_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", schema);
    mkdirSync(join(directory, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(directory, "migrations", "migration_lock.toml"));
    const copy = (entry: string) => cpSync(join("prisma/migrations", entry), join(directory, "migrations", entry), { recursive: true });
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    const previous = names.filter(entry => entry < migration);
    assert.equal(previous.length, 31);
    for (const entry of previous) copy(entry);
    deploy();
    const { id: companyId } = await isolated.company.create({ data: { name: "Historical" } });
    const providerScope = "historical-scope";
    const integration = await isolated.openCreditIntegration.create({ data: {
      companyId, providerScope, enabled: true, passiveInboundEnabled: true, publicWebhookId: randomUUID(), webhookSecret: "synthetic"
    } });
    await ingestOpenCreditLead(isolated, integration, parseOpenCreditAssignedLead({
      event: "lead.assigned", eventId: "legacy-event", contractVersion: 2, assignedAt: "2026-11-06T12:00:00Z",
      lead: { id: "legacy-lead" }, client: { phone: identity.phone }
    }));
    const contact = await isolated.contact.findFirstOrThrow({ where: { companyId } });
    const channel = await isolated.channel.create({ data: { companyId, name: "OpenCredit", type: "OPEN_CREDIT", provider: "internal" } });
    await isolated.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "OPEN_CREDIT" } });
    for (const state of ["PENDING", "COMPLETED"]) {
      const externalLeadId = randomUUID();
      const event = await isolated.openCreditInboundEvent.create({ data: {
        companyId, providerScope, integrationId: integration.id, externalLeadId, eventId: randomUUID(), eventType: "lead.assigned",
        provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1
      } });
      await isolated.$executeRaw`
        INSERT INTO "OpenCreditLeadMaterialization"
          ("id", "companyId", "providerScope", "integrationId", "externalLeadId", "inboundEventId", "state", "protectedEnvelope", "expiresAt", "updatedAt")
        VALUES (${randomUUID()}, ${companyId}, ${providerScope}, ${integration.id}, ${externalLeadId}, ${event.id},
          ${state}, ${state === "PENDING" ? "synthetic-cipher" : null}, NOW() + INTERVAL '1 day', NOW())`;
    }
    const snapshot = () => Promise.all([
      isolated.openCreditIntegration.findMany(), isolated.openCreditLead.findMany(), isolated.openCreditEvent.findMany(),
      isolated.openCreditInboundEvent.findMany({ orderBy: { id: "asc" } }),
      isolated.contact.findMany(), isolated.channel.findMany(), isolated.conversation.findMany(),
      isolated.$queryRaw`SELECT "id", "state", "protectedEnvelope", "expiresAt", "updatedAt" FROM "OpenCreditLeadMaterialization" ORDER BY "id"`
    ]);
    const before = await snapshot();
    copy(migration);
    deploy();
    assert.deepEqual(await snapshot(), before);
    const jobs = await isolated.openCreditLeadMaterialization.findMany();
    assert.equal(jobs.length, 2);
    assert(jobs.every(row => row.contactId === null && row.channelId === null && row.conversationId === null));
  } finally {
    await isolated.$disconnect();
    await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    assert(directory.startsWith(resolve(tmpdir()) + sep + "qevora-materializer-"));
    rmSync(directory, { recursive: true, force: true });
  }
});
