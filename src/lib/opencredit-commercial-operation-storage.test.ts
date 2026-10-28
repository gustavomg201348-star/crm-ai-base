import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import * as ts from "typescript";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";

const read = (path: string) => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const op = "OpenCreditCommercialOperation"; const event = op + "Event";
const model = (source: string, name: string) => source.match(new RegExp("^model " + name + " \\{[\\s\\S]*?^\\}", "m"))?.[0];
const fields = (source: string) => source.split(/\r?\n/).slice(1).map(l => l.trim()).filter(l => /^[a-z]/.test(l)).map(l => l.split(/\s+/)[0]);
const operationFields = ["diagnostic", "id", "companyId", "remoteIdentityId", "providerScope", "operationKind", "intentKey", "state", "revision", "createdByUserId", "createdAt", "updatedAt", "company", "remoteIdentity", "createdBy", "events"];
const eventFields = ["dispatchAuthorizationEventId", "dispatchAuthorizationEvent", "id", "operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", "createdAt", "operation", "actor"];
test("both logical models, exact fields and inverse relations are equivalent across providers", () => {
  const sqlite = read("prisma/schema.prisma"); const pg = read("prisma/schema.postgres.prisma");
  for (const name of [op, event]) { assert.ok(model(sqlite, name)); assert.equal(model(sqlite, name)?.replace(/, map: "OCOperationEvent_dispatch_auth_fkey"/g, ""), model(pg, name)?.replace(/, map: "OCOperationEvent_dispatch_auth_fkey"/g, "")); }
  for (const schema of [sqlite, pg]) {
    const operation = model(schema, op)!; const history = model(schema, event)!;
    assert.deepEqual(fields(operation), operationFields); assert.deepEqual(fields(history), eventFields);
    assert.match(operation, /state\s+String\s+@default\("PREPARED"\)/); assert.match(operation, /revision\s+Int\s+@default\(0\)/);
    assert.match(operation, /operationKind\s+String\s*\n/); assert.match(operation, /intentKey\s+String\s*\n/);
    assert.match(operation, /updatedAt\s+DateTime @updatedAt/);
    assert.match(history, /previousState\s+String\?/); assert.match(history, /nextState\s+String\s*\n/);
    assert.match(history, /revision\s+Int\s*\n/); assert.match(history, /action\s+String\s*\n/);
    for (const text of [operation, history]) assert.doesNotMatch(text, /normalizedCpf|\bcpf\b|payload|response|credential|password|token|Hash|consent|evidence|Cascade/);
    assert.doesNotMatch(history, /updatedAt|note|message|stack|url/i);
    assert.match(operation, /fields: \[companyId\], references: \[id\]/);
    assert.match(operation, /fields: \[remoteIdentityId, companyId, providerScope\], references: \[id, companyId, providerScope\]/);
    assert.match(operation, /fields: \[createdByUserId\], references: \[id\]/);
    assert.match(history, /fields: \[operationId, companyId, providerScope\], references: \[id, companyId, providerScope\]/);
    assert.match(history, /fields: \[actorUserId\], references: \[id\]/);
    assert.equal((operation.match(/onDelete: Restrict, onUpdate: NoAction/g) ?? []).length, 3);
    assert.equal((history.match(/onDelete: Restrict, onUpdate: NoAction/g) ?? []).length, 3);
    assert.match(history, /dispatchAuthorizationEventId String\?/);
    assert.match(history, /fields: \[dispatchAuthorizationEventId, companyId, providerScope\], references: \[id, companyId, providerScope\]/);
    assert.match(operation, /@@unique\(\[companyId, providerScope, intentKey\], map: "OCOperation_company_scope_intent_key"\)/);
    assert.match(operation, /@@index\(\[companyId, providerScope, remoteIdentityId, operationKind\], map: "OCOperation_identity_kind_lookup_idx"\)/);
    assert.match(operation, /@@unique\(\[id, companyId, providerScope\], map: "OCOperation_id_company_scope_key"\)/);
    assert.match(model(schema, "Company")!, /openCreditCommercialOperations OpenCreditCommercialOperation\[\]/);
    assert.match(model(schema, "User")!, /openCreditCommercialOperationsCreated OpenCreditCommercialOperation\[\] @relation\("OpenCreditCommercialOperationCreatedBy"\)/);
    assert.match(model(schema, "User")!, /openCreditCommercialOperationEvents OpenCreditCommercialOperationEvent\[\] @relation\("OpenCreditCommercialOperationEventActor"\)/);
    assert.match(model(schema, "OpenCreditRemoteIdentity")!, /operations\s+OpenCreditCommercialOperation\[\]/);
    assert.match(model(schema, "OpenCreditRemoteIdentity")!, /@@unique\(\[id, companyId, providerScope\], map: "OCRemoteIdentity_id_company_scope_key"\)/);
  }
});
test("migration is structural only, additive and identifier lengths are safe", () => {
  const sql = read("prisma/migrations/20261016230000_add_opencredit_commercial_operation_foundation/migration.sql");
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 2);
  assert.equal((sql.match(/CREATE UNIQUE INDEX/g) ?? []).length, 2); assert.equal((sql.match(/CREATE INDEX/g) ?? []).length, 5);
  assert.equal((sql.match(/FOREIGN KEY/g) ?? []).length, 5); assert.equal((sql.match(/ON DELETE RESTRICT ON UPDATE NO ACTION/g) ?? []).length, 5);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE(?! NO ACTION)|DELETE(?! RESTRICT)|TRUNCATE|DROP|CASCADE|CHECK|GRANT|REVOKE|ROLE|TRIGGER|FUNCTION)\b/);
  assert.doesNotMatch(sql, /normalizedCpf|\bcpf\b|payload|response|credential|password|token|Hash|consent|evidence/i);
  for (const m of Array.from(sql.matchAll(/ALTER TABLE "([^"]+)"/g))) assert.ok([op, event].includes(m[1]));
  for (const m of Array.from(sql.matchAll(/(?:CONSTRAINT|INDEX) "([^"]+)"/g))) assert.ok(m[1].length <= 63);
});

