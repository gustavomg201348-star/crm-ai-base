import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

assertOpenCreditCommercialOperationTestDatabase(process.env);
if (process.env.OPENCREDIT_SINGLE_INTENT_MIGRATION_POSTGRES_TEST !== "1") throw Error("SINGLE_INTENT_MIGRATION_REQUIRES_DISPOSABLE_OPT_IN");
const root = new PrismaClient({ log: [] });
const migration = "20261020190000_enforce_opencredit_operation_single_identity_kind";
const correctionCutoff = "20261028120000_add_opencredit_correction_authorization";
const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
function repositoryMigrationNames(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()
    && existsSync(join(directory, entry.name, "migration.sql")) && statSync(join(directory, entry.name, "migration.sql")).isFile())
    .map(entry => entry.name).sort();
}
/** An actual historical prefix, never a full modern chain with a missing middle. */
function historicalCheckout(cutoff: string) {
  const temp = mkdtempSync(join(tmpdir(), "qevora-single-intent-migration-"));
  const names = repositoryMigrationNames("prisma/migrations").filter(name => name < cutoff);
  assert(repositoryMigrationNames("prisma/migrations").includes(cutoff), "UNKNOWN_HISTORICAL_CUTOFF");
  copyFileSync("prisma/schema.postgres.prisma", join(temp, "schema.postgres.prisma"));
  mkdirSync(join(temp, "migrations"));
  copyFileSync("prisma/migrations/migration_lock.toml", join(temp, "migrations/migration_lock.toml"));
  for (const name of names) cpSync(join("prisma/migrations", name), join(temp, "migrations", name), { recursive: true });
  assert.deepEqual(repositoryMigrationNames(join(temp, "migrations")), names);
  return { temp, names, schema: join(temp, "schema.postgres.prisma") };
}
function removeCheckout(temp: string) {
  const absolute = resolve(temp), parent = resolve(tmpdir()) + sep;
  assert(absolute.startsWith(parent) && absolute.slice(parent.length).startsWith("qevora-single-intent-migration-"), "UNSAFE_TEMP_PATH");
  rmSync(absolute, { recursive: true, force: true });
}
async function history(db: PrismaClient) {
  return db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name
  `;
}
// SELECT * deliberately snapshots the real historical table, not fields added later.
const snapshot = (db: PrismaClient) => Promise.all([
  db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "OpenCreditCommercialOperation" ORDER BY "id"`,
  db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "OpenCreditCommercialOperationEvent" ORDER BY "id"`,
]);
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
  const company = await db.company.create({ data: { name: "Synthetic migration fixture" }, select: { id: true } });
  const user = await db.user.create({ data: { companyId: company.id, name: "Synthetic", email: randomUUID() + "@example.invalid", role: "ADMIN", passwordHash: "SYNTHETIC" }, select: { id: true } });
  const scope = "synthetic-migration-" + randomUUID();
  await db.openCreditCommercialAccess.create({ data: { companyId: company.id, providerScope: scope, changedByUserId: user.id }, select: { id: true } });
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "synthetic" }, select: { id: true } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: company.id, providerScope: scope, contactId: contact.id, normalizedCpf: "00000000000", createdByUserId: user.id }, select: { id: true } });
  return { companyId: company.id, providerScope: scope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT", createdByUserId: user.id };
}
test("legacy duplicates fail deployment with fixed marker and preserve every Operation/Event/state", () => isolated(async (db, url) => {
  const checkout = historicalCheckout(migration);
  try {
    assert.equal(deploy(url, checkout.schema).status, 0, "LEGACY_CHAIN_FAILED");
    const initialHistory = await history(db);
    assert.deepEqual(initialHistory.map(row => row.migration_name), checkout.names);
    assert(initialHistory.every(row => row.finished_at !== null && row.rolled_back_at === null));
    const data = await fixture(db);
    for (const state of ["PREPARED", "UNKNOWN"]) {
      const op = await db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID(), state }, select: { id: true } });
      await db.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: data.companyId, providerScope: data.providerScope,
        actorUserId: data.createdByUserId, action: "PREPARED", previousState: null, nextState: state, revision: 0 }, select: { id: true } });
    }
    const before = await snapshot(db); assert.equal(before[0].length, 2); assert.equal(before[1].length, 2);
    assert.deepEqual(before[0].map(row => row.state).sort(), ["PREPARED", "UNKNOWN"]);
    const duplicates = await db.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count FROM (
        SELECT 1 FROM "OpenCreditCommercialOperation"
        GROUP BY "companyId", "providerScope", "remoteIdentityId", "operationKind" HAVING COUNT(*) > 1
      ) AS duplicate_groups
    `;
    assert.equal(duplicates[0].count, 1, "LEGACY_DUPLICATES_NOT_CREATED");
    const result = deploy(url, resolve("prisma/schema.postgres.prisma"));
    assert.deepEqual(await snapshot(db), before);
    assert.equal(result.status, 1); assert.equal(result.duplicateMarker, true, "MIGRATION_DIAGNOSTIC:" + JSON.stringify(result));
    const finalHistory = await history(db);
    assert.deepEqual(finalHistory.filter(row => row.finished_at !== null).map(row => row.migration_name), checkout.names);
    assert.deepEqual(finalHistory.filter(row => row.migration_name >= migration).map(row => [row.migration_name, row.finished_at, row.rolled_back_at]), [[migration, null, null]], "LATER_MIGRATION_RAN_BEFORE_EXPECTED_FAILURE");
    const index = await db.$queryRaw<Array<{ absent: boolean }>>`SELECT to_regclass('"OCOperation_company_scope_identity_kind_key"') IS NULL AS absent`;
    assert.equal(index[0].absent, true);
  } finally { removeCheckout(checkout.temp); }
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

