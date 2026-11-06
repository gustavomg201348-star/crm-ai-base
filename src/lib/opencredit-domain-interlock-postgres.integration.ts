import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
import { lockOpenCreditDomainMode, OpenCreditDomainModeUnavailableError, type OpenCreditDomainMode } from "./opencredit-domain-interlock";
import { ingestOpenCreditLead } from "./opencredit-lead.service";
import { OpenCreditInputError, parseOpenCreditAssignedLead } from "./opencredit-webhook-contract";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_DOMAIN_INTERLOCK_POSTGRES_TEST !== "1") {
  throw new Error("DOMAIN_INTERLOCK_TEST_REQUIRES_DISPOSABLE_OPT_IN");
}
const db = new PrismaClient({ log: [] });
after(() => db.$disconnect());
const migration = "20261106140000_opencredit_domain_interlock";
const legacy = { enabled: true, materializationEnabled: false };
const materialization = { enabled: false, materializationEnabled: true };
const none = { enabled: false, materializationEnabled: false };
const payload = parseOpenCreditAssignedLead({
  event: "lead.assigned", eventId: "synthetic-event", contractVersion: 2,
  assignedAt: "2026-11-06T12:00:00Z", lead: { id: "synthetic-lead" },
  client: { name: "Synthetic", phone: "11987654321" }
});

async function withIntegration(run: (binding: { id: string; companyId: string }) => Promise<void>) {
  const company = await db.company.create({ data: { name: "Synthetic interlock" } });
  const where = { companyId: company.id };
  try {
    const binding = await db.openCreditIntegration.create({
      data: { ...where, ...legacy, publicWebhookId: randomUUID(), webhookSecret: "synthetic", passiveInboundEnabled: true },
      select: { id: true, companyId: true }
    });
    await run(binding);
  } finally {
    await db.openCreditEvent.deleteMany({ where });
    await db.openCreditLead.deleteMany({ where });
    await db.contact.deleteMany({ where });
    await db.openCreditIntegration.deleteMany({ where });
    await db.company.delete({ where: { id: company.id } });
  }
}

