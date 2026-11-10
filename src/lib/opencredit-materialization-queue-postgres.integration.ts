import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
type QueueModule = typeof import("./opencredit-materialization-queue.service");
let completeInTransaction: QueueModule["completeInTransaction"];
let createOpenCreditMaterializationQueue: QueueModule["createOpenCreditMaterializationQueue"];
let materializationRetryDelayMs: QueueModule["materializationRetryDelayMs"];
let MaterializationLeaseLostError: QueueModule["MaterializationLeaseLostError"];

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_MATERIALIZATION_QUEUE_POSTGRES_TEST !== "1") throw new Error("QUEUE_TEST_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let queue: ReturnType<QueueModule["createOpenCreditMaterializationQueue"]>;
const originalFetch = globalThis.fetch;
let externalRequests = 0;
let payload: typeof import("./opencredit-lead-materialization-payload");
let preflight: typeof import("./opencredit-materialization-preflight.service");
let readinessCore: typeof import("./opencredit-materialization-readiness");
const previousKey = process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
before(() => {
  process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = Buffer.alloc(32, 27).toString("base64");
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try {
    payload = createRequire(import.meta.url)("./opencredit-lead-materialization-payload");
    preflight = createRequire(import.meta.url)("./opencredit-materialization-preflight.service");
    readinessCore = createRequire(import.meta.url)("./opencredit-materialization-readiness");
    ({ completeInTransaction, createOpenCreditMaterializationQueue, materializationRetryDelayMs,
      MaterializationLeaseLostError } = createRequire(import.meta.url)("./opencredit-materialization-queue.service"));
    queue = createOpenCreditMaterializationQueue(db, () => 0.5);
  }
  finally { loader._load = original; }
  globalThis.fetch = async () => { externalRequests++; throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (previousKey === undefined) delete process.env.QEVORA_DATA_ENCRYPTION_KEY_V1;
  else process.env.QEVORA_DATA_ENCRYPTION_KEY_V1 = previousKey;
  await db.$disconnect();
  assert.equal(externalRequests, 0);
});

async function databaseNow() {
  const [row] = await db.$queryRaw<Array<{ now: Date }>>`SELECT statement_timestamp() AT TIME ZONE 'UTC' AS now`;
  return row.now.getTime();
}

async function fixture() {
  const company = await db.company.create({ data: { name: "Queue test" } });
  const companyId = company.id;
  const providerScope = "queue-synthetic";
  const integration = await db.openCreditIntegration.create({
    data: { companyId, providerScope, publicWebhookId: randomUUID(), webhookSecret: "synthetic", materializationEnabled: true },
  });
  const now = await databaseNow();
  const operator = await db.user.create({ data: { companyId, name: "Queue operator", email: randomUUID() + "@invalid.test", passwordHash: "synthetic", role: "ADMIN" } });
  const channel = await db.channel.create({ data: {
    companyId, name: "Queue AutoStart channel", type: "whatsapp", provider: "meta", status: "ACTIVE",
  } });
  await db.openCreditWhatsappConfig.create({ data: {
    integrationId: integration.id, companyId, providerScope, configuredByUserId: operator.id,
    autoStartEnabled: true, defaultWhatsappChannelId: channel.id,
    initialTemplateName: "synthetic_template", initialTemplateLanguage: "pt_BR",
    updatedAt: new Date(now - 120_000),
  } });
  async function create(overrides: Partial<Prisma.OpenCreditLeadMaterializationUncheckedCreateInput> = {}) {
    const externalLeadId = "lead-" + randomUUID();
    const binding = { companyId, providerScope, integrationId: integration.id, externalLeadId };
    const event = await db.openCreditInboundEvent.create({
      data: { ...binding, eventId: externalLeadId + ":partner", eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1 },
    });
    return db.openCreditLeadMaterialization.create({ data: {
      ...binding, inboundEventId: event.id, state: "PENDING", protectedEnvelope: payload.protectMaterializationIdentity({ ...binding, eventId: event.eventId },
        { cpf: null, phone: "5511987654321", name: null, email: null }),
      createdAt: new Date(now - 60_000), expiresAt: new Date(now + 600_000), ...overrides,
    } });
  }
  const get = (id: string) => db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id } });
  const disable = () => db.openCreditIntegration.update({ where: { id: integration.id }, data: { materializationEnabled: false } });
  const ageLease = (id: string, expires = false) => db.openCreditLeadMaterialization.update({
    where: { id }, data: { leaseUntil: new Date(now - 2000), ...(expires ? { expiresAt: new Date(now - 1000) } : {}) },
  });
  return { companyId, integration, providerScope, now, create, get, disable, ageLease };
}