test("single identity-kind migration fails closed without any data cleanup", () => {
  const sql = read("prisma/migrations/20261020190000_enforce_opencredit_operation_single_identity_kind/migration.sql");
  assert.match(sql, /GROUP BY "companyId", "providerScope", "remoteIdentityId", "operationKind"\s+HAVING COUNT\(\*\) > 1/);
  assert.match(sql, /RAISE EXCEPTION 'OPENCREDIT_OPERATION_IDENTITY_KIND_DUPLICATES_EXIST'/);
  assert.match(sql, /CREATE UNIQUE INDEX "OCOperation_company_scope_identity_kind_key"\s+ON "OpenCreditCommercialOperation"\("companyId", "providerScope", "remoteIdentityId", "operationKind"\)/);
  assert(sql.indexOf("RAISE EXCEPTION") < sql.indexOf("CREATE UNIQUE INDEX"));
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|CASCADE)\b/i);
});

// Conservative syntax check, not whole-program taint analysis or raw SQL enforcement.
function ledgerRuntime(source: string, allowService = false, diagnosticOnly = false) {
  const file = ts.createSourceFile("runtime.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const delegates = new Set(["openCreditCommercialOperation", "openCreditCommercialOperationEvent"]);
  const reads = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);
  const constants = new Map<string, string>(); const errors: string[] = []; const writers: string[] = []; let references = 0;
  function collect(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) constants.set(node.name.text, node.initializer.text);
    ts.forEachChild(node, collect);
  }
  collect(file);
  function name(node: ts.Expression): string | undefined { return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : ts.isIdentifier(node) ? constants.get(node.text) : undefined; }
  function visit(node: ts.Node) {
    const key = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) ? name(node.argumentExpression) : undefined;
    if (key && delegates.has(key)) {
      references++; const member = node.parent;
      const method = ts.isPropertyAccessExpression(member) ? member.name.text : ts.isElementAccessExpression(member) ? name(member.argumentExpression) : undefined;
      const diagnosticWriter = diagnosticOnly && key === "openCreditCommercialOperation" && method === "updateMany";
      const allowedWriter = diagnosticWriter || allowService && (key === "openCreditCommercialOperation" ? method === "create" || method === "updateMany" : method === "create");
      if (!method || !reads.has(method) && !allowedWriter || !ts.isCallExpression(member.parent) || member.parent.expression !== member) errors.push("LEDGER_WRITER_OR_DELEGATE_ESCAPE");
      else if (allowedWriter) writers.push(key + "." + method);
      if (diagnosticWriter && ts.isCallExpression(member.parent)) {
        const arg = member.parent.arguments[0];
        const data = arg && ts.isObjectLiteralExpression(arg) ? arg.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === "data") : undefined;
        if (!data || !ts.isPropertyAssignment(data) || !ts.isObjectLiteralExpression(data.initializer)
          || data.initializer.properties.length !== 1 || data.initializer.properties[0].name?.getText(file) !== "diagnostic") errors.push("DIAGNOSTIC_MAY_ONLY_WRITE_DIAGNOSTIC");
      }
    }
    if (ts.isBindingElement(node)) {
      const key = node.propertyName;
      const extracted = key && ts.isComputedPropertyName(key) ? name(key.expression) : key && (ts.isIdentifier(key) || ts.isStringLiteral(key)) ? key.text : !key && ts.isIdentifier(node.name) ? node.name.text : undefined;
      if (extracted && delegates.has(extracted)) { references++; errors.push("LEDGER_DESTRUCTURED_DELEGATE"); }
    }
    ts.forEachChild(node, visit);
  }
  visit(file); return { errors, references, writers };
}
for (const delegate of ["openCreditCommercialOperation", "openCreditCommercialOperationEvent"]) {
  for (const method of ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"]) test(delegate + " rejects " + method + " and obvious escapes/aliases", () => {
    for (const source of [
      "db." + delegate + "." + method + "({})",
      "db['" + delegate + "']['" + method + "']({})",
      "const d = db." + delegate + "; d." + method + "({})",
      "const { " + delegate + ": d } = db; d." + method + "({})",
      "const { " + method + ": mutate } = db." + delegate + "; mutate({})",
      "const k = '" + delegate + "'; db[k]." + method + "({})",
      "const k = '" + delegate + "'; const { [k]: d } = db; d." + method + "({})",
      "db[" + String.fromCharCode(96) + delegate + String.fromCharCode(96) + "]." + method + "({})",
      "const m = '" + method + "'; db." + delegate + "[m]({})",
      "const mutate = db." + delegate + "." + method + ".bind(db); mutate({})"
    ]) assert.ok(ledgerRuntime(source).errors.length > 0);
  });
  test(delegate + " permits only direct read syntax and rejects dynamic accessors/escapes", () => {
    assert.deepEqual(ledgerRuntime("db." + delegate + ".findMany({});").errors, []);
    for (const source of ["db." + delegate + "[method]({})", "return db." + delegate, "external(db." + delegate + ")"]) assert.ok(ledgerRuntime(source).errors.length > 0);
  });
}
test("only the approved service has the exact ledger writers; all other production sources/scripts remain read-only", () => {
  const writers: string[] = [];
  function scan(dir: URL) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) scan(path);
      else if (/\.(?:tsx?|m?js|cjs)$/.test(entry.name) && !/\.(?:test|integration)\.(?:tsx?|m?js|cjs)$/.test(entry.name)) {
        const expected = ["/src/lib/opencredit-commercial-operation.service.ts", "/src/lib/opencredit-client-correction.service.ts", "/src/lib/opencredit-clt-simulation.service.ts"].some(p => path.pathname.endsWith(p));
        const diagnosticOnly = path.pathname.endsWith("/src/lib/opencredit-create-client-diagnostic.service.ts");
        const result = ledgerRuntime(readFileSync(path, "utf8"), expected, diagnosticOnly);
        assert.deepEqual(result.errors, [], path.pathname);
        writers.push(...result.writers);
      }
    }
  }
  scan(new URL("../", import.meta.url)); scan(new URL("../../scripts/", import.meta.url));
  assert.deepEqual(writers.sort(), ["openCreditCommercialOperation.create",
    "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany",
    "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create",
    "openCreditCommercialOperation.create", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany",
    "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create",
    "openCreditCommercialOperation.create", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany", "openCreditCommercialOperation.updateMany",
    "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create", "openCreditCommercialOperationEvent.create"].sort());
});
test("service exception permits only operation create/updateMany and Event create; no aliases or dynamic mutations", () => {
  assert.deepEqual(ledgerRuntime('tx.openCreditCommercialOperation.updateMany({data:{diagnostic:"safe"}})', false, true).errors, []);
  assert(ledgerRuntime('tx.openCreditCommercialOperation.updateMany({data:{state:"SUCCEEDED"}})', false, true).errors.length > 0);
  assert(ledgerRuntime('tx.openCreditCommercialOperationEvent.create({data:{}})', false, true).errors.length > 0);
  for (const delegate of ["openCreditCommercialOperation", "openCreditCommercialOperationEvent"]) {
    for (const method of ["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"]) {
      const permitted = method === "create" || delegate === "openCreditCommercialOperation" && method === "updateMany";
      assert.equal(ledgerRuntime("db." + delegate + "." + method + "({})", true).errors.length === 0, permitted);
      for (const source of ["const d = db." + delegate + "; d." + method + "({})",
        "const { " + delegate + ": d } = db; d." + method + "({})",
        "const mutate = db." + delegate + "." + method + "; mutate({})",
        "db." + delegate + "[method]({})"]) assert.ok(ledgerRuntime(source, true).errors.length > 0);
    }
  }
});
const env = { CI: "true", GITHUB_ACTIONS: "true", OPENCREDIT_COMMERCIAL_OPERATION_POSTGRES_TEST: "1", DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
for (const host of ["localhost", "127.0.0.1"]) for (const port of [5432, 55432]) test("guard accepts disposable " + host + ":" + port, () => assert.doesNotThrow(() => assertOpenCreditCommercialOperationTestDatabase({ ...env, DATABASE_URL: env.DATABASE_URL.replace("127.0.0.1:5432", host + ":" + port) })));
for (const key of ["CI", "GITHUB_ACTIONS", "OPENCREDIT_COMMERCIAL_OPERATION_POSTGRES_TEST"]) for (const value of [undefined, "", "false", "0"]) test("guard rejects " + key + ":" + String(value), () => assert.throws(() => assertOpenCreditCommercialOperationTestDatabase({ ...env, [key]: value })));
for (const [i, url] of Array.from(["", "invalid", env.DATABASE_URL.replace("127.0.0.1", "production.invalid"), env.DATABASE_URL.replace("postgresql:", "postgres:"), env.DATABASE_URL.replace(":5432", ":5433"), env.DATABASE_URL.replace("/qevora_ci?", "/other?"), env.DATABASE_URL.replace("qevora_ci_password", "other"), env.DATABASE_URL.replace("qevora_ci:", "other:"), env.DATABASE_URL.replace("?schema=public", ""), env.DATABASE_URL.replace("schema=public", "schema=other"), env.DATABASE_URL + "&sslmode=disable", env.DATABASE_URL + "#fragment"].entries())) test("guard rejects unsafe URL " + i, () => assert.throws(() => assertOpenCreditCommercialOperationTestDatabase({ ...env, DATABASE_URL: url })));
test("CI preserves gates, adds unit/material flag, and material guard precedes client", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-commercial-operation-storage.test.ts/);
  assert.match(ci, /tsx@4\.20\.6 src\/lib\/opencredit-commercial-operation-postgres.integration.ts/);
  assert.match(ci, /OPENCREDIT_COMMERCIAL_OPERATION_POSTGRES_TEST: "1"/);
  for (const gate of ["opencredit-remote-identity-service", "opencredit-remote-identity-audit", "opencredit-commercial-access-service", "opencredit-commercial-access-audit", "opencredit-commercial-identity-storage", "opencredit-contact-client-profile-adapter", "chatbot-execution-engine", "meta-reply-correlation"]) assert.ok(ci.includes(gate));
  const material = read("src/lib/opencredit-commercial-operation-postgres.integration.ts");
  const guard = material.indexOf("assertOpenCreditCommercialOperationTestDatabase(process.env)");
  assert.ok(guard >= 0 && material.indexOf("new PrismaClient") > guard);
  assert.doesNotMatch(material, /console\.|fetch\(|\bTRUNCATE\b|\bGRANT\b|\bREVOKE\b|openCreditCommercialOperationEvent\.(?:delete|deleteMany|update|updateMany|upsert)/);
});
