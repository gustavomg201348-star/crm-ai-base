import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";

let boundary: typeof import("./opencredit-remote-identity-context-admin-handler");
let service: typeof import("./opencredit-remote-identity-context.service");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { boundary = await import("./opencredit-remote-identity-context-admin-handler"); service = await import("./opencredit-remote-identity-context.service"); }
  finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", email: "synthetic@example.invalid", name: "Synthetic" };
const scope = "synthetic-scope" as Parameters<typeof service.getOpenCreditRemoteIdentityContext>[1]["providerScope"];
function admin(s: SessionUser) {
  const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try { return requirePlatformAdmin(s); } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
}
function request(body: string | Uint8Array | ReadableStream<Uint8Array> | null = '{"companyId":"company","contactId":"contact"}', headers: Record<string, string | null | undefined> = {}, query = "") {
  const h = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [k, v] of Object.entries(headers)) { if (v === null) h.delete(k); else if (v !== undefined) h.set(k, v); }
  const url = "https://crm.example.invalid/api/admin/integrations/opencredit/remote-identity/context" + query;
  const r = new NextRequest(url, { method: "POST", headers: h, body: body as BodyInit | null, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });
  if (query === "?") Object.defineProperty(r, "url", { value: url });
  return r;
}
function fixture(o: { session?: SessionUser | null; limited?: Response; limitThrows?: boolean; scopeThrows?: boolean; failure?: unknown; exists?: boolean; enabled?: boolean } = {}) {
  const order: string[] = [], calls: unknown[] = [];
  return { order, calls, handler: boundary.createOpenCreditRemoteIdentityContextHandler({
    db: {} as Parameters<typeof service.getOpenCreditRemoteIdentityContext>[0],
    getSession: async () => { order.push("session"); return o.session === undefined ? actor : o.session; },
    requirePlatformAdmin: s => { order.push("admin"); return admin(s); },
    enforceLimits: async rules => { order.push("limit"); assert.deepEqual(rules.map(r => r.identifiers), [[actor.companyId, actor.id], ["company", "contact"]]); if (o.limitThrows) throw Error("private"); return o.limited ?? null; },
    resolveScope: () => { order.push("scope"); if (o.scopeThrows) throw Error("private"); return scope; },
    read: async (_db, input) => { order.push("read"); calls.push(input); if (o.failure !== undefined) throw o.failure; return { ok: true, exists: o.exists ?? false, enabled: o.enabled ?? false }; },
  }) };
}
async function error(r: Response, status: number, code: string) {
  assert.equal(r.status, status); assert.equal(r.headers.get("cache-control"), "no-store"); assert.deepEqual(await r.json(), { error: code });
}
test("unauthenticated before body", async () => { const f = fixture({ session: null }); await error(await f.handler(request("bad")), 401, "UNAUTHENTICATED"); assert.deepEqual(f.order, ["session"]); });
for (const session of [{ ...actor, role: "AGENT" as const }, { ...actor, companyId: "other" }]) test("non platform " + session.companyId + session.role, async () => {
  const f = fixture({ session }); await error(await f.handler(request()), 403, "FORBIDDEN"); assert.equal(f.calls.length, 0);
});
for (const headers of [{ origin: null }, { origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) test("origin " + JSON.stringify(headers), async () => {
  const f = fixture(); await error(await f.handler(request(undefined, headers)), 403, "INVALID_ORIGIN"); assert.equal(f.calls.length, 0);
});
for (const query of ["?", "?companyId=x"]) test("query " + query, async () => { await error(await fixture().handler(request(undefined, {}, query)), 400, "INVALID_REQUEST"); });
for (const headers of [{ authorization: "" }, ...[null, "text/plain", "application/json; charset=latin1", "application/json; extra=1"].map(v => ({ "content-type": v }))]) test("header " + JSON.stringify(headers), async () => {
  await error(await fixture().handler(request(undefined, headers)), 400, "INVALID_REQUEST");
});
for (const body of [null, "", "{}", "[]", "null", "1", "{", "{} trailing", '{"companyId":"a","companyId":"b"}', '{"companyId":"a","\\u0063ompanyId":"b"}', '\ufeff{"companyId":"company","contactId":"contact"}', " ".repeat(513), new Uint8Array([0xc3, 0x28])]) test("invalid body " + String(body).slice(0, 60), async () => {
  const f = fixture(); await error(await f.handler(request(body)), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
for (const id of [null, 1, [], {}, false, "", " a", "a ", "a\n", "_a", "a/b", "é", "a".repeat(129)]) test("invalid company " + JSON.stringify(id), async () => {
  await error(await fixture().handler(request(JSON.stringify({ companyId: id, contactId: "contact" }))), 400, "INVALID_REQUEST");
});
for (const key of ["providerScope", "tenantId", "partnerId", "actor", "accessId", "enabled", "tokens", "__proto__"]) test("extra " + key, async () => {
  await error(await fixture().handler(request(JSON.stringify({ companyId: "company", contactId: "contact", [key]: "private" }))), 400, "INVALID_REQUEST");
});
for (const [exists, enabled] of [[false, false], [true, false], [true, true]]) test("closed context " + exists + enabled, async () => {
  const f = fixture({ exists, enabled }), r = await f.handler(request());
  assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); assert.deepEqual(await r.json(), { ok: true, exists, enabled });
  assert.deepEqual(f.order, ["session", "admin", "limit", "scope", "read"]); assert.deepEqual(f.calls, [{ actor, companyId: "company", contactId: "contact", providerScope: scope }]);
});
for (const [o, status, code] of [
  [{ limited: new Response("private", { status: 429 }) }, 429, "RATE_LIMITED"],
  [{ limited: new Response("private", { status: 500 }) }, 503, "RATE_LIMIT_UNAVAILABLE"],
  [{ limitThrows: true }, 503, "RATE_LIMIT_UNAVAILABLE"], [{ scopeThrows: true }, 503, "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION"],
] as const) test("fail closed " + code, async () => { const f = fixture(o); await error(await f.handler(request()), status, code); assert.equal(f.calls.length, 0); });
for (const [code, status] of [["CONTACT_NOT_FOUND", 409], ["COMPANY_NOT_FOUND", 409], ["NOT_AUTHORIZED", 403], ["STORAGE_ERROR", 503]] as const) test("mapped domain " + code, async () => {
  await error(await fixture({ failure: new service.OpenCreditRemoteIdentityContextError(code) }).handler(request()), status, "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_" + code);
});
for (const failure of [Error("private SQL password"), { code: "STORAGE_ERROR" }, "private"]) test("sanitized " + typeof failure, async () => {
  await error(await fixture({ failure }).handler(request()), 503, "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_UNAVAILABLE");
});
for (const key of ["name", "code", "message"]) test("getter not read " + key, async () => {
  const e = new service.OpenCreditRemoteIdentityContextError("STORAGE_ERROR"); Object.defineProperty(e, key, { get() { assert.fail("getter"); } });
  await error(await fixture({ failure: e }).handler(request()), 503, "OPENCREDIT_REMOTE_IDENTITY_CONTEXT_UNAVAILABLE");
});
test("actual bytes cap and split chunks", async () => {
  const raw = '{"companyId":"company","contactId":"contact"}'.padEnd(512, " ");
  assert.equal((await fixture().handler(request(raw))).status, 200);
  await error(await fixture().handler(request(raw + " ", { "content-length": "1" })), 400, "INVALID_REQUEST");
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const b of Array.from(new TextEncoder().encode(raw))) c.enqueue(new Uint8Array([b])); c.close(); } });
  assert.equal((await fixture().handler(request(stream))).status, 200);
});
test("total body deadline cancels stalled reader before query", async () => {
  let cancelled = false; const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; return new Promise(() => {}); } });
  const f = fixture(), start = performance.now(); await error(await f.handler(request(stream)), 400, "INVALID_REQUEST");
  assert(performance.now() - start < 2500); assert(cancelled); assert.equal(f.calls.length, 0);
});
test("read snapshot only and fresh persisted platform actor", async () => {
  for (const exists of [false, true]) for (const enabled of [false, true]) {
    const order: string[] = [];
    const tx = {
      user: { findUnique: async () => { order.push("actor"); return actor; } },
      company: { findUnique: async (q: unknown) => { order.push("company"); assert.deepEqual(q, { where: { id: "company" }, select: { id: true } }); return { id: "company" }; } },
      contact: { findUnique: async () => ({ id: "contact" }) },
      openCreditRemoteIdentity: { findUnique: async (q: unknown) => { order.push("access"); assert.deepEqual(q, { where: { companyId_providerScope_contactId: { companyId: "company", providerScope: scope, contactId: "contact" } }, select: { enabled: true } }); return exists ? { enabled } : null; } },
    };
    const db = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
    const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
    try {
      const result = await service.getOpenCreditRemoteIdentityContext(db as never, { actor, companyId: "company", contactId: "contact", providerScope: scope });
      assert.deepEqual(result, { ok: true, exists, enabled: exists && enabled }); assert.deepEqual(order, ["actor", "company", "access"]);
      tx.user.findUnique = async () => ({ ...actor, role: "AGENT" as SessionUser["role"] });
      await assert.rejects(service.getOpenCreditRemoteIdentityContext(db as never, { actor, companyId: "company", contactId: "contact", providerScope: scope }), { code: "NOT_AUTHORIZED" });
    } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
  }
});
test("read-only authority and fixed route guards", () => {
  const handler = "src/lib/opencredit-remote-identity-context-admin-handler.ts", svc = "src/lib/opencredit-remote-identity-context.service.ts";
  const route = "src/app/api/admin/integrations/opencredit/remote-identity/context/route.ts";
  const source = readFileSync(svc, "utf8");
  assert.match(source, /^import "server-only"/);
  assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany|executeRaw|queryRaw)\b|\bfetch\s*\(|console\.|opencredit-api-client|remote-identity\.service/);
  for (const dir of ["src", "scripts"]) for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const p = dir + "/" + file.replace(/\\/g, "/");
    if (!/\.[cm]?[jt]sx?$/.test(p) || /\.(test|integration)\./.test(p)) continue;
    const text = readFileSync(p, "utf8");
    if (p !== svc && p !== handler) assert.doesNotMatch(text, /opencredit-remote-identity-context\.service|getOpenCreditRemoteIdentityContext/, p);
    if (p !== handler && p !== route) assert.doesNotMatch(text, /opencredit-remote-identity-context-admin-handler|createOpenCreditRemoteIdentityContextHandler/, p);
  }
  assert.match(readFileSync(route, "utf8"), /export const POST = createOpenCreditRemoteIdentityContextHandler/);
  const ci = readFileSync(".github/workflows/ci.yml", "utf8"); assert(ci.includes("opencredit-remote-identity-context-admin-handler.test.ts")); assert(ci.includes("opencredit-remote-identity-admin-postgres.integration.ts"));
});
for (const contactId of [null, 1, "", " a", "a\n", "a/b", "é", [], {}, "a".repeat(129)]) test("context invalid contact " + JSON.stringify(contactId), async () => {
  const f = fixture(); await error(await f.handler(request(JSON.stringify({ companyId: "company", contactId }))), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