function queueTest(name: string, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>, contacts = 0) {
  test(name, async () => {
    const f = await fixture();
    const { companyId } = f;
    try {
      await run(f);
      assert.deepEqual(await Promise.all([
        db.contact.count({ where: { companyId } }),
        db.conversation.count({ where: { contact: { companyId } } }),
        db.channel.count({ where: { companyId } }),
        db.message.count({ where: { conversation: { contact: { companyId } } } }),
        db.leadAssignmentHistory.count({ where: { companyId } }),
      ]), [contacts, 0, 0, 0, 0]);
    } finally {
      await db.openCreditLeadMaterialization.deleteMany({ where: { companyId } });
      await db.openCreditInboundEvent.deleteMany({ where: { companyId } });
      await db.openCreditWhatsappConfig.deleteMany({ where: { companyId } });
      await db.openCreditIntegration.deleteMany({ where: { companyId } });
      await db.contact.deleteMany({ where: { companyId } });
      await db.user.deleteMany({ where: { companyId } });
      await db.company.delete({ where: { id: companyId } });
    }
  });
}

queueTest("pilot only claims the authorized binding and ID, once even under concurrency", async f => {
  const other = await f.create();
  const job = await f.create();
  const target = { id: job.id, companyId: f.companyId, integrationId: f.integration.id, providerScope: f.providerScope };
  for (const wrong of [{ id: "missing" }, { companyId: "wrong" }, { integrationId: "wrong" }, { providerScope: "wrong" }]) {
    assert.equal(await queue.claimPilotJob({ ...target, ...wrong }), null);
  }
  assert.deepEqual(await f.get(job.id), job);
  const results = await Promise.all([queue.claimPilotJob(target), queue.claimPilotJob(target)]);
  const claims = results.filter(lease => lease !== null);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, job.id);
  assert.equal(claims[0].attempts, 1);
  const claimed = await f.get(job.id);
  assert.equal(claimed.state, "PROCESSING");
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.leaseToken, claims[0].leaseToken);
  assert.equal(await queue.claimPilotJob(target), null);
  assert.deepEqual(await f.get(other.id), other);
});

queueTest("packaged pilot CLI loads the production imports and exits on an absent target", async f => {
  const job = await f.create();
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "scripts/run-opencredit-materialization.ts",
    "--pilot", "--job-id", "missing", "--company-id", f.companyId,
    "--integration-id", f.integration.id, "--provider-scope", f.providerScope
  ], {
    env: { ...process.env, NODE_ENV: "production", OPENCREDIT_MATERIALIZATION_WORKER_ENABLED: "false" },
    encoding: "utf8", timeout: 15000
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), "PILOT_NOT_CLAIMED");
  assert.equal(result.stderr, "");
  assert.deepEqual(await f.get(job.id), job);
});

queueTest("pilot leaves ineligible jobs and integrations untouched", async f => {
  const binding = { companyId: f.companyId, integrationId: f.integration.id, providerScope: f.providerScope };
  for (const data of [
    { state: "NEEDS_REVIEW" }, { attempts: 1 },
    { expiresAt: new Date(f.now - 1000) }, { availableAt: new Date(f.now + 120000) }
  ]) {
    const job = await f.create(data);
    assert.equal(await queue.claimPilotJob({ ...binding, id: job.id }), null);
    assert.deepEqual(await f.get(job.id), job);
  }
  const job = await f.create();
  for (const data of [
    { enabled: true, paused: false, materializationEnabled: false },
    { enabled: false, paused: true, materializationEnabled: true },
    { enabled: false, paused: false, materializationEnabled: false }
  ]) {
    await db.openCreditIntegration.update({ where: { id: f.integration.id }, data });
    assert.equal(await queue.claimPilotJob({ ...binding, id: job.id }), null);
    assert.deepEqual(await f.get(job.id), job);
  }
});

queueTest("AutoStart reopening ignores backlog created before the current operating window", async f => {
  const old = await f.create({ createdAt: new Date(f.now - 60_000) });
  await db.openCreditWhatsappConfig.update({ where: { integrationId: f.integration.id }, data: {
    autoStartEnabled: false, updatedAt: new Date(f.now - 30_000),
  } });
  assert.deepEqual(await queue.claim(1), []);
  await db.openCreditWhatsappConfig.update({ where: { integrationId: f.integration.id }, data: {
    autoStartEnabled: true, updatedAt: new Date(f.now - 20_000),
  } });
  const fresh = await f.create({ createdAt: new Date(f.now - 10_000) });
  const claimed = await queue.claim(1);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, fresh.id);
  assert.equal((await f.get(old.id)).state, "PENDING");
  assert.equal((await f.get(old.id)).attempts, 0);
});

