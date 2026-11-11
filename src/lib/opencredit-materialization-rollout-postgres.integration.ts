import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module, { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import type { MaterializationLease } from "./opencredit-materialization-queue.service";
import type { SessionUser } from "./auth";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_ROLLOUT_BUDGET_POSTGRES_TEST !== "1") throw Error("ROLLOUT_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let core: typeof import("./opencredit-domain-materializer");
let createOpenCreditMaterializationQueue: typeof import("./opencredit-materialization-queue.service")["createOpenCreditMaterializationQueue"];
let admin: typeof import("./opencredit-materialization-rollout-admin.service");
let crypto: typeof import("./opencredit-lead-materialization-payload");
let preflight: typeof import("./opencredit-materialization-preflight.service");
const keyVariable = "QEVORA_DATA_ENCRYPTION_KEY_V1";
const oldKey = process.env[keyVariable], oldCompany = process.env.PLATFORM_COMPANY_ID, oldEmails = process.env.PLATFORM_ADMIN_EMAILS;
const oldFetch = globalThis.fetch; let fetches = 0;
before(() => {
  process.env[keyVariable] = Buffer.alloc(32, 31).toString("base64");
  delete process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_ADMIN_EMAILS = "rollout-admin@example.invalid";
  globalThis.fetch = async () => { fetches++; throw Error("PROVIDER_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (name, ...args) => name === "server-only" ? {} : name === "@/lib/db" ? { prisma: db } : original.call(loader, name, ...args);
  try {
    const require = createRequire(import.meta.url);
    core = require("./opencredit-domain-materializer");
    ({ createOpenCreditMaterializationQueue } = require("./opencredit-materialization-queue.service"));
    crypto = require("./opencredit-lead-materialization-payload");
    admin = require("./opencredit-materialization-rollout-admin.service");
    preflight = require("./opencredit-materialization-preflight.service");
  } finally { loader._load = original; }
});
after(async () => {
  for (const [key, value] of [[keyVariable, oldKey], ["PLATFORM_COMPANY_ID", oldCompany], ["PLATFORM_ADMIN_EMAILS", oldEmails]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
  globalThis.fetch = oldFetch; await db.$disconnect(); assert.equal(fetches, 0);
});
const identity = { cpf: null, phone: "5511987654321", name: null, email: null };
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic rollout" } });
  const providerScope = "synthetic-rollout";
  const integration = await db.openCreditIntegration.create({ data: {
    companyId: company.id, providerScope, publicWebhookId: randomUUID(), webhookSecret: "synthetic",
    passiveInboundEnabled: true, materializationEnabled: true,
  } });
  const user = await db.user.create({ data: { companyId: company.id, email: randomUUID() + "@example.invalid",
    name: "Synthetic", role: "ADMIN", passwordHash: "synthetic" } });
  const whatsappChannel = await db.channel.create({ data: {
    companyId: company.id, name: "Rollout AutoStart channel", type: "whatsapp", provider: "meta", status: "ACTIVE",
  } });
  await db.openCreditWhatsappConfig.create({ data: {
    integrationId: integration.id, companyId: company.id, providerScope,
    configuredByUserId: user.id, autoStartEnabled: true,
    defaultWhatsappChannelId: whatsappChannel.id,
    initialTemplateName: "synthetic_template", initialTemplateLanguage: "pt_BR",
    updatedAt: new Date(Date.now() - 60_000),
  } });
  // Match the configured platform identity without colliding across fixtures.
  const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = company.id;
  const actor: SessionUser = { ...user, role: "ADMIN" };
  const binding = { companyId: company.id, integrationId: integration.id, providerScope };
  let serial = 0;
  return {
    binding, integration, actor,
    queue: (rolloutId?: string, client = db as Pick<PrismaClient, "$queryRaw" | "$transaction">) => createOpenCreditMaterializationQueue(client, () => 0.5, rolloutId),
    async budget(maxAdmitted = 3) {
      return db.openCreditMaterializationRolloutBudget.create({ data: {
        ...binding, maxAdmitted, expiresAt: new Date(Date.now() + 600000),
      } });
    },
    async job(details?: Parameters<typeof crypto.protectMaterializationIdentity>[1]) {
      const externalLeadId = randomUUID(), eventId = randomUUID();
      const event = await db.openCreditInboundEvent.create({ data: {
        ...binding, externalLeadId, eventId, eventType: "lead.assigned",
        provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
      } });
      const info = details ?? { ...identity, phone: "551199000" + String(serial++).padStart(4, "0") };
      return db.openCreditLeadMaterialization.create({ data: {
        ...binding, externalLeadId, inboundEventId: event.id, state: "PENDING",
        expiresAt: new Date(Date.now() + 600000),
        protectedEnvelope: crypto.protectMaterializationIdentity({ ...binding, externalLeadId, eventId }, info),
      } });
    },
    process: (lease: MaterializationLease) => core.createOpenCreditDomainMaterializer(db).process(lease),
    get: (id: string) => db.openCreditLeadMaterialization.findUniqueOrThrow({ where: { id } }),
    async ledger(id: string) {
      const b = await db.openCreditMaterializationRolloutBudget.findUniqueOrThrow({ where: { id } });
      const a = await db.openCreditMaterializationRolloutAdmission.findMany({ where: { rolloutId: id } });
      assert.equal(b.admittedCount, a.length); assert(b.admittedCount <= b.maxAdmitted);
      return { budget: b, admissions: a };
    },
    async command(command: import("./opencredit-materialization-rollout-admin.service").RolloutAdminCommand) {
      return admin.executeRolloutAdminCommand(db, { actor, providerScope, command });
    },
    async cleanup() {
      const where = { companyId: company.id };
      await db.openCreditMaterializationRolloutAdmission.deleteMany({ where });
      await db.openCreditMaterializationRolloutBudget.deleteMany({ where });
      await db.openCreditLeadMaterialization.deleteMany({ where });
      await db.openCreditInboundEvent.deleteMany({ where });
      await db.openCreditWhatsappConfig.deleteMany({ where });
      await db.conversation.deleteMany({ where: { contact: where } });
      await db.channel.deleteMany({ where }); await db.contact.deleteMany({ where });
      await db.openCreditIntegration.deleteMany({ where }); await db.user.deleteMany({ where });
      await db.company.delete({ where: { id: company.id } });
      if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old;
    },
  };
}
type F = Awaited<ReturnType<typeof fixture>>;
function pg(name: string, work: (f: F) => Promise<void>) {
  test(name, async () => { const f = await fixture(); try { await work(f); } finally { await f.cleanup(); } });
}
pg("cap3, restart and two instances never produce fourth lease; CLOSED permits all admitted completions", async f => {
  const b = await f.budget(); for (let i = 0; i < 8; i++) await f.job();
  const first = await f.queue(b.id).claim(1); assert.equal(first.length, 1);
  const concurrent = await Promise.all([f.queue(b.id).claim(10), f.queue(b.id).claim(10)]);
  const leases = [...first, ...concurrent.flat()];
  assert.equal(leases.length, 3); assert.equal(new Set(leases.map(l => l.id)).size, 3);
  const state = await f.ledger(b.id); assert.equal(state.budget.state, "CLOSED");
  assert.deepEqual(await f.queue(b.id).claim(10), []);
  for (const lease of leases) assert.equal((await f.process(lease))?.state, "COMPLETED");
  assert.equal(await db.contact.count({ where: { companyId: f.binding.companyId } }), 3);
  assert.equal(await db.conversation.count({ where: { contact: { companyId: f.binding.companyId } } }), 3);
  assert.equal(await db.message.count({ where: { conversation: { contact: { companyId: f.binding.companyId } } } }), 0);
  await f.ledger(b.id);
});
pg("last slot is exclusive under contention", async f => {
  const b = await f.budget(); for (let i = 0; i < 5; i++) await f.job();
  assert.equal((await f.queue(b.id).claim(2)).length, 2);
  const rows = (await Promise.all([f.queue(b.id).claim(1), f.queue(b.id).claim(1)])).flat();
  assert.equal(rows.length, 1); assert.equal((await f.ledger(b.id)).budget.admittedCount, 3);
});
pg("WAITING and REVIEW consume nothing, preserve job timestamps/attempts/leases", async f => {
  const b = await f.budget();
  const waiting = await f.job({ ...identity, cpf: "12345678909", phone: null });
  const review = await f.job();
  await db.openCreditLeadMaterialization.update({ where: { id: review.id }, data: { protectedEnvelope: "invalid" } });
  const before = await db.openCreditLeadMaterialization.findMany({ where: f.binding, orderBy: { id: "asc" } });
  assert.deepEqual(await f.queue(b.id).claim(3), []);
  assert.deepEqual(await db.openCreditLeadMaterialization.findMany({ where: f.binding, orderBy: { id: "asc" } }), before);
  assert.equal((await f.ledger(b.id)).budget.admittedCount, 0); assert.equal((await f.get(waiting.id)).state, "PENDING");
});
for (const status of ["missing", "closed", "expired", "inconsistent"] as const) pg(status + " budget returns zero, no fallback", async f => {
  const job = await f.job(); const b = await f.budget();
  if (status === "closed") await db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { state: "CLOSED", closedAt: new Date() } });
  if (status === "expired") await db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { createdAt: new Date(Date.now() - 10000), expiresAt: new Date(Date.now() - 1000) } });
  if (status === "inconsistent") await db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { admittedCount: 1 } });
  assert.deepEqual(await f.queue(status === "missing" ? "missing" : b.id).claim(), []);
  assert.equal((await f.get(job.id)).attempts, 0);
});
for (const point of ["lease", "admission", "counter", "serialization"] as const) pg("atomic rollback at " + point, async f => {
  const b = await f.budget(); const job = await f.job();
  const client = {
    $queryRaw: db.$queryRaw.bind(db),
    $transaction: (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, options?: object) => db.$transaction(tx => fn(new Proxy(tx, {
      get(target, property) {
        if (property === "openCreditMaterializationRolloutAdmission" && point === "admission") return { create: async (args: Parameters<typeof tx.openCreditMaterializationRolloutAdmission.create>[0]) => {
          await target.openCreditMaterializationRolloutAdmission.create(args); throw Error("SYNTHETIC_ROLLBACK");
        } };
        if (property === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const result = await target.$queryRaw(strings, ...values);
          const text = strings.join("?");
          if ((point === "lease" || point === "serialization") && text.includes('UPDATE "OpenCreditLeadMaterialization"') || point === "counter" && text.includes('UPDATE "OpenCreditMaterializationRolloutBudget"')) {
            if (point === "serialization") throw new Prisma.PrismaClientKnownRequestError("synthetic", { code: "P2034", clientVersion: "test" });
            throw Error("SYNTHETIC_ROLLBACK");
          }
          return result;
        };
        return Reflect.get(target, property);
      },
    })), options),
  } as unknown as Pick<PrismaClient, "$queryRaw" | "$transaction">;
  if (point === "serialization") assert.deepEqual(await f.queue(b.id, client).claim(1), []);
  else await assert.rejects(f.queue(b.id, client).claim(1));
  assert.equal((await f.get(job.id)).attempts, 0);
  assert.equal((await f.ledger(b.id)).budget.admittedCount, 0);
  assert.equal((await f.queue(b.id).claim(1)).length, 1); assert.equal((await f.ledger(b.id)).budget.admittedCount, 1);
});
pg("ambiguous commit is not retried; crash leaves one admission consumed", async f => {
  const b = await f.budget(); const job = await f.job(); let transactions = 0;
  const client = { $queryRaw: db.$queryRaw.bind(db),
    $transaction: async (...args: Parameters<typeof db.$transaction>) => { transactions++; await (db.$transaction as (...a: unknown[]) => Promise<unknown>)(...args); throw Error("COMMIT_RESPONSE_LOST"); },
  } as unknown as Pick<PrismaClient, "$queryRaw" | "$transaction">;
  await assert.rejects(f.queue(b.id, client).claim(1)); assert.equal(transactions, 1);
  assert.equal((await f.get(job.id)).state, "PROCESSING");
  assert.equal((await f.ledger(b.id)).budget.admittedCount, 1);
  assert.deepEqual(await f.queue(b.id).claim(), []);
});
for (const outcome of ["RETRY", "NEEDS_REVIEW", "EXPIRED", "COMPLETED", "STALE"] as const) pg(outcome + " never returns budget or permits automatic readmission", async f => {
  const b = await f.budget(); const job = await f.job(); const [lease] = await f.queue(b.id).claim(1); assert(lease);
  if (outcome === "RETRY") await f.queue().retry(lease, "TRANSIENT_FAILURE");
  if (outcome === "NEEDS_REVIEW") await f.queue().review(lease, "IDENTITY_INSUFFICIENT");
  if (outcome === "COMPLETED") await f.process(lease);
  if (outcome === "STALE" || outcome === "EXPIRED") {
    await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: {
      leaseUntil: new Date(0), ...(outcome === "EXPIRED" ? { expiresAt: new Date(0) } : {}),
    } });
    await f.queue().recover();
  }
  if (outcome === "RETRY" || outcome === "STALE") await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
  assert.equal((await f.ledger(b.id)).budget.admittedCount, 1);
  assert.deepEqual(await f.queue(b.id).claim(), []);
  assert.deepEqual(await f.queue().claim(), []);
  assert.equal(await f.queue().claimPilotJob({ id: job.id, ...f.binding }), null);
  assert.equal((await f.get(job.id)).attempts, 1);
});
pg("reservation blocks NORMAL/PILOT and conflicting rollout, including after close", async f => {
  const job = await f.job(); const b = await f.budget();
  await assert.rejects(f.budget(), { code: "P2002" });
  for (const close of [false, true]) {
    if (close) await db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { state: "CLOSED", closedAt: new Date() } });
    assert.deepEqual(await f.queue().claim(), []);
    assert.equal(await f.queue().claimPilotJob({ ...f.binding, id: job.id }), null);
  }
});
pg("tenant/binding FK and scope isolation; no lease for a foreign budget", async f => {
  const other = await fixture();
  try {
    const job = await f.job(); const b = await other.budget();
    assert.deepEqual(await other.queue(b.id).claim(), []);
    await assert.rejects(db.openCreditMaterializationRolloutBudget.create({ data: { ...f.binding, integrationId: other.integration.id, maxAdmitted: 3, expiresAt: new Date(Date.now() + 60000) } }), { code: "P2003" });
    const wrong = await db.openCreditIntegration.create({ data: { companyId: f.binding.companyId, providerScope: "synthetic-other", publicWebhookId: randomUUID(), webhookSecret: "synthetic", materializationEnabled: true } });
    const sb = await db.openCreditMaterializationRolloutBudget.create({ data: { companyId: f.binding.companyId, integrationId: wrong.id, providerScope: wrong.providerScope!, maxAdmitted: 1, expiresAt: new Date(Date.now() + 60000) } });
    assert.deepEqual(await f.queue(sb.id).claim(), []); assert.equal((await f.get(job.id)).attempts, 0);
  } finally { await other.cleanup(); }
});
pg("admin reconciliation/release required, no permanent global jobId uniqueness", async f => {
  const job = await f.job(); const b = await f.budget(1);
  const [lease] = await f.queue(b.id).claim(); await f.queue().retry(lease, "TRANSIENT_FAILURE");
  await assert.rejects(f.command({ action: "RELEASE", ...f.binding, rolloutId: b.id, expectedAdmittedCount: 1 } as never));
  const command = { action: "RELEASE" as const, companyId: f.binding.companyId, integrationId: f.binding.integrationId, rolloutId: b.id, confirmReconciled: true as const, expectedAdmittedCount: 1 };
  await f.command(command);
  assert((await f.ledger(b.id)).budget.releasedAt);
  await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
  const b2 = await f.budget(1); const second = await f.queue(b2.id).claim(1);
  assert.equal(second.length, 1); assert.equal(second[0].id, job.id);
  assert.equal((await f.ledger(b.id)).admissions.length, 1); assert.equal((await f.ledger(b2.id)).admissions.length, 1);
  assert.equal((await f.get(job.id)).attempts, 2);
});
pg("admin refuses release with active lease and rejects non-platform actor", async f => {
  const b = await f.budget(1); await f.job(); await f.queue(b.id).claim();
  const cmd = { action: "RELEASE" as const, companyId: f.binding.companyId, integrationId: f.binding.integrationId, rolloutId: b.id, confirmReconciled: true as const, expectedAdmittedCount: 1 };
  await assert.rejects(f.command(cmd), e => e instanceof admin.RolloutAdminError && e.code === "CONFLICT");
  await assert.rejects(admin.executeRolloutAdminCommand(db, { actor: { ...f.actor, role: "AGENT" }, providerScope: f.binding.providerScope, command: cmd }),
    e => e instanceof admin.RolloutAdminError && e.code === "NOT_AUTHORIZED");
});
pg("lease generation and token/admission binding are revalidated before domain writes", async f => {
  const b = await f.budget(1); const job = await f.job(); const [lease] = await f.queue(b.id).claim();
  assert.equal(await f.process({ ...lease, rolloutId: "wrong" }), null);
  assert.equal(await f.process({ ...lease, admissionAttempt: 9 }), null);
  assert.equal(await f.process({ ...lease, rolloutId: undefined }), null);
  assert.equal(await db.contact.count({ where: { companyId: f.binding.companyId } }), 0);
  assert.equal((await f.get(job.id)).state, "PROCESSING");
  assert.equal((await f.process(lease))?.state, "COMPLETED");
});
pg("preflight exposes budget/ledger summary without job IDs, token hashes or identity", async f => {
  const b = await f.budget(1); await f.job(); await f.queue(b.id).claim();
  const r = await preflight.getOpenCreditMaterializationPreflight(db, { actor: f.actor, companyId: f.binding.companyId, providerScope: f.binding.providerScope as never });
  const info = r.integrations[0].rollouts;
  assert.equal(info.bindingReserved, true); assert.equal(info.items[0].admittedCount, 1);
  assert.equal(info.items[0].admissionCount, 1); assert.equal(info.items[0].remaining, 0);
  assert.equal(info.items[0].ledgerConsistent, true); assert.equal(info.items[0].state, "CLOSED");
  assert(!JSON.stringify(info).includes("leaseToken")); assert(!JSON.stringify(info).includes("jobId"));
});

