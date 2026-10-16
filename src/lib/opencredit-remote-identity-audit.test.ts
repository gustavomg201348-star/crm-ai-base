import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import * as ts from "typescript";
import { assertOpenCreditRemoteIdentityAuditTestDatabase } from "./opencredit-remote-identity-audit-postgres.guard";

const read = (path: string) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const model = (text: string, name: string) => text.match(new RegExp("^model " + name + " \\{[\\s\\S]*?^\\}", "m"))?.[0];
const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_REMOTE_IDENTITY_AUDIT_POSTGRES_TEST: "1",
  DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
for (const host of ["localhost", "127.0.0.1"]) for (const port of [5432, 55432]) test("audit gate accepts disposable " + host + ":" + port, () => {
  assert.doesNotThrow(() => assertOpenCreditRemoteIdentityAuditTestDatabase({ ...env,
    DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1:5432", host + ":" + port) }));
});
for (const key of ["CI", "GITHUB_ACTIONS", "OPENCREDIT_REMOTE_IDENTITY_AUDIT_POSTGRES_TEST"]) {
  for (const value of [undefined, "false", "0", ""]) test("audit gate rejects " + key + ":" + String(value), () => {
    assert.throws(() => assertOpenCreditRemoteIdentityAuditTestDatabase({ ...env, [key]: value }),
      { message: "OPENCREDIT_REMOTE_IDENTITY_AUDIT_TEST_REQUIRES_DISPOSABLE_CI" });
  });
}
for (const [i, url] of Array.from([
  "", "invalid", env.DATABASE_URL.replace("127.0.0.1", "production.example.invalid"),
  env.DATABASE_URL.replace("postgresql:", "postgres:"), env.DATABASE_URL.replace(":5432", ":5433"),
  env.DATABASE_URL.replace("/qevora_ci?", "/production?"), env.DATABASE_URL.replace("qevora_ci_password", "other"),
  env.DATABASE_URL.replace("qevora_ci:", "other:"), env.DATABASE_URL.replace("?schema=public", ""),
  env.DATABASE_URL.replace("schema=public", "schema=other"), env.DATABASE_URL + "&sslmode=disable", env.DATABASE_URL + "#fragment"
].entries())) test("audit gate rejects unsafe URL case " + i, () => {
  assert.throws(() => assertOpenCreditRemoteIdentityAuditTestDatabase({ ...env, DATABASE_URL: url }),
    { message: "OPENCREDIT_REMOTE_IDENTITY_AUDIT_TEST_REQUIRES_DISPOSABLE_CI" });
});

test("both schemas have the same exact historical fields, parent key and inverse relations", () => {
  const sqlite = read("prisma/schema.prisma"); const pg = read("prisma/schema.postgres.prisma");
  for (const name of ["OpenCreditRemoteIdentityEvent", "OpenCreditRemoteIdentity"]) assert.equal(model(sqlite, name), model(pg, name));
  for (const schema of [sqlite, pg]) {
    const event = model(schema, "OpenCreditRemoteIdentityEvent"); assert.ok(event);
    const fields = event.split(/\r?\n/).slice(1).map(l => l.trim()).filter(l => /^[a-z]/.test(l)).map(l => l.split(/\s+/)[0]);
    assert.deepEqual(fields, ["id", "remoteIdentityId", "companyId", "providerScope", "actorUserId", "action",
      "previousEnabled", "nextEnabled", "createdAt", "remoteIdentity", "actor"]);
    assert.match(event, /previousEnabled\s+Boolean\?/); assert.match(event, /nextEnabled\s+Boolean\s*\n/);
    assert.match(event, /action\s+String\s*\n/); assert.match(event, /createdAt\s+DateTime @default\(now\(\)\)/);
    assert.match(event, /fields: \[remoteIdentityId, companyId, providerScope\], references: \[id, companyId, providerScope\]/);
    assert.match(event, /fields: \[actorUserId\], references: \[id\]/);
    assert.equal((event.match(/onDelete: Restrict, onUpdate: NoAction/g) ?? []).length, 2);
    assert.match(model(schema, "OpenCreditRemoteIdentity")!, /@@unique\(\[id, companyId, providerScope\], map: "OCRemoteIdentity_id_company_scope_key"\)/);
    assert.match(model(schema, "OpenCreditRemoteIdentity")!, /events\s+OpenCreditRemoteIdentityEvent\[\]/);
    const parent = model(schema, "OpenCreditRemoteIdentity")!;
    assert.match(parent, /normalizedCpf\s+String\s*\n/);
    assert.match(parent, /enabled\s+Boolean\s+@default\(false\)/);
    assert.match(parent, /@@unique\(\[providerScope, normalizedCpf\], map: "OCRemote_scope_cpf_key"\)/);
    assert.match(parent, /@@unique\(\[companyId, providerScope, contactId\], map: "OCRemote_company_scope_contact_key"\)/);
    assert.match(model(schema, "User")!, /openCreditRemoteIdentityEvents OpenCreditRemoteIdentityEvent\[\] @relation\("OpenCreditRemoteIdentityEventActor"\)/);
    assert.doesNotMatch(event, /updatedAt|normalizedCpf|contactCpf|Cascade|payload|metadata|credential|token|password/);
  }
});
test("migration only adds event structure; no ACL, trigger, backfill or manual action checks", () => {
  const sql = read("prisma/migrations/20261016220000_add_opencredit_remote_identity_audit/migration.sql");
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 1);
  assert.equal((sql.match(/CREATE INDEX/g) ?? []).length, 2);
  assert.equal((sql.match(/FOREIGN KEY/g) ?? []).length, 2);
  assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE NO ACTION/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /\b(?:GRANT|REVOKE|ROLE|TRIGGER|FUNCTION|INSERT|UPDATE(?! NO ACTION)|DELETE(?! RESTRICT)|TRUNCATE|DROP|CHECK|CASCADE)\b/);
  for (const match of Array.from(sql.matchAll(/(?:CONSTRAINT|INDEX) "([^"]+)"/g))) assert.ok(match[1].length <= 63);
});

// Conservative syntactic boundary, not a claim of whole-program taint analysis.
// Delegate/method extraction is rejected rather than trusting an alias or dynamic call.
function auditRuntime(source: string, allowCreate = true): string[] {
  const file = ts.createSourceFile("runtime.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const errors: string[] = [];
  const delegate = "openCreditRemoteIdentityEvent";
  const constants = new Map<string, string>();
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  const allowed = new Set(["create", "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
  function name(node: ts.Expression): string | undefined {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text
      : ts.isIdentifier(node) ? constants.get(node.text) : undefined;
  }
  function visit(node: ts.Node) {
    const isDelegate = ts.isPropertyAccessExpression(node) && node.name.text === delegate
      || ts.isElementAccessExpression(node) && name(node.argumentExpression) === delegate;
    if (isDelegate) {
      const member = node.parent;
      const method = ts.isPropertyAccessExpression(member) ? member.name.text
        : ts.isElementAccessExpression(member) ? name(member.argumentExpression) : undefined;
      if (!method || !allowed.has(method) || !allowCreate && method === "create" || !ts.isCallExpression(member.parent) || member.parent.expression !== member) {
        errors.push("AUDIT_EVENT_MUTATOR_OR_DELEGATE_ESCAPE");
      }
    }
    if (ts.isBindingElement(node)) {
      const key = node.propertyName;
      const extracted = key && ts.isComputedPropertyName(key) ? name(key.expression)
        : key && (ts.isIdentifier(key) || ts.isStringLiteral(key)) ? key.text
        : !key && ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (extracted === delegate) errors.push("AUDIT_EVENT_DESTRUCTURED_DELEGATE");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return errors;
}
for (const method of ["update", "updateMany", "delete", "deleteMany", "upsert"]) test("runtime guard rejects " + method + " and obvious aliases", () => {
  for (const source of [
    "db.openCreditRemoteIdentityEvent." + method + "({})",
    "db['openCreditRemoteIdentityEvent']['" + method + "']({})",
    "const events = tx.openCreditRemoteIdentityEvent; events." + method + "({})",
    "const { openCreditRemoteIdentityEvent: events } = db; events." + method + "({})",
    "const { " + method + ": mutate } = db.openCreditRemoteIdentityEvent; mutate({})",
    "const key = 'openCreditRemoteIdentityEvent'; db[key]." + method + "({})",
    "const key = 'openCreditRemoteIdentityEvent'; const { [key]: events } = db; events." + method + "({})",
    "const { ['openCreditRemoteIdentityEvent']: events } = db; events." + method + "({})",
    "db[" + String.fromCharCode(96) + "openCreditRemoteIdentityEvent" + String.fromCharCode(96) + "]." + method + "({})",
    "const mutate = db.openCreditRemoteIdentityEvent." + method + ".bind(db); mutate({})"
  ]) assert.ok(auditRuntime(source).length > 0);
});
test("runtime guard permits future direct insert/read, rejects dynamic methods and delegate escapes", () => {
  assert.deepEqual(auditRuntime("await tx.openCreditRemoteIdentityEvent.create({}); await db.openCreditRemoteIdentityEvent.findMany({});"), []);
  assert.ok(auditRuntime("await tx.openCreditRemoteIdentityEvent.create({});", false).length > 0);
  assert.ok(auditRuntime("await tx['openCreditRemoteIdentityEvent']['create']({});", false).length > 0);
  for (const source of ["db.openCreditRemoteIdentityEvent[method]({})", "return db.openCreditRemoteIdentityEvent",
    "external(db.openCreditRemoteIdentityEvent)"]) assert.ok(auditRuntime(source).length > 0);
});
test("production sources currently contain no event writer, mutators or obvious delegate aliases", () => {
  function scan(dir: URL) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:tsx?|m?js|cjs)$/.test(entry.name) && !/\.(?:test|integration)\.(?:tsx?|m?js|cjs)$/.test(entry.name)) {
        assert.deepEqual(auditRuntime(readFileSync(path, "utf8"), false), [], path.pathname);
      }
    }
  }
  scan(new URL("../", import.meta.url));
  scan(new URL("../../scripts/", import.meta.url));
});
test("CI includes new unit/material tests and guard precedes client construction", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-remote-identity-audit.test.ts/);
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-remote-identity-audit-postgres.integration.ts/);
  assert.match(ci, /OPENCREDIT_REMOTE_IDENTITY_AUDIT_POSTGRES_TEST: "1"/);
  const material = read("src/lib/opencredit-remote-identity-audit-postgres.integration.ts");
  const guardAt = material.indexOf("assertOpenCreditRemoteIdentityAuditTestDatabase(process.env)");
  const clientAt = material.indexOf("new PrismaClient");
  assert.ok(guardAt >= 0 && clientAt > guardAt);
  assert.doesNotMatch(material, /console\.|fetch\(|\bTRUNCATE\b|\bREVOKE\b|\bGRANT\b/);
});
