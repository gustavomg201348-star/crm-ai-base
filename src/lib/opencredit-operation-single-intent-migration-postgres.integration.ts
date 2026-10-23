import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_SINGLE_INTENT_MIGRATION_POSTGRES_TEST !== "1") throw Error("SINGLE_INTENT_MIGRATION_REQUIRES_DISPOSABLE_OPT_IN");
const root = new PrismaClient({ log: [] });
const migration = "20261020190000_enforce_opencredit_operation_single_identity_kind";
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
function repositoryMigrationNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()
    && existsSync(join(directory, entry.name, "migration.sql")) && statSync(join(directory, entry.name, "migration.sql")).isFile())
    .map(entry => entry.name).sort();
}
after(async () => { await root.$disconnect(); });
function deploy(url: string, schema: string) {
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], {
    env: { ...process.env, DATABASE_URL: url }, encoding: "utf8", timeout: 120000,
  });
  // Never forward raw CLI output, connection strings or Prisma error details.
  const output = result.stdout + result.stderr;
  return { status: result.status, duplicateMarker: output.includes("OPENCREDIT_OPERATION_IDENTITY_KIND_DUPLICATES_EXIST"),
    prismaCodes: Array.from(new Set(output.match(/\bP\d{4}\b/g) ?? [])),
    databaseCodes: Array.from(output.matchAll(/Database error code:\s*([0-9A-Z]{5})/g), match => match[1]),
    transactionAborted: /current transaction is aborted/i.test(output), syntaxError: /syntax error/i.test(output),
    engineError: /schema engine/i.test(output), uniqueViolation: /unique constraint/i.test(output) };
}
async function isolated(run: (db: PrismaClient, url: string) => Promise<void>) {
  const name = "qevora_op_unique_" + randomUUID().replaceAll("-", "");
  assert.match(name, /^qevora_op_unique_[0-9a-f]{32}$/);
  await root.$executeRawUnsafe('CREATE DATABASE "' + name + '"');
  const url = new URL(process.env.DATABASE_URL!); url.pathname = "/" + name;
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [] });
  try { await run(db, url.toString()); }
  finally {
    await db.$disconnect();
    // Only this generated, disposable child database is removed. Never alter root data.
    await root.$executeRawUnsafe('DROP DATABASE "' + name + '"');
  }
}
async function fixture(db: PrismaClient) {
  const company = await db.company.create({ data: { name: "Synthetic migration fixture" } });
  const user = await db.user.create({ data: { companyId: company.id, name: "Synthetic", email: randomUUID() + "@example.invalid", role: "ADMIN", passwordHash: "SYNTHETIC" } });
  const scope = "synthetic-migration-" + randomUUID();
  await db.openCreditCommercialAccess.create({ data: { companyId: company.id, providerScope: scope, changedByUserId: user.id } });
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "synthetic" } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: company.id, providerScope: scope, contactId: contact.id, normalizedCpf: "00000000000", createdByUserId: user.id } });
  return { companyId: company.id, providerScope: scope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT", createdByUserId: user.id };
}
test("legacy duplicates fail deployment with fixed marker and preserve every Operation/Event/state", () => isolated(async (db, url) => {
  const temp = mkdtempSync(join(tmpdir(), "qevora-single-intent-migration-"));
  try {
    copyFileSync("prisma/schema.postgres.prisma", join(temp, "schema.postgres.prisma"));
    cpSync("prisma/migrations", join(temp, "migrations"), { recursive: true, filter: source => !source.endsWith(migration) });
    assert.deepEqual(repositoryMigrationNames(join(temp, "migrations")), repositoryMigrationNames("prisma/migrations").filter(name => name !== migration));
    assert.equal(deploy(url, join(temp, "schema.postgres.prisma")).status, 0, "LEGACY_CHAIN_FAILED");
    const data = await fixture(db);
    for (const state of ["PREPARED", "UNKNOWN"]) {
      const op = await db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID(), state } });
      await db.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: data.companyId, providerScope: data.providerScope,
        actorUserId: data.createdByUserId, action: "PREPARED", previousState: null, nextState: state, revision: 0 } });
    }
    const snapshot = () => Promise.all([
      db.openCreditCommercialOperation.findMany({ orderBy: { id: "asc" } }),
      db.openCreditCommercialOperationEvent.findMany({ orderBy: { id: "asc" } }),
    ]);
    const before = await snapshot(); assert.equal(before[0].length, 2); assert.equal(before[1].length, 2);
    const result = deploy(url, resolve("prisma/schema.postgres.prisma"));
    assert.deepEqual(await snapshot(), before);
    assert.equal(result.status, 1); assert.equal(result.duplicateMarker, true, "MIGRATION_DIAGNOSTIC:" + JSON.stringify(result));
    const index = await db.$queryRaw<Array<{ absent: boolean }>>`SELECT to_regclass('"OCOperation_company_scope_identity_kind_key"') IS NULL AS absent`;
    assert.equal(index[0].absent, true);
  } finally { rmSync(temp, { recursive: true, force: true }); }
}));
test("clean database applies full chain and enforces identity-kind unique", () => isolated(async (db, url) => {
  assert.equal(deploy(url, resolve("prisma/schema.postgres.prisma")).status, 0, "CLEAN_CHAIN_FAILED");
  const expectedMigrationNames = repositoryMigrationNames("prisma/migrations");
  const history = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name
  `;
  assert(history.every(row => row.finished_at !== null && row.rolled_back_at === null), "CLEAN_MIGRATION_HISTORY_UNFINISHED_OR_ROLLED_BACK");
  assert.deepEqual(history.map(row => row.migration_name).sort(), expectedMigrationNames, "CLEAN_MIGRATION_NAMES_NOT_EXACT_CHECKOUT");
  const applied = await db.$queryRaw<Array<{ count: number }>>`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE migration_name=${migration} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  assert.equal(applied[0].count, 1);
  const data = await fixture(db);
  await db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID() } });
  await assert.rejects(db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID() } }), error => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
    const target = error.meta?.target;
    return target === "OCOperation_company_scope_identity_kind_key" || Array.isArray(target) && target.length === 4
      && ["companyId", "providerScope", "remoteIdentityId", "operationKind"].every(k => target.includes(k));
  });
  assert.equal(await db.openCreditCommercialOperation.count(), 1);
}));