pg("administrative CREATE/CLOSE are scoped, authenticated and do not reset a counter", async f => {
  const command = { action: "CREATE" as const, companyId: f.binding.companyId, integrationId: f.binding.integrationId,
    maxAdmitted: 2, expiresAt: new Date(Date.now() + 600000).toISOString() };
  const made = await f.command(command);
  assert.equal(made.maxAdmitted, 2);
  await f.job(); await f.queue(made.rolloutId).claim(1);
  await db.openCreditIntegration.update({ where: { id: f.binding.integrationId }, data: { paused: true } });
  await f.command({ action: "CLOSE", companyId: f.binding.companyId, integrationId: f.binding.integrationId, rolloutId: made.rolloutId });
  assert.equal((await f.ledger(made.rolloutId)).budget.admittedCount, 1);
  assert.deepEqual(await f.queue(made.rolloutId).claim(), []);
  await assert.rejects(f.command(command));
});
pg("unreconciled admission blocks another rollout even if a privileged fixture releases only the budget", async f => {
  const b = await f.budget(1); const job = await f.job(); const [lease] = await f.queue(b.id).claim();
  await f.queue().retry(lease, "TRANSIENT_FAILURE");
  await db.openCreditLeadMaterialization.update({ where: { id: job.id }, data: { availableAt: new Date(0) } });
  await db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { releasedAt: new Date() } });
  assert.deepEqual(await f.queue().claim(), []);
  assert.equal(await f.queue().claimPilotJob({ ...f.binding, id: job.id }), null);
  const next = await f.budget(); assert.deepEqual(await f.queue(next.id).claim(), []);
  assert.equal((await f.get(job.id)).attempts, 1);
});
pg("database rejects invalid max/counter, duplicate slot/job and cross-binding admission", async f => {
  for (const maxAdmitted of [0, 4]) await assert.rejects(f.budget(maxAdmitted));
  const b = await f.budget(); await f.job(); const [lease] = await f.queue(b.id).claim();
  await assert.rejects(db.openCreditMaterializationRolloutBudget.update({ where: { id: b.id }, data: { admittedCount: 4 } }));
  const a = (await f.ledger(b.id)).admissions[0];
  await assert.rejects(db.openCreditMaterializationRolloutAdmission.create({ data: { ...a, slot: 2 } }), { code: "P2002" });
  await assert.rejects(db.openCreditMaterializationRolloutAdmission.create({ data: { ...a, slot: 2, jobId: randomUUID() } }), { code: "P2003" });
  assert.equal((await f.get(lease.id)).attempts, 1);
});
pg("controlled cursor remains bounded and advances past 100 WAITING without modifying them", async f => {
  const b = await f.budget(1);
  const waiting = [];
  for (let i = 0; i < 110; i++) waiting.push(await f.job({ ...identity, cpf: "12345678909", phone: null }));
  const ready = await f.job();
  const q = f.queue(b.id);
  assert.deepEqual(await q.claim(1), []); assert.equal((await f.ledger(b.id)).budget.admittedCount, 0);
  const second = await q.claim(1); assert.equal(second.length, 1); assert.equal(second[0].id, ready.id);
  const after = await db.openCreditLeadMaterialization.findMany({ where: { id: { in: waiting.map(j => j.id) } }, orderBy: { id: "asc" } });
  assert.deepEqual(after, waiting.sort((a, c) => a.id.localeCompare(c.id)));
});
test("additive upgrade of the 32-migration production fixture preserves all existing rows and starts empty", async () => {
  const migration = "20261108120000_opencredit_durable_rollout_budget";
  const name = "qevora_rollout_upgrade_" + randomUUID().replaceAll("-", "");
  const url = new URL(process.env.DATABASE_URL!); url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const directory = mkdtempSync(join(tmpdir(), "oc-rollout-upgrade-"));
  const schema = join(directory, "schema.postgres.prisma");
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const deploy = () => {
    const r = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120000, windowsHide: true,
    });
    assert.equal(r.status, 0, "DISPOSABLE_UPGRADE_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", schema); mkdirSync(join(directory, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(directory, "migrations", "migration_lock.toml"));
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter(x => x.isDirectory() && x.name < migration).map(x => x.name);
    assert.equal(names.length, 32);
    for (const n of names) cpSync(join("prisma/migrations", n), join(directory, "migrations", n), { recursive: true });
    deploy();
    const company = await isolated.company.create({ data: { name: "Synthetic upgrade" } });
    const integration = await isolated.openCreditIntegration.create({ data: { companyId: company.id, providerScope: "synthetic-upgrade",
      publicWebhookId: randomUUID(), webhookSecret: "synthetic", passiveInboundEnabled: true, materializationEnabled: true } });
    const event = await isolated.openCreditInboundEvent.create({ data: {
      companyId: company.id, integrationId: integration.id, providerScope: integration.providerScope!, externalLeadId: "synthetic-lead",
      eventId: "synthetic-event", eventType: "lead.assigned", provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
    } });
    await isolated.openCreditLeadMaterialization.create({ data: {
      companyId: company.id, integrationId: integration.id, providerScope: integration.providerScope!, externalLeadId: event.externalLeadId,
      inboundEventId: event.id, state: "PENDING", protectedEnvelope: "synthetic-opaque", expiresAt: new Date(Date.now() + 600000),
    } });
    const snapshot = () => Promise.all([isolated.openCreditIntegration.findMany(), isolated.openCreditInboundEvent.findMany(),
      isolated.openCreditLeadMaterialization.findMany(), isolated.contact.count(), isolated.channel.count(), isolated.conversation.count(), isolated.message.count()]);
    const before = await snapshot();
    cpSync(join("prisma/migrations", migration), join(directory, "migrations", migration), { recursive: true }); deploy();
    assert.deepEqual(await snapshot(), before);
    assert.equal(await isolated.openCreditMaterializationRolloutBudget.count(), 0);
    assert.equal(await isolated.openCreditMaterializationRolloutAdmission.count(), 0);
  } finally {
    await isolated.$disconnect(); await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    assert(directory.startsWith(resolve(tmpdir()) + sep + "oc-rollout-upgrade-")); rmSync(directory, { recursive: true, force: true });
  }
});