queueTest("claim orders by effective availability and ID, bounds the batch and returns no envelope", async f => {
  const expired = await f.create({ expiresAt: new Date(f.now - 1000) });
  const futurePending = await f.create({ availableAt: new Date(f.now + 120_000) });
  const futureRetry = await f.create({ state: "RETRY", availableAt: new Date(f.now + 120_000) });
  const early = await f.create({ state: "RETRY", availableAt: new Date(f.now - 120_000) });
  const ties = await Promise.all(Array.from({ length: 11 }, () => f.create()));
  const before = await databaseNow();
  const claimed = await queue.claim(99);
  const after = await databaseNow();
  assert.equal(claimed.length, 10);
  assert.deepEqual(claimed.map(job => job.id), [early.id, ...ties.map(job => job.id).sort().slice(0, 9)]);
  assert.equal(new Set(claimed.map(job => job.leaseToken)).size, 10);
  for (const job of claimed) {
    assert.deepEqual(Object.keys(job).sort(), ["attempts", "id", "leaseToken", "leaseUntil"]);
    assert.equal(job.attempts, 1);
    assert.match(job.leaseToken, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
    assert(job.leaseUntil.getTime() >= before + 59_999 && job.leaseUntil.getTime() <= after + 60_001);
    const row = await f.get(job.id);
    assert.equal(row.state, "PROCESSING");
    assert.equal(row.availableAt, null);
    assert.equal(row.leaseToken, job.leaseToken);
  }
  assert.equal((await f.get(expired.id)).attempts, 0);
  assert.equal((await f.get(futurePending.id)).attempts, 0);
  assert.equal((await f.get(futureRetry.id)).attempts, 0);
  await f.disable();
  assert.deepEqual(await queue.claim(), []);
});

queueTest("two concurrent workers skip a held lock and claim disjoint rows once", async f => {
  const oldest = await f.create({ createdAt: new Date(f.now - 120_000) });
  const ready = await Promise.all(Array.from({ length: 4 }, () => f.create()));
  let acquired!: () => void;
  let unlock!: () => void;
  const locked = new Promise<void>(resolve => { acquired = resolve; });
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const hold = db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "OpenCreditLeadMaterialization" WHERE "id" = ${oldest.id} FOR UPDATE`;
    acquired();
    await gate;
  }, { timeout: 8000 });
  try {
    await Promise.race([locked, hold]);
    const [a, b] = await Promise.all([queue.claim(2), queue.claim(2)]);
    assert.equal(a.length, 2);
    assert.equal(b.length, 2);
    const claims = [...a, ...b];
    assert.deepEqual(claims.map(job => job.id).sort(), ready.map(job => job.id).sort());
    assert.equal(new Set(claims.map(job => job.leaseToken)).size, 4);
    for (const job of claims) assert.equal((await f.get(job.id)).attempts, 1);
  } finally { unlock(); await hold; }
  assert.equal((await queue.claim(1))[0].id, oldest.id);
});

queueTest("wrong, expired and replaced tokens cannot complete, retry or review", async f => {
  const complete = (lease: { id: string; leaseToken: string }) => db.$transaction(tx =>
    completeInTransaction(tx, lease, { contactId: "absent", channelId: "absent", conversationId: "absent" }));
  const row = await f.create();
  const [first] = await queue.claim();
  const wrong = { ...first, leaseToken: "wrong-token" };
  await assert.rejects(() => complete(wrong), MaterializationLeaseLostError);
  assert.equal(await queue.retry(wrong, "TRANSIENT_FAILURE"), null);
  assert.equal(await queue.review(wrong, "ENVELOPE_INVALID"), null);
  assert.throws(() => queue.retry(first, "unsafe" as never), /INVALID_MATERIALIZATION_RETRY_CODE/);
  assert.throws(() => queue.review(first, "unsafe" as never), /INVALID_MATERIALIZATION_REVIEW_CODE/);

  await f.ageLease(row.id);
  await assert.rejects(() => complete(first), MaterializationLeaseLostError);
  assert.equal(await queue.retry(first, "TRANSIENT_FAILURE"), null);
  assert.equal(await queue.review(first, "ENVELOPE_INVALID"), null);
  assert.deepEqual(await queue.recover(), [{ id: row.id, state: "RETRY" }]);
  const recovered = await f.get(row.id);
  assert.equal(recovered.attempts, 1);
  assert.equal(recovered.lastErrorCode, "LEASE_EXPIRED");
  assert.equal(recovered.leaseToken, null);
  assert.equal(recovered.leaseUntil, null);
  assert.equal(recovered.protectedEnvelope, row.protectedEnvelope);
  assert.deepEqual(await queue.claim(), []);

  await db.openCreditLeadMaterialization.update({ where: { id: row.id }, data: { availableAt: new Date(f.now - 1000) } });
  const [second] = await queue.claim();
  assert.equal(second.attempts, 2);
  assert.notEqual(second.leaseToken, first.leaseToken);
  await assert.rejects(() => complete(first), MaterializationLeaseLostError);
  assert.equal(await queue.retry(first, "TRANSIENT_FAILURE"), null);
  assert.equal(await queue.review(first, "ENVELOPE_INVALID"), null);
  assert.deepEqual(await queue.review(second, "IDENTITY_INSUFFICIENT"), { id: row.id, state: "NEEDS_REVIEW" });
  await assert.rejects(() => complete(second), MaterializationLeaseLostError);
});

queueTest("valid token can send a job for review while retaining the opaque envelope", async f => {
  const job = await f.create();
  const [lease] = await queue.claim();
  assert.deepEqual(await queue.review(lease, "BINDING_MISMATCH"), { id: job.id, state: "NEEDS_REVIEW" });
  const row = await f.get(job.id);
  assert.equal(row.reviewCode, "BINDING_MISMATCH");
  assert.equal(row.protectedEnvelope, job.protectedEnvelope);
  assert.equal(row.leaseToken, null);
  assert.equal(row.leaseUntil, null);
});

test("retry delay uses exponential equal jitter and never exceeds five minutes", () => {
  assert.equal(materializationRetryDelayMs(1, () => 0), 5000);
  assert.equal(materializationRetryDelayMs(2, () => 0.5), 7500);
  assert.equal(materializationRetryDelayMs(3, () => 0.5), 15000);
  assert.equal(materializationRetryDelayMs(10, () => 1), 300000);
});

queueTest("retry schedules against PostgreSQL time and the tenth failure goes to review", async f => {
  const first = await f.create({ attempts: 1 });
  const last = await f.create({ attempts: 9 });
  const claims = await queue.claim();
  const lease = claims.find(job => job.id === first.id)!;
  const finalLease = claims.find(job => job.id === last.id)!;
  const before = await databaseNow();
  assert.deepEqual(await queue.retry(lease, "KEY_UNAVAILABLE"), { id: first.id, state: "RETRY" });
  const after = await databaseNow();
  const row = await f.get(first.id);
  assert(row.availableAt && row.availableAt.getTime() >= before + 7499 && row.availableAt.getTime() <= after + 7501);
  assert.equal(row.lastErrorCode, "KEY_UNAVAILABLE");
  assert.equal(finalLease.attempts, 10);
  assert.deepEqual(await queue.retry(finalLease, "TRANSIENT_FAILURE"), { id: last.id, state: "NEEDS_REVIEW" });
  const exhausted = await f.get(last.id);
  assert.equal(exhausted.reviewCode, "RETRY_EXHAUSTED");
  assert.equal(exhausted.availableAt, null);
  assert.equal(exhausted.attempts, 10);
  assert.deepEqual(await queue.claim(), []);
});

queueTest("lease recovery honors exhaustion and gives expiration precedence", async f => {
  const live = await f.create({ attempts: 9 });
  const expired = await f.create({ attempts: 9 });
  await queue.claim();
  await f.ageLease(live.id);
  await f.ageLease(expired.id, true);
  const recovered = await queue.recover();
  assert.equal(recovered.length, 2);
  const rows = new Map(recovered.map(row => [row.id, row.state]));
  assert.equal(rows.get(live.id), "NEEDS_REVIEW");
  assert.equal(rows.get(expired.id), "EXPIRED");
  assert.equal((await f.get(live.id)).reviewCode, "RETRY_EXHAUSTED");
  assert.equal((await f.get(expired.id)).protectedEnvelope, null);
});

queueTest("expiration removes ciphertext in every eligible state even with opt-in off", async f => {
  const past = new Date(f.now - 1000);
  const pending = await f.create({ expiresAt: past });
  const retry = await f.create({ state: "RETRY", availableAt: past, expiresAt: past });
  const processing = await f.create({ state: "PROCESSING", leaseToken: randomUUID(), leaseUntil: new Date(f.now + 60000), expiresAt: past });
  const review = await f.create({ state: "NEEDS_REVIEW", reviewCode: "IDENTITY_INSUFFICIENT", expiresAt: past });
  const live = await f.create();
  await f.disable();
  const outcomes = await queue.expire();
  const expected = [pending, retry, processing, review];
  assert.deepEqual(outcomes.map(outcome => outcome.id).sort(), expected.map(job => job.id).sort());
  for (const job of expected) {
    const row = await f.get(job.id);
    assert.equal(row.state, "EXPIRED");
    assert.equal(row.protectedEnvelope, null);
    assert.equal(row.leaseToken, null);
    assert.equal(row.leaseUntil, null);
    assert.deepEqual(row.expiresAt, job.expiresAt);
  }
  assert.equal((await f.get(live.id)).state, "PENDING");
  assert.deepEqual(await queue.expire(), []);
});

queueTest("retry of an expired job with a still-valid token expires it instead", async f => {
  const job = await f.create();
  const [lease] = await queue.claim();
  await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { expiresAt: new Date(f.now - 1000) } });
  assert.deepEqual(await queue.retry(lease, "TRANSIENT_FAILURE"), { id: job.id, state: "EXPIRED" });
  assert.equal((await f.get(job.id)).protectedEnvelope, null);
});

queueTest("database rejects invalid attempts, leases, retry schedules, expired envelopes and error codes", async f => {
  const job = await f.create();
  for (const data of [
    { attempts: -1 }, { state: "PROCESSING" }, { leaseToken: "outside-processing" },
    { state: "RETRY" }, { state: "EXPIRED" }, { lastErrorCode: "unknown" },
  ]) {
    await assert.rejects(() => db.openCreditLeadMaterialization.update({ where: { id: job.id }, data }));
  }
  assert.deepEqual(await f.get(job.id), job);
});

test("queue migration preserves preexisting PENDING and NEEDS_REVIEW without claiming", async () => {
  const migration = "20261106120000_opencredit_materialization_queue";
  const name = "qevora_queue_upgrade_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^qevora_queue_upgrade_[a-f0-9]{32}$/);
  const temp = mkdtempSync(join(tmpdir(), "qevora-queue-upgrade-"));
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const deploy = () => {
    const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", join(temp, "schema.postgres.prisma")], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120000,
    });
    assert.equal(result.status, 0, "QUEUE_UPGRADE_MIGRATION_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", join(temp, "schema.postgres.prisma"));
    mkdirSync(join(temp, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(temp, "migrations/migration_lock.toml"));
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    assert(migrations.includes(migration));
    for (const dir of migrations.filter(dir => dir < migration)) cpSync(join("prisma/migrations", dir), join(temp, "migrations", dir), { recursive: true });
    deploy();
    const company = await isolated.company.create({ data: { name: "Historical queue" } });
    const companyId = company.id;
    const providerScope = "historical-queue";
    const integration = await isolated.openCreditIntegration.create({ data: { companyId, providerScope, publicWebhookId: randomUUID(), webhookSecret: "fixture" } });
    const emptyCompany = await isolated.company.create({ data: { name: "No historical jobs" } });
    for (const state of ["PENDING", "NEEDS_REVIEW"]) {
      const externalLeadId = "historical-" + state;
      const binding = { companyId, providerScope, integrationId: integration.id, externalLeadId };
      const event = await isolated.openCreditInboundEvent.create({ data: {
        ...binding, eventId: externalLeadId + ":partner", eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
      } });
      const reviewCode = state === "NEEDS_REVIEW" ? "IDENTITY_INSUFFICIENT" : null;
      await isolated.$executeRaw`
        INSERT INTO "OpenCreditLeadMaterialization" ("id","companyId","providerScope","integrationId","externalLeadId","inboundEventId","state","protectedEnvelope","expiresAt","reviewCode","updatedAt")
        VALUES (${externalLeadId}, ${companyId}, ${providerScope}, ${integration.id}, ${externalLeadId}, ${event.id},
                ${state}, 'historical-ciphertext', (now() AT TIME ZONE 'UTC') + INTERVAL '7 days', ${reviewCode}, now() AT TIME ZONE 'UTC')`;
    }
    const before = await isolated.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "OpenCreditLeadMaterialization" ORDER BY "id"`;
    cpSync(join("prisma/migrations", migration), join(temp, "migrations", migration), { recursive: true });
    deploy();
    await isolated.$disconnect();
    const after = await isolated.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "OpenCreditLeadMaterialization" ORDER BY "id"`;
    assert.deepEqual(after, before.map(row => ({ ...row, availableAt: null, attempts: 0, leaseToken: null, leaseUntil: null, lastErrorCode: null })));
    assert.equal(await isolated.openCreditLeadMaterialization.count({ where: { companyId: emptyCompany.id } }), 0);
    // Historical migration assertions above remain against that exact schema.
    // Current runtime claims also require the later additive guard tables.
    for (const dir of migrations.filter(dir => dir > migration)) cpSync(join("prisma/migrations", dir), join(temp, "migrations", dir), { recursive: true });
    deploy();
    assert.deepEqual(await createOpenCreditMaterializationQueue(isolated).claim(), []);
  } finally {
    await isolated.$disconnect();
    await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    rmSync(temp, { recursive: true, force: true });
  }
});

async function cpfJob(f: Awaited<ReturnType<typeof fixture>>, phone: string | null = null,
  overrides: Partial<Prisma.OpenCreditLeadMaterializationUncheckedCreateInput> = {}) {
  const job = await f.create(overrides);
  const event = await db.openCreditInboundEvent.findUniqueOrThrow({ where: { id: job.inboundEventId } });
  return db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: {
    protectedEnvelope: payload.protectMaterializationIdentity(event, { cpf: "12345678909", phone, name: null, email: null }),
  } });
}
const targetOf = (job: { id: string; companyId: string; integrationId: string; providerScope: string }) => ({
  id: job.id, companyId: job.companyId, integrationId: job.integrationId, providerScope: job.providerScope,
});
async function readiness(job: Parameters<typeof targetOf>[0]) {
  return db.$transaction(async tx => readinessCore.evaluateMaterializationReadiness(tx,
    await tx.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id: job.id } })));
}

queueTest("CPF-only waits without any row change in normal and pilot claim", async f => {
  const job = await cpfJob(f);
  assert.equal(await readiness(job), "WAITING_IDENTITY");
  assert.equal(await queue.claimPilotJob(targetOf(job)), null);
  assert.deepEqual(await queue.claim(), []);
  assert.deepEqual(await f.get(job.id), job);
});

queueTest("CPF-only reuses one active same-company Contact", async f => {
  const job = await cpfJob(f);
  await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic", cpf: "12345678909", phone: "5511987654321" } });
  assert.equal(await readiness(job), "READY_EXISTING_CONTACT");
  assert.equal((await queue.claimPilotJob(targetOf(job)))?.attempts, 1);
}, 1);

queueTest("valid normalized phone with no Contact is ready for a new Contact", async f => {
  const job = await f.create();
  assert.equal(await readiness(job), "READY_NEW_CONTACT");
  assert.equal((await queue.claimPilotJob(targetOf(job)))?.id, job.id);
});

queueTest("ambiguous CPF is review risk and neither claim mutates it", async f => {
  const job = await cpfJob(f);
  for (const phone of ["5511987654321", "5511976543210"]) await db.contact.create({ data: {
    companyId: f.companyId, name: "Synthetic", cpf: "12345678909", phone,
  } });
  assert.equal(await readiness(job), "REVIEW_REQUIRED");
  assert.equal(await queue.claimPilotJob(targetOf(job)), null);
  assert.deepEqual(await queue.claim(), []);
  assert.deepEqual(await f.get(job.id), job);
}, 2);

queueTest("archived matching Contact is review risk, never silently reused", async f => {
  const job = await cpfJob(f);
  await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic", cpf: "12345678909",
    phone: "5511987654321", archivedAt: new Date() } });
  assert.equal(await readiness(job), "REVIEW_REQUIRED");
  assert.equal(await queue.claimPilotJob(targetOf(job)), null);
  assert.deepEqual(await f.get(job.id), job);
}, 1);

queueTest("CPF match with conflicting phone fails closed", async f => {
  const job = await cpfJob(f, "5511987654321");
  await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic", cpf: "12345678909",
    phone: "5511976543210", normalizedPhone: "5511976543210" } });
  assert.equal(await readiness(job), "REVIEW_REQUIRED");
  assert.equal(await queue.claimPilotJob(targetOf(job)), null);
  assert.deepEqual(await f.get(job.id), job);
}, 1);

queueTest("foreign Contact never makes a CPF-only job ready", async f => {
  const job = await cpfJob(f);
  const other = await db.company.create({ data: { name: "Synthetic foreign" } });
  try {
    await db.contact.create({ data: { companyId: other.id, name: "Synthetic", cpf: "12345678909", phone: "5511987654321" } });
    assert.equal(await readiness(job), "WAITING_IDENTITY");
    assert.equal(await queue.claimPilotJob(targetOf(job)), null);
    assert.deepEqual(await f.get(job.id), job);
  } finally {
    await db.contact.deleteMany({ where: { companyId: other.id } });
    await db.company.delete({ where: { id: other.id } });
  }
});

queueTest("encrypted scope or integration mismatch is never ready", async f => {
  for (const mismatch of [{ providerScope: "wrong" }, { integrationId: "wrong" }]) {
    const job = await cpfJob(f, "5511987654321");
    const event = await db.openCreditInboundEvent.findUniqueOrThrow({ where: { id: job.inboundEventId } });
    await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: {
      protectedEnvelope: payload.protectMaterializationIdentity({ ...event, ...mismatch }, {
        cpf: "12345678909", phone: "5511987654321", name: null, email: null,
      }),
    } });
    assert.equal(await readiness(job), "REVIEW_REQUIRED");
    assert.equal(await queue.claimPilotJob(targetOf(job)), null);
    assert.equal((await f.get(job.id)).attempts, 0);
  }
});

queueTest("bounded keyset scanning crosses more than 100 waiting jobs on later cycles", async f => {
  for (let index = 0; index < 105; index++) await cpfJob(f, null, { createdAt: new Date(f.now - 120000 + index) });
  const ready = await f.create({ createdAt: new Date(f.now) });
  let pages = 0;
  const observed = createOpenCreditMaterializationQueue({
    $transaction: db.$transaction.bind(db),
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("LIMIT 25")) pages++;
      assert.doesNotMatch(strings.join("?"), /protectedEnvelope/);
      return db.$queryRaw(strings, ...values);
    },
  } as never);
  assert.deepEqual(await observed.claim(1), []);
  assert.equal(pages, 4);
  assert.equal((await observed.claim(1))[0].id, ready.id);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: { companyId: f.companyId, state: "PENDING", attempts: 0, leaseToken: null } }), 105);
});

queueTest("an active Contact writer does not prevent a readiness claim", async f => {
  const job = await f.create();
  await db.$transaction(async tx => {
    await tx.contact.create({ data: { companyId: f.companyId, name: "Synthetic", phone: "5511976543210" } });
    assert.equal((await queue.claimPilotJob(targetOf(job)))?.attempts, 1);
  });
  assert.equal((await f.get(job.id)).state, "PROCESSING");
}, 1);

queueTest("preflight audits all four readiness conditions read-only and never returns identity", async f => {
  const existing = await cpfJob(f);
  await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic", cpf: "12345678909", phone: "5511976543210" } });
  const waiting = await cpfJob(f);
  const event = await db.openCreditInboundEvent.findUniqueOrThrow({ where: { id: waiting.inboundEventId } });
  await db.openCreditLeadMaterialization.update({ where: { id: waiting.id }, data: {
    protectedEnvelope: payload.protectMaterializationIdentity(event, { cpf: "52998224725", phone: null, name: null, email: null }),
  } });
  await f.create();
  await f.create({ protectedEnvelope: "invalid" });
  await f.create({ availableAt: new Date(f.now + 120000) });
  const actor = await db.user.create({ data: { companyId: f.companyId, name: "Synthetic", email: randomUUID() + "@example.invalid", passwordHash: "synthetic", role: "ADMIN" } });
  const previous = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = f.companyId;
  const before = await db.openCreditLeadMaterialization.findMany({ where: { companyId: f.companyId }, orderBy: { id: "asc" } });
  try {
    const result = await preflight.getOpenCreditMaterializationPreflight(db, {
      actor: { ...actor, role: "ADMIN" }, companyId: f.companyId, providerScope: f.providerScope as Parameters<typeof preflight.getOpenCreditMaterializationPreflight>[1]["providerScope"],
    });
    const q = result.integrations[0].queue;
    assert.equal(q.pendingTotal, 5);
    assert.equal(q.expiredOrIneligible, 1);
    assert.deepEqual(q.readiness, { readyExistingContact: 1, readyNewContact: 1, waitingIdentity: 1,
      reviewRisk: 1, evaluated: 4, complete: true, nextCursor: null, scanLimit: 200 });
    assert.equal(q.readyIfEnabled, 2);
    assert.equal(q.claimableNow, 2);
    const output = JSON.stringify(result);
    for (const sensitive of ["12345678909", "52998224725", "5511976543210", "protectedEnvelope", existing.protectedEnvelope!]) assert(!output.includes(sensitive));
    assert.deepEqual(await db.openCreditLeadMaterialization.findMany({ where: { companyId: f.companyId }, orderBy: { id: "asc" } }), before);
  } finally {
    if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous;
  }
}, 1);

queueTest("expiry between readiness and lease update still prevents claim", async f => {
  const job = await f.create({ expiresAt: new Date(Date.now() + 500) });
  const observed = createOpenCreditMaterializationQueue({
    $queryRaw: db.$queryRaw.bind(db),
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      db.$transaction(tx => run(new Proxy(tx, {
        get(t, property) {
          if (property !== "$queryRaw") return Reflect.get(t, property);
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join("?").includes('UPDATE "OpenCreditLeadMaterialization" q')) await t.$queryRaw`SELECT pg_sleep(0.6)::text`;
            return t.$queryRaw(strings, ...values);
          };
        },
      })), options),
  } as never);
  assert.equal(await observed.claimPilotJob(targetOf(job)), null);
  assert.deepEqual(await f.get(job.id), job);
});

queueTest("Contact creation and editing finish while readiness claim remains open", async f => {
  const job = await f.create();
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  const observed = createOpenCreditMaterializationQueue({
    $queryRaw: db.$queryRaw.bind(db),
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      db.$transaction(tx => run(new Proxy(tx, {
        get(t, property) {
          if (property !== "$queryRaw") return Reflect.get(t, property);
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (strings.join("?").includes('UPDATE "OpenCreditLeadMaterialization" q')) { entered(); await gate; }
            return t.$queryRaw(strings, ...values);
          };
        },
      })), options),
  } as never);
  const claiming = observed.claimPilotJob(targetOf(job));
  await reached;
  try {
    // A former table SHARE lock would make this fail on lock_timeout before release().
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
      const contact = await tx.contact.create({ data: { companyId: f.companyId, name: "Synthetic", phone: "5511987654321" } });
      await tx.contact.update({ where: { id: contact.id }, data: { name: "Confirmed synthetic" } });
    });
  } finally { release(); }
  assert.equal((await claiming)?.id, job.id);
}, 1);

queueTest("a finite scan ceiling revisits older jobs even while new ready jobs arrive", async f => {
  const first = await cpfJob(f, null, { createdAt: new Date(f.now - 120000) });
  for (let index = 1; index < 105; index++) await cpfJob(f, null, { createdAt: new Date(f.now - 120000 + index) });
  const scanning = createOpenCreditMaterializationQueue(db);
  assert.deepEqual(await scanning.claim(1), []);
  const event = await db.openCreditInboundEvent.findUniqueOrThrow({ where: { id: first.inboundEventId } });
  await db.openCreditLeadMaterialization.update({ where: { id: first.id }, data: {
    protectedEnvelope: payload.protectMaterializationIdentity(event, { cpf: "12345678909", phone: "5511987654321", name: null, email: null }),
  } });
  for (let index = 0; index < 30; index++) await f.create({ createdAt: new Date(f.now + index) });
  assert.equal((await scanning.claim(1))[0].id, first.id);
});

queueTest("claim(10) scans at most 100 WAITING jobs while Contact writes remain unblocked", async f => {
  for (let index = 0; index < 100; index++) await cpfJob(f);
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  let pages = 0;
  let evaluations = 0;
  const observed = createOpenCreditMaterializationQueue({
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join("?").includes("LIMIT 25")) pages++;
      return db.$queryRaw(strings, ...values);
    },
    $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      db.$transaction(tx => run(new Proxy(tx, {
        get(t, property) {
          if (property === "$executeRaw") return (strings: TemplateStringsArray, ...values: unknown[]) => {
            assert.doesNotMatch(strings.join("?"), /LOCK\s+TABLE/i);
            return t.$executeRaw(strings, ...values);
          };
          if (property !== "$queryRaw") return Reflect.get(t, property);
          return async (strings: TemplateStringsArray, ...values: unknown[]) => {
            assert.doesNotMatch(strings.join("?"), /LOCK\s+TABLE/i);
            if (strings.join("?").includes('FROM "Contact"')) {
              evaluations++;
              if (evaluations === 1) { entered(); await gate; }
            }
            return t.$queryRaw(strings, ...values);
          };
        },
      })), options),
  } as never);
  const claiming = observed.claim(10);
  await reached;
  try {
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
      const contact = await tx.contact.create({ data: { companyId: f.companyId, name: "Synthetic", phone: "5511976543210" } });
      await tx.contact.update({ where: { id: contact.id }, data: { name: "Confirmed synthetic" } });
    });
  } finally { release(); }
  assert.deepEqual(await claiming, []);
  assert.equal(pages, 4);
  assert.equal(evaluations, 100);
  assert.equal(await db.openCreditLeadMaterialization.count({ where: {
    companyId: f.companyId, state: "PENDING", attempts: 0, leaseToken: null, leaseUntil: null,
    reviewCode: null, lastErrorCode: null,
  } }), 100);
}, 1);