test("CHECK permits the three valid modes and rejects simultaneous owners", () => withIntegration(async binding => {
  for (const mode of [legacy, materialization, none]) {
    const result = await db.openCreditIntegration.update({ where: binding, data: mode });
    assert.equal(result.enabled, mode.enabled);
    assert.equal(result.materializationEnabled, mode.materializationEnabled);
    assert.equal(result.passiveInboundEnabled, true);
  }
  await assert.rejects(
    () => db.$executeRaw`UPDATE "OpenCreditIntegration" SET "enabled" = true, "materializationEnabled" = true WHERE "id" = ${binding.id}`,
    (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2010" && error.meta?.code === "23514"
  );
  assert.deepEqual(await db.openCreditIntegration.findUnique({
    where: binding, select: { enabled: true, materializationEnabled: true }
  }), none);
}));

test("transaction lock is tenant-bound and only permits its exact domain mode", () => withIntegration(async binding => {
  for (const mode of [legacy, materialization, none]) {
    await db.openCreditIntegration.update({ where: binding, data: { ...mode, paused: true } });
    for (const expectedMode of ["LEGACY", "MATERIALIZATION"] as const) {
      const run = (companyId = binding.companyId) => db.$transaction(tx => lockOpenCreditDomainMode(tx, {
        companyId, integrationId: binding.id, expectedMode
      }));
      if (expectedMode === "LEGACY" ? mode.enabled : mode.materializationEnabled) {
        assert.deepEqual(await run(), { paused: true });
      } else {
        await assert.rejects(run, OpenCreditDomainModeUnavailableError);
      }
      await assert.rejects(() => run("wrong-tenant"), OpenCreditDomainModeUnavailableError);
    }
  }
}));

test("legacy ingestion rejects the new owner, then persists normal legacy Contact, Lead and Event", () => withIntegration(async binding => {
  const where = { companyId: binding.companyId };
  const counts = async () => Promise.all([
    db.contact.count({ where }), db.openCreditLead.count({ where }), db.openCreditEvent.count({ where })
  ]);
  await db.openCreditIntegration.update({ where: binding, data: materialization });
  await assert.rejects(() => ingestOpenCreditLead(db, binding, payload), (error: unknown) =>
    error instanceof OpenCreditInputError && error.code === "INTEGRATION_UNAVAILABLE" && error.status === 403);
  assert.deepEqual(await counts(), [0, 0, 0]);
  await db.openCreditIntegration.update({ where: binding, data: { ...legacy, paused: true } });
  assert.deepEqual(await ingestOpenCreditLead(db, binding, payload), { duplicate: false });
  assert.deepEqual(await ingestOpenCreditLead(db, binding, payload), { duplicate: true });
  assert.deepEqual(await counts(), [1, 1, 1]);
  assert.equal((await db.openCreditLead.findFirstOrThrow({ where })).held, true);
}));

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

for (const mode of ["LEGACY", "MATERIALIZATION"] as const satisfies readonly OpenCreditDomainMode[]) {
  test(mode + " row lock blocks the opposite mode update until commit", () => withIntegration(async binding => {
    const initial = mode === "LEGACY" ? legacy : materialization;
    const next = mode === "LEGACY" ? materialization : legacy;
    await db.openCreditIntegration.update({ where: binding, data: initial });
    const locked = signal<number>();
    const writing = signal<number>();
    const release = signal<void>();
    let finished = false;
    const holder = db.$transaction(async tx => {
      await lockOpenCreditDomainMode(tx, { companyId: binding.companyId, integrationId: binding.id, expectedMode: mode });
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      locked.resolve(backend.pid);
      await release.promise;
    }, { timeout: 15_000 });
    const writer = db.$transaction(async tx => {
      await locked.promise;
      const [backend] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      writing.resolve(backend.pid);
      await tx.openCreditIntegration.update({ where: binding, data: next });
    }, { timeout: 15_000 }).then(() => { finished = true; });
    const joined = Promise.all([holder, writer]);
    try {
      const [holderPid, writerPid] = await Promise.race([
        Promise.all([locked.promise, writing.promise]),
        joined.then(() => { throw new Error("Mode switch completed before lock observation"); })
      ]);
      const end = Date.now() + 5_000;
      for (;;) {
        const [state] = await db.$queryRaw<Array<{ blocked: boolean }>>`
          SELECT ${holderPid}::int = ANY(pg_blocking_pids(${writerPid}::int)) AS blocked
        `;
        if (state.blocked) break;
        assert(!finished && Date.now() < end, "PostgreSQL must report the lock holder blocking the update");
        await nextTurn();
      }
      assert.equal(finished, false);
    } finally {
      release.resolve();
      await joined;
    }
    assert.deepEqual(await db.openCreditIntegration.findUnique({
      where: binding, select: { enabled: true, materializationEnabled: true }
    }), next);
  }));
}

test("upgrade preserves existing legacy, passive inbox and new-mode rows without backfill", async () => {
  const name = "qevora_interlock_" + randomUUID().replaceAll("-", "");
  const directory = mkdtempSync(join(tmpdir(), "qevora-interlock-"));
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = "/" + name;
  const isolated = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  const cli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  const schema = join(directory, "schema.postgres.prisma");
  const deploy = () => {
    const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
      env: { ...process.env, DATABASE_URL: url.toString() }, encoding: "utf8", timeout: 120_000
    });
    assert.equal(result.status, 0, "DISPOSABLE_INTERLOCK_UPGRADE_FAILED");
  };
  await db.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  try {
    copyFileSync("prisma/schema.postgres.prisma", schema);
    mkdirSync(join(directory, "migrations"));
    copyFileSync("prisma/migrations/migration_lock.toml", join(directory, "migrations", "migration_lock.toml"));
    const copyMigration = (entry: string) => cpSync(join("prisma/migrations", entry), join(directory, "migrations", entry), { recursive: true });
    const names = readdirSync("prisma/migrations", { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const entry of names.filter(entry => entry < migration)) copyMigration(entry);
    deploy();
    const company = await isolated.company.create({ data: { name: "Synthetic historical interlock" } });
    const [integration] = await Promise.all([legacy, materialization, none].map(mode =>
      isolated.openCreditIntegration.create({ data: {
        ...mode, companyId: company.id, providerScope: "synthetic-scope",
        publicWebhookId: randomUUID(), webhookSecret: "synthetic-existing-cipher", passiveInboundEnabled: true
      } })));
    assert.deepEqual(await ingestOpenCreditLead(isolated, integration, payload), { duplicate: false });
    await isolated.openCreditInboundEvent.create({ data: {
      companyId: company.id, integrationId: integration.id, providerScope: "synthetic-scope",
      eventId: "historical-event", externalLeadId: "historical-lead", eventType: "lead.assigned",
      provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1
    } });
    const snapshot = () => Promise.all([
      isolated.openCreditIntegration.findMany({ orderBy: { id: "asc" } }),
      isolated.openCreditInboundEvent.findMany(),
      isolated.openCreditEvent.findMany(),
      isolated.openCreditLead.findMany(),
      isolated.contact.findMany()
    ]);
    const before = await snapshot();
    copyMigration(migration);
    deploy();
    assert.deepEqual(await snapshot(), before);
    assert.equal(await isolated.openCreditLeadMaterialization.count(), 0);
    const [history] = await isolated.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;
    assert.equal(history.count, names.filter(entry => entry <= migration).length);
  } finally {
    await isolated.$disconnect();
    await db.$executeRawUnsafe('DROP DATABASE "' + name + '"');
    rmSync(directory, { recursive: true, force: true });
  }
});
