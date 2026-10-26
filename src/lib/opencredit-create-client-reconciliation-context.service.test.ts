import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
import { serialize } from "node:v8";
import type { SessionUser } from "./auth";
let service: typeof import("./opencredit-create-client-reconciliation-context.service");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try { service = await import("./opencredit-create-client-reconciliation-context.service"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const date = (n: number) => new Date(1792454400000 + n * 1000);
const operation = (state = "IN_FLIGHT") => ({ id: "operation", state, revision: state === "UNKNOWN" ? 2 : 1, createdAt: date(0), updatedAt: date(3) });
const events = (unknown = false): Record<string, unknown>[] => [
  { id: "e0", action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0, createdAt: date(0), dispatchAuthorizationEventId: null },
  { id: "e1", action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision: 1, createdAt: date(1), dispatchAuthorizationEventId: "grant" },
  ...(unknown ? [{ id: "e2", action: "MARKED_UNKNOWN", previousState: "IN_FLIGHT", nextState: "UNKNOWN", revision: 2, createdAt: date(2), dispatchAuthorizationEventId: null }] : []),
];
const input = () => ({ actor: { ...actor }, companyId: "company", contactId: "contact", providerScope: "synthetic-scope" as Parameters<typeof service.getOpenCreditCreateClientReconciliationContext>[1]["providerScope"] });
function fixture(unknown = false) {
  const state: Record<string, unknown> = { user: { ...actor }, company: { id: "company" }, contact: { id: "contact", companyId: "company" }, identity: { id: "identity" }, operation: operation(unknown ? "UNKNOWN" : "IN_FLIGHT"), events: events(unknown) };
  const calls: { name: string; args: unknown }[] = [], options: unknown[] = [];
  const delegate = (name: string, method: string) => new Proxy({}, { get(_t, key) {
    assert.equal(key, method, "only the exact read delegate permitted");
    return async (args: unknown) => { calls.push({ name, args }); return state[name]; };
  } });
  const tx = { user: delegate("user", "findUnique"), company: delegate("company", "findUnique"), contact: delegate("contact", "findUnique"),
    openCreditRemoteIdentity: delegate("identity", "findUnique"), openCreditCommercialOperation: delegate("operation", "findUnique"), openCreditCommercialOperationEvent: delegate("events", "findMany") };
  const guarded = new Proxy(tx, { get(target, key) { assert(Object.prototype.hasOwnProperty.call(target, key), "unexpected delegate"); return Reflect.get(target, key); } });
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>, option: unknown) => { options.push(option); return run(guarded); } } as unknown as Parameters<typeof service.getOpenCreditCreateClientReconciliationContext>[0];
  const run = async (value = input()) => {
    const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
    try { return await service.getOpenCreditCreateClientReconciliationContext(db, value); }
    finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
  };
  return { state, calls, options, run, db };
}
type F = ReturnType<typeof fixture>;
test("safe persisted diagnostic is exposed read-only; malformed/private JSON fails closed", async () => {
  const f = fixture();
  const diagnostic = { version: 1, category: "INVALID_JSON", stage: "RESPONSE", providerHttpStatus: 201,
    providerRequestId: "req_abcdefabcdef", providerCorrelationId: null, providerSuccess: null, providerCreated: null,
    providerErrorCode: null, responseReadable: false, responseParsed: false, observedAt: date(3).toISOString(),
    dispatchCommittedAt: date(1).toISOString(), respondedAt: date(2).toISOString(), settlement: "NOT_CONFIRMED" };
  (f.state.operation as Record<string, unknown>).diagnostic = JSON.stringify(diagnostic);
  const before = structuredClone(f.state); assert.deepEqual((await f.run()).diagnostic, diagnostic); assert.deepEqual(f.state, before);
  for (const bad of ["invalid json", JSON.stringify({ ...diagnostic, raw: "private" }), JSON.stringify({ ...diagnostic, providerRequestId: "00000000000" })]) {
    (f.state.operation as Record<string, unknown>).diagnostic = bad;
    await assert.rejects(f.run());
  }
});
const op = (f: F) => f.state.operation as Record<string, unknown>;
const es = (f: F) => f.state.events as Record<string, unknown>[];
for (const unknown of [false, true]) test("valid sanitized review, exact scope/chronology and zero writes " + unknown, async () => {
  const f = fixture(unknown), before = structuredClone(f.state), result = await f.run();
  assert.deepEqual(f.state, before);
  assert.deepEqual(result, { ok: true, review: { operationId: "operation", state: unknown ? "UNKNOWN" : "IN_FLIGHT", revision: unknown ? 2 : 1,
    reason: unknown ? "REMOTE_RESULT_AMBIGUOUS" : "DISPATCH_COMMITTED_RESULT_UNCONFIRMED", preparedAt: date(0).toISOString(),
    dispatchCommittedAt: date(1).toISOString(), settledAt: unknown ? date(2).toISOString() : null, dispatchAuthorizationBound: true } });
  assert.deepEqual(f.calls[2].args, { where: { companyId_id: { companyId: "company", id: "contact" } }, select: { id: true, companyId: true } });
  assert.deepEqual(f.calls[3].args, { where: { companyId_providerScope_contactId: { companyId: "company", providerScope: "synthetic-scope", contactId: "contact" } }, select: { id: true } });
  assert.deepEqual(f.calls[4].args, { where: { companyId_providerScope_remoteIdentityId_operationKind: {
    companyId: "company", providerScope: "synthetic-scope", remoteIdentityId: "identity", operationKind: "CLIENT_PROFILE_UPSERT",
  } }, select: { id: true, state: true, revision: true, createdAt: true, updatedAt: true, diagnostic: true } });
  assert.deepEqual(f.calls[5].args, { where: { operationId: "operation", companyId: "company", providerScope: "synthetic-scope" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 4, select: { id: true, action: true, previousState: true, nextState: true, revision: true, createdAt: true, dispatchAuthorizationEventId: true } });
  assert.deepEqual(f.options, [{ isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 }]);
});
for (const field of ["identity", "operation"]) test("no " + field + " means null", async () => { const f = fixture(); f.state[field] = null; assert.deepEqual(await f.run(), { ok: true, review: null }); assert(!f.calls.some(c => c.name === "events")); });
for (const state of ["PREPARED", "SUCCEEDED", "FAILED"]) test(state + " has no review semantics", async () => { const f = fixture(); f.state.operation = operation(state); assert.deepEqual(await f.run(), { ok: true, review: null }); assert(!f.calls.some(c => c.name === "events")); });
test("stale eligibility remains readable without reading active access/authorization", async () => {
  const f = fixture(); f.state.contact = { id: "contact", companyId: "company", archivedAt: date(4) };
  f.state.identity = { id: "identity", enabled: false };
  assert.equal((await f.run()).review?.state, "IN_FLIGHT");
  assert(!f.calls.some(c => /authorization|access/.test(c.name)));
});
for (const [field, value, code] of [["user", null, "NOT_AUTHORIZED"], ["user", { ...actor, companyId: "other" }, "NOT_AUTHORIZED"],
  ["user", { ...actor, role: "AGENT" }, "NOT_AUTHORIZED"], ["user", { ...actor, email: "other@example.invalid" }, "NOT_AUTHORIZED"],
  ["company", null, "COMPANY_NOT_FOUND"], ["contact", null, "CONTACT_NOT_FOUND"], ["contact", { id: "contact", companyId: "other" }, "CONTACT_NOT_FOUND"]] as const)
test("authority/tenant check " + field + JSON.stringify(value), async () => { const f = fixture(); f.state[field] = value; await assert.rejects(f.run(), { code }); });
for (const [field, code] of [["companyId", "INVALID_COMPANY"], ["contactId", "INVALID_CONTACT"], ["providerScope", "INVALID_PROVIDER_SCOPE"]] as const)
test("invalid trusted input " + field, async () => { const f = fixture(); await assert.rejects(f.run({ ...input(), [field]: "bad\n" }), { code }); assert.equal(f.calls.length, 0); });
const mutations: [string, boolean, (f: F) => void][] = [
  ["state", false, f => { op(f).state = "OTHER"; }], ["id", false, f => { op(f).id = "bad\n"; }],
  ["revision mismatch", false, f => { op(f).revision = 2; }], ["negative revision", false, f => { op(f).revision = -1; }],
  ["fractional revision", false, f => { op(f).revision = 1.5; }], ["unsafe revision", false, f => { op(f).revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["operation invalid Date", false, f => { op(f).createdAt = new Date(NaN); }], ["updatedAt string", false, f => { op(f).updatedAt = date(3).toISOString(); }],
  ["operation backwards", false, f => { op(f).updatedAt = date(-1); }], ["missing PREPARED", false, f => { es(f).shift(); }],
  ["missing RESERVED", false, f => { es(f).pop(); }], ["wrong action", false, f => { es(f)[1].action = "MARKED_UNKNOWN"; }],
  ["wrong previous", false, f => { es(f)[1].previousState = null; }], ["wrong next", false, f => { es(f)[1].nextState = "UNKNOWN"; }],
  ["wrong event revision", false, f => { es(f)[1].revision = 0; }], ["reserved missing binding", false, f => { es(f)[1].dispatchAuthorizationEventId = null; }],
  ["binding invalid ID", false, f => { es(f)[1].dispatchAuthorizationEventId = "bad\n"; }], ["prepared binding", false, f => { es(f)[0].dispatchAuthorizationEventId = "grant"; }],
  ["missing MARKED_UNKNOWN", true, f => { es(f).pop(); }], ["terminal after IN_FLIGHT", false, f => { es(f).push(events(true)[2]); }],
  ["extra event UNKNOWN", true, f => { es(f).push({ ...es(f)[2], id: "e3", revision: 3 }); }],
  ["backwards chronology", false, f => { es(f)[1].createdAt = date(-1); }], ["unknown backwards", true, f => { es(f)[2].createdAt = date(0); }],
  ["invalid event Date", false, f => { es(f)[0].createdAt = new Date(NaN); }], ["duplicate event ID", false, f => { es(f)[1].id = "e0"; }],
  ["event unknown field", false, f => { es(f)[1].private = "forbidden"; }], ["operation extra", false, f => { op(f).profile = "forbidden"; }],
  ["UNKNOWN terminal binding", true, f => { es(f)[2].dispatchAuthorizationEventId = "grant"; }],
  ["out of persisted order", false, f => { es(f).reverse(); }], ["events not array", false, f => { f.state.events = {}; }],
];
for (const [label, unknown, change] of mutations) test("CORRUPT_LEDGER no repair: " + label, async () => {
  const f = fixture(unknown); change(f); const before = serialize(f.state);
  await assert.rejects(f.run(), { code: "CORRUPT_LEDGER" }); assert.deepEqual(serialize(f.state), before);
});
for (const target of ["input", "operation", "event", "array"]) test("accessors never executed in " + target, async () => {
  const f = fixture(); let reads = 0; const value = input();
  const [object, key] = target === "input" ? [value, "contactId"] : target === "operation" ? [op(f), "state"] : target === "event" ? [es(f)[0], "action"] : [es(f), "0"];
  Object.defineProperty(object, key, { get() { reads++; throw Error("private"); } });
  await assert.rejects(f.run(value)); assert.equal(reads, 0);
});
test("strange prototypes and global Error raw errors fail closed", async () => {
  const f = fixture(); f.state.operation = Object.assign(Object.create({ private: true }), operation());
  await assert.rejects(f.run(), { code: "CORRUPT_LEDGER" });
  Object.defineProperty(f.db, "$transaction", { value: async () => { throw Error("private storage"); } });
  await assert.rejects(f.run(), e => e instanceof Error && e.message === "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_STORAGE_ERROR");
  assert.equal(service.readOpenCreditCreateClientReconciliationContextErrorCode({ name: "OpenCreditCreateClientReconciliationContextError", code: "STORAGE_ERROR", message: "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_STORAGE_ERROR" }), null);
  assert.equal(service.readOpenCreditCreateClientReconciliationContextErrorCode(Object.assign(new Error("wrong"), { name: "OpenCreditCreateClientReconciliationContextError", code: "STORAGE_ERROR" })), null);
});
test("AST read-only, minimal whitelist, no domain mutations or provider dependency", () => {
  const source = readFileSync("src/lib/opencredit-create-client-reconciliation-context.service.ts", "utf8");
  assert.match(source, /^import "server-only"/); assert.doesNotMatch(source, /\bfetch\b|console\.|logger|process\.env|opencredit-api-client|dispatcher|prepareOpenCredit|reserveOpenCredit|applyOpenCredit|markOpenCredit|\$executeRaw|\$queryRaw/);
  const ast = ts.createSourceFile("review.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) assert(!["create", "createMany", "update", "updateMany", "delete", "deleteMany", "upsert"].includes(n.expression.name.text)); ts.forEachChild(n, visit); }; visit(ast);
});
