import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, before, test } from "node:test";
import { PrismaClient, type Prisma } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import { createOpenCreditMaterializationQueue, materializationRetryDelayMs } from "./opencredit-materialization-queue.service";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_MATERIALIZATION_QUEUE_POSTGRES_TEST !== "1") throw new Error("QUEUE_TEST_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
const queue = createOpenCreditMaterializationQueue(db, () => 0.5);
const originalFetch = globalThis.fetch;
let externalRequests = 0;
before(() => {
  globalThis.fetch = async () => { externalRequests++; throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
});
after(async () => {
  globalThis.fetch = originalFetch;
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
  async function create(overrides: Partial<Prisma.OpenCreditLeadMaterializationUncheckedCreateInput> = {}) {
    const externalLeadId = "lead-" + randomUUID();
    const binding = { companyId, providerScope, integrationId: integration.id, externalLeadId };
    const event = await db.openCreditInboundEvent.create({
      data: { ...binding, eventId: externalLeadId + ":partner", eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1 },
    });
    return db.openCreditLeadMaterialization.create({ data: {
      ...binding, inboundEventId: event.id, state: "PENDING", protectedEnvelope: "synthetic-opaque-envelope",
      createdAt: new Date(now - 60_000), expiresAt: new Date(now + 600_000), ...overrides,
    } });
  }
  const get = (id: string) => db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id } });
  const disable = () => db.openCreditIntegration.update({ where: { id: integration.id }, data: { materializationEnabled: false } });
  const ageLease = (id: string, expires = false) => db.openCreditLeadMaterialization.update({
    where: { id }, data: { leaseUntil: new Date(now - 2000), ...(expires ? { expiresAt: new Date(now - 1000) } : {}) },
  });
  return { companyId, now, create, get, disable, ageLease };
}

function queueTest(name: string, run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>) {
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
      ]), [0, 0, 0, 0, 0]);
    } finally {
      await db.openCreditLeadMaterialization.deleteMany({ where: { companyId } });
      await db.openCreditInboundEvent.deleteMany({ where: { companyId } });
      await db.openCreditIntegration.deleteMany({ where: { companyId } });
      await db.company.delete({ where: { id: companyId } });
    }
  });
}

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
  const row = await f.create();
  const [first] = await queue.claim();
  const wrong = { ...first, leaseToken: "wrong-token" };
  assert.equal(await queue.complete(wrong), null);
  assert.equal(await queue.retry(wrong, "TRANSIENT_FAILURE"), null);
  assert.equal(await queue.review(wrong, "ENVELOPE_INVALID"), null);
  assert.throws(() => queue.retry(first, "unsafe" as never), /INVALID_MATERIALIZATION_RETRY_CODE/);
  assert.throws(() => queue.review(first, "unsafe" as never), /INVALID_MATERIALIZATION_REVIEW_CODE/);

  await f.ageLease(row.id);
  assert.equal(await queue.complete(first), null);
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
  assert.equal(await queue.complete(first), null);
  assert.equal(await queue.retry(first, "TRANSIENT_FAILURE"), null);
  assert.equal(await queue.review(first, "ENVELOPE_INVALID"), null);
  assert.deepEqual(await queue.complete(second), { id: row.id, state: "COMPLETED" });
  assert.equal((await f.get(row.id)).protectedEnvelope, null);
  assert.equal(await queue.complete(second), null);
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
    const after = await isolated.openCreditLeadMaterialization.findMany({ orderBy: { id: "asc" } });
    assert.deepEqual(after, before.map(row => ({ ...row, availableAt: null, attempts: 0, leaseToken: null, leaseUntil: null, lastErrorCode: null })));
    assert.equal(await isolated.openCreditLeadMaterialization.count({ where: { companyId: emptyCompany.id } }), 0);
    assert.deepEqual(await createOpenCreditMaterializationQueue(isolated).claim(), []);
  } finally {
    await isolated.$disconnect();
    await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    rmSync(temp, { recursive: true, force: true });
  }
});