test("valid post-single-intent upgrade preserves UPSERT and scopes correction partial uniques", () => isolated(async (db, url) => {
  const checkout = historicalCheckout(correctionCutoff);
  try {
    assert(checkout.names.includes(migration), "UPGRADE_REQUIRES_SINGLE_INTENT_MIGRATION");
    assert.equal(deploy(url, checkout.schema).status, 0, "PRE_CORRECTION_CHAIN_FAILED");
    assert.deepEqual((await history(db)).map(row => row.migration_name), checkout.names);
    const data = await fixture(db);
    const op = await db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID(), state: "SUCCEEDED", revision: 2 } });
    await db.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: data.companyId, providerScope: data.providerScope,
      actorUserId: data.createdByUserId, action: "MARKED_SUCCEEDED_CREATED", previousState: "IN_FLIGHT", nextState: "SUCCEEDED", revision: 2 } });
    const before = await snapshot(db);
    assert.equal(deploy(url, resolve("prisma/schema.postgres.prisma")).status, 0, "CORRECTION_UPGRADE_FAILED");
    assert.deepEqual(await snapshot(db), before, "UPGRADE_CHANGED_HISTORICAL_OPERATION_OR_EVENT");
    const applied = await history(db);
    assert(applied.every(row => row.finished_at !== null && row.rolled_back_at === null));
    assert.deepEqual(applied.map(row => row.migration_name), repositoryMigrationNames("prisma/migrations"));

    // Even a terminal UPSERT forbids another intention after the correction upgrade.
    await assert.rejects(db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID() } }), error => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
      const target = error.meta?.target;
      return target === "OCOperation_company_scope_identity_kind_key" || Array.isArray(target) && target.length === 4
        && ["companyId", "providerScope", "remoteIdentityId", "operationKind"].every(k => target.includes(k));
    });
    // Synthetic storage rows only: runtime GRANTED binding is exercised by the correction service matrix.
    const correction = { ...data, operationKind: "CLIENT_PROFILE_CORRECTION", state: "SUCCEEDED", revision: 2 };
    const intents = ["correction-fixture-grant-" + randomUUID(), "correction-fixture-grant-" + randomUUID()];
    for (const intentKey of intents) await db.openCreditCommercialOperation.create({ data: { ...correction, intentKey } });
    const rows = await db.openCreditCommercialOperation.findMany({ where: { companyId: data.companyId, providerScope: data.providerScope, remoteIdentityId: data.remoteIdentityId } });
    assert.equal(rows.filter(row => row.operationKind === "CLIENT_PROFILE_UPSERT").length, 1);
    assert.deepEqual(rows.filter(row => row.operationKind === "CLIENT_PROFILE_CORRECTION").map(row => row.intentKey).sort(), [...intents].sort());
    await assert.rejects(db.openCreditCommercialOperation.create({ data: { ...correction, intentKey: intents[0] } }), error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    for (const state of ["IN_FLIGHT", "UNKNOWN"]) {
      const unresolved = { ...await fixture(db), operationKind: "CLIENT_PROFILE_CORRECTION", state, revision: state === "UNKNOWN" ? 2 : 1 };
      await db.openCreditCommercialOperation.create({ data: { ...unresolved, intentKey: randomUUID() } });
      await assert.rejects(db.openCreditCommercialOperation.create({ data: { ...unresolved, intentKey: randomUUID(), state: "IN_FLIGHT" } }),
        error => error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002");
    }
    const indexes = await db.$queryRaw<Array<{ name: string; valid: boolean; unique: boolean; predicate: string | null }>>`
      SELECT c.relname AS name, i.indisvalid AS valid, i.indisunique AS "unique", pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public' AND t.relname = 'OpenCreditCommercialOperation'
      AND c.relname IN ('OCOperation_company_scope_identity_kind_key', 'OCOperation_correction_unresolved_key')
    `;
    assert.equal(indexes.length, 2); assert(indexes.every(index => index.valid && index.unique));
    assert.equal(indexes.find(index => index.name === "OCOperation_company_scope_identity_kind_key")?.predicate, '("operationKind" <> ALL (ARRAY[\'CLIENT_PROFILE_CORRECTION\'::text, \'CREDIT_SIMULATION\'::text]))');
    assert.equal(indexes.find(index => index.name === "OCOperation_correction_unresolved_key")?.predicate, '(("operationKind" = \'CLIENT_PROFILE_CORRECTION\'::text) AND (state = ANY (ARRAY[\'IN_FLIGHT\'::text, \'UNKNOWN\'::text])))');
  } finally { removeCheckout(checkout.temp); }
}));
