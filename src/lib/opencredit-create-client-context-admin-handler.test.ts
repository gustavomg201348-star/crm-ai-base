import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";
let boundary: typeof import("./opencredit-create-client-context-admin-handler");
let service: typeof import("./opencredit-create-client-context.service");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try { boundary = await import("./opencredit-create-client-context-admin-handler"); service = await import("./opencredit-create-client-context.service"); }
  finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
const commandId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", payload = { companyId: "company", contactId: "contact" };
const operation = { operationId: "operation", commandId, state: "PREPARED" as const, revision: 0 };
function request(options: { body?: string | Uint8Array | ReadableStream<Uint8Array> | null; query?: string; headers?: Record<string, string | null | undefined> } = {}) {
  const headers = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [k, v] of Object.entries(options.headers ?? {})) { if (v === null) headers.delete(k); else if (v !== undefined) headers.set(k, v); }
  const body = options.body === undefined ? JSON.stringify(payload) : options.body;
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/create-client/context" + (options.query ?? ""), { method: "POST", headers, body: body as BodyInit | null, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });
}
function fixture(options: { session?: SessionUser | null; result?: unknown; failure?: unknown; limited?: Response; limitThrows?: boolean; scopeThrows?: boolean } = {}) {
  const order: string[] = [], calls: unknown[] = [], rules: RateLimitRule[][] = [];
  const db = { $transaction: () => { throw Error("NO_DIRECT_DB"); } } as unknown as Parameters<typeof service.getOpenCreditCreateClientContext>[0];
  const scope = "synthetic-scope" as Parameters<typeof service.getOpenCreditCreateClientContext>[1]["providerScope"];
  const handler = boundary.createOpenCreditCreateClientContextHandler({ db,
    getSession: async () => { order.push("session"); return options.session === undefined ? actor : options.session; },
    requirePlatformAdmin: session => { order.push("admin"); const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
      try { return requirePlatformAdmin(session); } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; } },
    enforceLimits: async r => { order.push("limit"); rules.push([...r]); if (options.limitThrows) throw Error("private"); return options.limited ?? null; },
    resolveScope: () => { order.push("scope"); if (options.scopeThrows) throw Error("private"); return scope; },
    read: async (database, input) => { assert.equal(database, db); order.push("read"); calls.push(input); if (options.failure !== undefined) throw options.failure; return (options.result ?? { ok: true, operation }) as Awaited<ReturnType<typeof service.getOpenCreditCreateClientContext>>; },
  }); return { handler, order, calls, rules, scope };
}
async function error(response: Response, status: number, code: string) { assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(await response.json(), { error: code }); }
for (const session of [null, { ...actor, role: "OPERATOR" }, { ...actor, companyId: "other" }] as (SessionUser | null)[]) test("session/admin precede body " + JSON.stringify(session), async () => {
  const req = request(); let reads = 0; Object.defineProperty(req, "body", { get() { reads++; throw Error("private"); } });
  const f = fixture({ session }); await error(await f.handler(req), session ? 403 : 401, session ? "FORBIDDEN" : "UNAUTHENTICATED"); assert.equal(reads, 0); assert.equal(f.calls.length, 0);
});
for (const headers of [{ origin: null }, { origin: "https://evil.invalid" }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }]) test("same origin only " + JSON.stringify(headers), async () => {
  const f = fixture(); await error(await f.handler(request({ headers })), 403, "INVALID_ORIGIN"); assert(!f.order.includes("limit"));
});
for (const options of [{ query: "?x=1" }, { headers: { authorization: "" } }, { headers: { "content-type": null } }, { headers: { "content-type": "text/plain" } }, { headers: { "content-type": "application/json;charset=ascii" } }]) test("closed headers/query " + JSON.stringify(options), async () => {
  const f = fixture(); await error(await f.handler(request(options)), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
for (const raw of ["", "{}", "[]", "null", "{", JSON.stringify(payload) + "{}", "\uFEFF" + JSON.stringify(payload),
  '{"companyId":"x","company\\u0049d":"company","contactId":"contact"}', '{"__proto__":{},"companyId":"company","contactId":"contact"}',
  JSON.stringify({ companyId: "company" }), JSON.stringify({ contactId: "contact" })]) test("strict raw body " + raw, async () => {
  const f = fixture(); await error(await f.handler(request({ body: raw })), 400, "INVALID_REQUEST"); assert(!f.order.includes("limit"));
});
for (const extra of ["commandId", "operationId", "intentKey", "providerScope", "tenantId", "partnerId", "cpf", "profile", "authorizationId", "revision", "state", "actor", "constructor", "prototype"]) test("reject extra " + extra, async () => {
  await error(await fixture().handler(request({ body: JSON.stringify({ ...payload, [extra]: "private" }) })), 400, "INVALID_REQUEST");
});
for (const key of ["companyId", "contactId"]) for (const value of ["", " x", "x\n", "é", "x".repeat(129), 1, null, [], {}]) test("strict ID " + key + JSON.stringify(value), async () => {
  await error(await fixture().handler(request({ body: JSON.stringify({ ...payload, [key]: value }) })), 400, "INVALID_REQUEST");
});
test("actual byte limit, fatal UTF-8, forged Content-Length and null body", async () => {
  for (const body of ["x".repeat(2049), new Uint8Array([0xc3, 0x28]), null]) await error(await fixture().handler(request({ body, headers: { "content-length": "1" } })), 400, "INVALID_REQUEST");
  assert.equal((await fixture().handler(request({ body: JSON.stringify(payload).padEnd(2048, " "), headers: { "content-length": "99999", "content-type": "application/json; charset=utf-8" } }))).status, 200);
});
test("one total deadline includes hung, endless empty/slow chunks and errors", async () => {
  for (const mode of ["hung", "empty", "slow", "error"]) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(c) {
      if (mode === "error") { c.error(Error("private")); return; } if (mode === "empty") { c.enqueue(new Uint8Array()); return; }
      if (mode === "slow") return new Promise<void>(resolve => setTimeout(() => { if (!cancelled) c.enqueue(new Uint8Array([32])); resolve(); }, 350));
      return new Promise<void>(() => {});
    }, cancel() { cancelled = true; } });
    const f = fixture(), started = performance.now(); await error(await f.handler(request({ body: stream })), 400, "INVALID_REQUEST"); assert(performance.now() - started < 1800); assert(!f.order.includes("scope"));
  }
});
test("exact trusted input and independent context limits", async () => {
  const f = fixture(); const response = await f.handler(request()); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, operation }); assert.deepEqual(f.order, ["session", "admin", "limit", "scope", "read"]);
  assert.deepEqual(f.calls, [{ actor, ...payload, providerScope: f.scope }]); assert.equal((f.calls[0] as { actor: SessionUser }).actor, actor);
  assert.deepEqual(f.rules, [[{ category: "opencredit-create-client-context-actor", identifiers: [actor.companyId, actor.id], limit: 60, windowMs: 60000 }, { category: "opencredit-create-client-context-target", identifiers: [payload.companyId, payload.contactId], limit: 30, windowMs: 60000 }]]);
});
for (const state of [null, "PREPARED", "IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"]) test("closed response " + state, async () => {
  const result = { ok: true, operation: state === null ? null : { ...operation, state } };
  assert.deepEqual(await (await fixture({ result }).handler(request())).json(), result);
});
for (const options of [{ limited: new Response("private", { status: 429 }) }, { limited: new Response("private", { status: 503 }) }, { limitThrows: true }, { scopeThrows: true }]) test("fail closed before domain " + Object.keys(options), async () => {
  const f = fixture(options); const limited = options.limited?.status === 429;
  await error(await f.handler(request()), limited ? 429 : 503, limited ? "RATE_LIMITED" : options.scopeThrows ? "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION" : "RATE_LIMIT_UNAVAILABLE");
  assert.equal(f.calls.length, 0); if (!options.scopeThrows) assert(!f.order.includes("scope"));
});
for (const retry of ["0", "12", "01", "-1", "1.5", "Infinity", "9007199254740992", "Wed, 01 Jan 2030 00:00:00 GMT"]) test("safe retry " + retry, async () => {
  const r = await fixture({ limited: new Response("private", { status: 429, headers: { "retry-after": retry } }) }).handler(request()); assert.equal(r.headers.get("retry-after"), ["0", "12"].includes(retry) ? retry : null);
});
test("closed output rejects extras/getters/raw errors", async () => {
  let reads = 0; const getter = { ok: true, operation }; Object.defineProperty(getter, "operation", { get() { reads++; throw Error("private"); } });
  for (const result of [{ ok: true, operation, cpf: "private" }, { ok: true, operation: { ...operation, profile: "private" } }, getter, { ok: true, operation: { ...operation, state: "OTHER" } }]) await error(await fixture({ result }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_CONTEXT_UNAVAILABLE");
  assert.equal(reads, 0);
});
test("second module errors preserve exact codes; forged/missing/accessors fail closed", async () => {
  const require = createRequire(import.meta.url), file = require.resolve("./opencredit-create-client-context.service.ts"), cached = require.cache[file];
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  let other: typeof service;
  try { delete require.cache[file]; loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a); other = require(file); }
  finally { loader._load = original; if (cached) require.cache[file] = cached; else delete require.cache[file]; }
  assert.notEqual(other.OpenCreditCreateClientContextError, service.OpenCreditCreateClientContextError);
  for (const code of ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CORRUPT_OPERATION", "STORAGE_ERROR"] as const) {
    const status = code === "NOT_AUTHORIZED" ? 403 : code.startsWith("INVALID_") ? 400 : code.endsWith("NOT_FOUND") ? 404 : 503;
    await error(await fixture({ failure: new other.OpenCreditCreateClientContextError(code) }).handler(request()), status, "OPENCREDIT_CREATE_CLIENT_CONTEXT_" + code);
  }
  let reads = 0; const failures: unknown[] = [{ name: "OpenCreditCreateClientContextError", code: "STORAGE_ERROR", message: "OPENCREDIT_CREATE_CLIENT_CONTEXT_STORAGE_ERROR" }];
  for (const key of ["name", "code", "message"]) {
    const missing = new service.OpenCreditCreateClientContextError("STORAGE_ERROR"); Reflect.deleteProperty(missing, key); failures.push(missing);
    for (const descriptor of [{ get() { reads++; throw Error("private"); } }, { set(_v: unknown) { reads++; } }]) { const failure = new service.OpenCreditCreateClientContextError("STORAGE_ERROR"); Object.defineProperty(failure, key, descriptor); failures.push(failure); }
  }
  for (const code of ["__proto__", "constructor", "toString"]) failures.push(Object.assign(new Error("OPENCREDIT_CREATE_CLIENT_CONTEXT_" + code), { name: "OpenCreditCreateClientContextError", code }));
  failures.push(Object.assign(new Error("private"), { name: "OpenCreditCreateClientContextError", code: "STORAGE_ERROR" }));
  for (const failure of failures) await error(await fixture({ failure }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_CONTEXT_UNAVAILABLE");
  assert.equal(reads, 0);
});
