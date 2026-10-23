import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import type { SessionUser } from "./auth";
let service: typeof import("./opencredit-create-client-context.service");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try { service = await import("./opencredit-create-client-context.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = () => ({ actor: { ...actor }, companyId: "company", contactId: "contact", providerScope: "synthetic-scope" as Parameters<typeof service.getOpenCreditCreateClientContext>[1]["providerScope"] });
function fixture() {
  const state: Record<string, unknown> = { user: { ...actor }, company: { id: "company" }, contact: { id: "contact", companyId: "company" }, identity: { id: "identity" }, operation: { id: "operation", intentKey: commandId, state: "PREPARED", revision: 0 } };
  const calls: { name: string; args: unknown }[] = [], options: unknown[] = [];
  const delegate = (name: string, method: string) => new Proxy({}, { get(_t, key) {
    assert.equal(key, method, "only the exact read delegate is permitted");
    return async (args: unknown) => { calls.push({ name, args }); return state[name]; };
  } });
  const tx = { user: delegate("user", "findUnique"), company: delegate("company", "findUnique"), contact: delegate("contact", "findUnique"),
    openCreditRemoteIdentity: delegate("identity", "findUnique"), openCreditCommercialOperation: delegate("operation", "findUnique") };
  const guarded = new Proxy(tx, { get(target, key) { assert(Object.prototype.hasOwnProperty.call(target, key), "unexpected domain read/write"); return Reflect.get(target, key); } });
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>, option: unknown) => { options.push(option); return run(guarded); } } as unknown as Parameters<typeof service.getOpenCreditCreateClientContext>[0];
  const run = async (value = input()) => {
    const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
    try { return await service.getOpenCreditCreateClientContext(db, value); } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
  };
  return { state, calls, options, run, db };
}
test("scoped single-intent unique lookup and closed operation, only read delegates", async () => {
  const f = fixture(), before = structuredClone(f.state);
  assert.deepEqual(await f.run(), { ok: true, operation: { operationId: "operation", commandId, state: "PREPARED", revision: 0 } });
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.calls.map(c => c.name), ["user", "company", "contact", "identity", "operation"]);
  assert.deepEqual(f.calls[2].args, { where: { companyId_id: { companyId: "company", id: "contact" } }, select: { id: true, companyId: true } });
  assert.deepEqual(f.calls[3].args, { where: { companyId_providerScope_contactId: { companyId: "company", providerScope: "synthetic-scope", contactId: "contact" } }, select: { id: true } });
  assert.deepEqual(f.calls[4].args, { where: { companyId_providerScope_remoteIdentityId_operationKind: {
    companyId: "company", providerScope: "synthetic-scope", remoteIdentityId: "identity", operationKind: "CLIENT_PROFILE_UPSERT",
  } }, select: { id: true, intentKey: true, state: true, revision: true } });
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
});
for (const state of ["PREPARED", "IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"]) test("all states readable despite stale unrelated eligibility " + state, async () => {
  const f = fixture(); f.state.operation = { id: "operation", intentKey: commandId, state, revision: 3 };
  f.state.contact = { id: "contact", companyId: "company", archivedAt: new Date(), cpf: null };
  assert.equal((await f.run()).operation?.state, state); assert(!f.calls.some(c => /authorization|access/.test(c.name)));
});
for (const key of ["identity", "operation"]) test("absence yields null " + key, async () => {
  const f = fixture(); f.state[key] = null; assert.deepEqual(await f.run(), { ok: true, operation: null });
  if (key === "identity") assert.equal(f.calls.length, 4);
});
for (const [key, value, code] of [["user", null, "NOT_AUTHORIZED"], ["user", { ...actor, role: "AGENT" }, "NOT_AUTHORIZED"],
  ["user", { ...actor, companyId: "other" }, "NOT_AUTHORIZED"], ["user", { ...actor, email: "changed@example.invalid" }, "NOT_AUTHORIZED"],
  ["company", null, "COMPANY_NOT_FOUND"], ["contact", null, "CONTACT_NOT_FOUND"], ["contact", { id: "contact", companyId: "other" }, "CONTACT_NOT_FOUND"]] as const) test("scope and authority fail closed " + key + code + JSON.stringify(value), async () => {
  const f = fixture(); f.state[key] = value; await assert.rejects(f.run(), { code });
});
for (const [field, code] of [["companyId", "INVALID_COMPANY"], ["contactId", "INVALID_CONTACT"], ["providerScope", "INVALID_PROVIDER_SCOPE"]] as const) test("invalid exact input " + field, async () => {
  const f = fixture(); await assert.rejects(f.run({ ...input(), [field]: "bad\n" }), { code }); assert.equal(f.calls.length, 0);
});
for (const [field, value] of [["id", "bad\n"], ["id", ""], ["intentKey", commandId.toUpperCase()], ["intentKey", "bad"], ["state", "OTHER"],
  ["revision", -1], ["revision", 0.5], ["revision", Number.MAX_SAFE_INTEGER + 1], ["revision", "0"]] as const) test("corruption never masquerades as null " + field + String(value), async () => {
  const f = fixture(); (f.state.operation as Record<string, unknown>)[field] = value; await assert.rejects(f.run(), { code: "CORRUPT_OPERATION" });
});
for (const key of ["id", "intentKey", "state", "revision"]) test("stored accessor is not executed " + key, async () => {
  const f = fixture(); let reads = 0; Object.defineProperty(f.state.operation, key, { get() { reads++; throw Error("private"); } });
  await assert.rejects(f.run(), { code: "CORRUPT_OPERATION" }); assert.equal(reads, 0);
});
test("input getters and unknown prototypes cannot reach DB", async () => {
  const f = fixture(); let reads = 0; const value = input(); Object.defineProperty(value, "contactId", { get() { reads++; throw Error("private"); } });
  await assert.rejects(f.run(value)); assert.equal(reads, 0); assert.equal(f.calls.length, 0);
  await assert.rejects(f.run(Object.assign(Object.create({ extra: true }), input()))); assert.equal(f.calls.length, 0);
});
test("storage failure sanitizes raw error", async () => {
  const f = fixture(); const db = { $transaction: async () => { throw Error("private storage details"); } } as unknown as typeof f.db;
  await assert.rejects(service.getOpenCreditCreateClientContext(db, input()), e => e instanceof Error && !e.message.includes("private"));
});
test("AST proves read-only select whitelist and no domain/network side effects", () => {
  const source = readFileSync("src/lib/opencredit-create-client-context.service.ts", "utf8");
  assert.match(source, /^import "server-only"/); assert.doesNotMatch(source, /\bfetch\b|console\.|logger|process\.env|opencredit-api-client|prepareOpenCredit|dispatchOpenCredit|\$executeRaw|\$queryRaw|openCreditConsumerAuthorization|openCreditCommercialAccess/);
  const ast = ts.createSourceFile("context.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) assert(!["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(n.expression.name.text)); ts.forEachChild(n, visit); }; visit(ast);
  assert.match(source, /select: \{ id: true, intentKey: true, state: true, revision: true \}/);
});
