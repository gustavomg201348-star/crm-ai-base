import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertOpenCreditIdentityTestDatabase } from "./opencredit-commercial-identity-postgres.guard";

const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_COMMERCIAL_IDENTITY_POSTGRES_TEST: "1",
  DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
for (const host of ["127.0.0.1","localhost"]) for (const port of [5432,55432]) test("guard accepts explicit disposable loopback configuration " + host + ":" + port, () => {
  assert.doesNotThrow(() => assertOpenCreditIdentityTestDatabase({ ...env, DATABASE_URL: `postgresql://qevora_ci:qevora_ci_password@${host}:${port}/qevora_ci?schema=public` }));
});
for (const key of ["CI","GITHUB_ACTIONS","OPENCREDIT_COMMERCIAL_IDENTITY_POSTGRES_TEST"]) for (const value of [undefined,"false","0",""]) test("guard rejects missing/incorrect " + key + ":" + String(value), () => {
  assert.throws(() => assertOpenCreditIdentityTestDatabase({ ...env, [key]: value }), { message: "OPENCREDIT_IDENTITY_TEST_REQUIRES_DISPOSABLE_CI" });
});
for (const [i,url] of [
  "", "not-a-url", "postgresql://qevora_ci:qevora_ci_password@railway.example.invalid:5432/qevora_ci?schema=public",
  env.DATABASE_URL.replace("postgresql:", "postgres:"), env.DATABASE_URL.replace("qevora_ci?", "production?"),
  env.DATABASE_URL.replace(":5432", ":5433"), env.DATABASE_URL.replace("qevora_ci_password", "other"),
  env.DATABASE_URL.replace("qevora_ci:", "other:"), env.DATABASE_URL.replace("?schema=public",""),
  env.DATABASE_URL + "&sslmode=disable", env.DATABASE_URL + "#extra", env.DATABASE_URL.replace("schema=public","schema=private")
].map((url,i) => [i,url] as const)) test("guard refuses unsafe URL case " + i, () => {
  assert.throws(() => assertOpenCreditIdentityTestDatabase({ ...env, DATABASE_URL: url }), error => {
    assert.equal((error as Error).message, "OPENCREDIT_IDENTITY_TEST_REQUIRES_DISPOSABLE_CI");
    assert.equal("cause" in (error as Error), false); return true;
  });
});
const read = (path: string) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const model = (text: string, name: string) => text.match(new RegExp("^model " + name + " \\{[\\s\\S]*?^\\}", "m"))?.[0];
test("both Prisma providers declare equivalent new models and inverse relations", () => {
  const sqlite = read("prisma/schema.prisma"); const pg = read("prisma/schema.postgres.prisma");
  for (const name of ["OpenCreditCommercialAccess","OpenCreditRemoteIdentity","Company","Contact"]) assert.equal(model(sqlite,name), model(pg,name));
  // Existing User.email index has a SQLite-only map; compare only the new inverse fields.
  for (const name of ["openCreditCommercialAccessChanges","openCreditRemoteIdentitiesCreated"]) {
    const line = (text: string) => model(text,"User")!.split(/\r?\n/).find(l => l.trim().startsWith(name + " "));
    assert.ok(line(sqlite)); assert.equal(line(sqlite), line(pg));
  }
  for (const text of [sqlite,pg]) {
    assert.match(model(text,"Company")!, /openCreditCommercialAccesses OpenCreditCommercialAccess\[\]/);
    assert.match(model(text,"Contact")!, /openCreditRemoteIdentities OpenCreditRemoteIdentity\[\]/);
    assert.match(model(text,"User")!, /OpenCreditCommercialAccessChangedBy/);
    assert.match(model(text,"User")!, /OpenCreditRemoteIdentityCreatedBy/);
    for (const name of ["OpenCreditCommercialAccess","OpenCreditRemoteIdentity"]) {
      const source = model(text,name)!; assert.ok(source);
      assert.match(source, /enabled\s+Boolean\s+@default\(false\)/);
      assert.match(source, /providerScope\s+String\s*\n/);
      assert.doesNotMatch(source, /Cascade|tenantId|partnerId|password|bearer|fingerprint|baseUrl/);
    }
  }
});
test("one additive migration has no backfill, CHECK, data mutation, default scope or modification to existing tables", () => {
  const sql = read("prisma/migrations/20261016190000_add_opencredit_commercial_identity/migration.sql");
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 2);
  assert.equal((sql.match(/FOREIGN KEY/g) ?? []).length, 6);
  assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE NO ACTION/g) ?? []).length, 6);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 3);
  assert.equal((sql.match(/CREATE INDEX/g) ?? []).length, 3);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE(?! NO ACTION)|DELETE(?! RESTRICT)|DROP|TRUNCATE|CHECK|CASCADE)\b/);
  for (const match of Array.from(sql.matchAll(/ALTER TABLE "([^"]+)"/g))) assert.ok(["OpenCreditCommercialAccess","OpenCreditRemoteIdentity"].includes(match[1]));
  assert.doesNotMatch(sql, /"providerScope" TEXT NOT NULL DEFAULT/);
  for (const match of Array.from(sql.matchAll(/(?:CONSTRAINT|INDEX) "([^"]+)"/g))) assert.ok(match[1].length <= 63);
});
test("CI runs the material test with its explicit flag and the existing PostgreSQL service", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /image: postgres:18/);
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-commercial-identity-postgres.integration.ts/);
  assert.match(ci, /OPENCREDIT_COMMERCIAL_IDENTITY_POSTGRES_TEST: "1"/);
});
test("material test guards before client creation and cleans only invocation IDs", () => {
  const source = read("src/lib/opencredit-commercial-identity-postgres.integration.ts");
  assert.ok(source.indexOf("assertOpenCreditIdentityTestDatabase(process.env)") < source.indexOf("new PrismaClient"));
  assert.match(source, /Promise.allSettled/); assert.match(source, /await barrier/);
  assert.match(source, /id: \{ in: ids \}/); assert.match(source, /companyId: \{ in: ids \}/);
  assert.doesNotMatch(source, /\.deleteMany\(\s*\)|\bTRUNCATE\s+TABLE|console\.|fetch\(/);
});
