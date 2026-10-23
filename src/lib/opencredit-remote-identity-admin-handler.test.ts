import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule } from "./rate-limit";
import type { SessionUser } from "./auth";
import type { OpenCreditRemoteIdentityResult, OpenCreditRemoteIdentityServiceCode } from "./opencredit-remote-identity.service";

let boundary: typeof import("./opencredit-remote-identity-admin-handler");
let service: typeof import("./opencredit-remote-identity.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { boundary = await import("./opencredit-remote-identity-admin-handler"); service = await import("./opencredit-remote-identity.service"); }
  finally { loader._load = original; }
});
type Action = "claim" | "enable" | "disable";
const actor: SessionUser = { id: "admin", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const scope = "synthetic-scope" as Parameters<typeof service.claimOpenCreditRemoteIdentity>[1]["providerScope"];
function admin(session: SessionUser) {
  const old = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try { return requirePlatformAdmin(session); }
  finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
}
function fixture(action: Action = "claim", options: {
  session?: SessionUser | null; limited?: Response; limitThrows?: boolean; scopeThrows?: boolean;
  failure?: unknown; value?: OpenCreditRemoteIdentityResult;
} = {}) {
  const order: string[] = [], calls: unknown[] = [], rules: RateLimitRule[][] = [];
  const db = { $transaction: () => { throw Error("NO_DIRECT_DB_ACCESS"); } } as unknown as Parameters<typeof service.claimOpenCreditRemoteIdentity>[0];
  const command = async (database: unknown, input: unknown) => {
    assert.equal(database, db); order.push(action); calls.push(input);
    if (options.failure !== undefined) throw options.failure;
    return options.value ?? { changed: true, enabled: action === "claim", identityId: "private-access" };
  };
  return { order, calls, rules, handler: boundary.createOpenCreditRemoteIdentityAdminHandler(action, {
    db, getSession: async () => { order.push("session"); return options.session === undefined ? actor : options.session; },
    requirePlatformAdmin: s => { order.push("admin"); return admin(s); },
    enforceLimits: async r => { order.push("limit"); rules.push([...r]); if (options.limitThrows) throw Error("private"); return options.limited ?? null; },
    resolveScope: () => { order.push("scope"); if (options.scopeThrows) throw Error("private config"); return scope; },
    claim: command, enable: command, disable: command,
  }) };
}
function request(options: { body?: string | Uint8Array | ReadableStream<Uint8Array> | null; query?: string; headers?: Record<string, string | null | undefined> } = {}) {
  const headers = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [k, v] of Object.entries(options.headers ?? {})) { if (v === null) headers.delete(k); else if (v !== undefined) headers.set(k, v); }
  const body = options.body === undefined ? '{"companyId":"company","contactId":"contact"}' : options.body;
  const url = "https://crm.example.invalid/api/admin/integrations/opencredit/remote-identity/grant" + (options.query ?? "");
  const req = new NextRequest(url,
    { method: "POST", headers, body: body as BodyInit | null, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });
  // NextURL may normalize an empty search away; explicitly exercise raw-URL defense too.
  if (options.query === "?") Object.defineProperty(req, "url", { value: url });
  return req;
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: code });
}
for (const action of ["claim", "enable", "disable"] as const) {
  test(action + " unauthenticated before body", async () => {
    const f = fixture(action, { session: null }); await error(await f.handler(request({ body: "bad" })), 401, "UNAUTHENTICATED"); assert.deepEqual(f.order, ["session"]);
  });
  for (const session of [{ ...actor, role: "AGENT" as const }, { ...actor, companyId: "other" }]) test(action + " non-platform " + session.role + session.companyId, async () => {
    const f = fixture(action, { session }); await error(await f.handler(request()), 403, "FORBIDDEN"); assert.deepEqual(f.order, ["session", "admin"]);
  });
  for (const headers of [{ origin: null }, { origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) test(action + " invalid origin " + JSON.stringify(headers), async () => {
    const f = fixture(action); await error(await f.handler(request({ headers })), 403, "INVALID_ORIGIN"); assert.equal(f.rules.length, 0);
  });
  const invalid = [
    { query: "?" }, { query: "?companyId=other" }, { headers: { authorization: "" } },
    ...[null, "text/plain", "application/json; charset=latin1", "application/json; extra=1", "application/json; charset=utf-8; extra=1"].map(v => ({ headers: { "content-type": v } })),
    ...[null, "", "{}", "[]", "null", "true", "1", '"string"', "{", '{} trailing', '{"companyId":"a","companyId":"b"}',
      '{"companyId":"a","\\u0063ompanyId":"b"}', '{"companyId":"\\ud800"}', '\ufeff{"companyId":"company","contactId":"contact"}', " ".repeat(513)].map(body => ({ body })),
    { body: new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]) },
  ];
  invalid.forEach((options, i) => test(action + " invalid request " + i, async () => {
    const f = fixture(action); await error(await f.handler(request(options)), 400, "INVALID_REQUEST"); assert.equal(f.rules.length, 0); assert.equal(f.calls.length, 0);
  }));
  for (const companyId of [null, 1, false, [], {}, "", " space", "space ", "end\n", "a/b", "é", "_a", "-a", "a".repeat(129)]) test(action + " invalid company " + JSON.stringify(companyId), async () => {
    const f = fixture(action); await error(await f.handler(request({ body: JSON.stringify({ companyId, contactId: "contact" }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
  });
  for (const key of ["cpf", "normalizedCpf", "actor", "providerScope", "tenantId", "partnerId", "enabled", "identityId", "eventId", "credentials", "tokens", "action", "__proto__", "constructor", "prototype"]) test(action + " extra " + key, async () => {
    const f = fixture(action); await error(await f.handler(request({ body: JSON.stringify({ companyId: "company", contactId: "contact", [key]: "private" }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
  });
  for (const changed of [true, false]) test(action + " success/no-op " + changed + " closes output", async () => {
    const value = { changed, enabled: action === "claim", get identityId(): never { throw Error("must not read internal ID"); }, raw: "private" };
    const f = fixture(action, { value }); const response = await f.handler(request());
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, changed, enabled: action === "claim" });
    assert.deepEqual(f.calls, [{ actor, companyId: "company", contactId: "contact", providerScope: scope }]);
    assert.deepEqual(f.order, ["session", "admin", "limit", "scope", action]);
    assert.deepEqual(f.rules, [[
      { category: "opencredit-remote-identity-actor", identifiers: [actor.companyId, actor.id], limit: 10, windowMs: 60000 },
      { category: "opencredit-remote-identity-target", identifiers: ["company", "contact"], limit: 5, windowMs: 60000 },
    ]]);
  });
  for (const [options, code, status] of [
    [{ limited: new Response("private", { status: 429 }) }, "RATE_LIMITED", 429],
    [{ limited: new Response("private", { status: 503 }) }, "RATE_LIMIT_UNAVAILABLE", 503],
    [{ limitThrows: true }, "RATE_LIMIT_UNAVAILABLE", 503],
    [{ scopeThrows: true }, "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION", 503],
  ] as const) test(action + " fail-closed " + code, async () => {
    const f = fixture(action, options); await error(await f.handler(request()), status, code); assert.equal(f.calls.length, 0);
  });
  for (const [code, status] of Object.entries({ NOT_AUTHORIZED: 403, INVALID_COMPANY: 400, INVALID_CONTACT: 400, INVALID_PROVIDER_SCOPE: 400, COMPANY_NOT_FOUND: 409, CONTACT_NOT_FOUND: 409, CONTACT_ARCHIVED: 409, CONTACT_CPF_MISSING: 409, CONTACT_CPF_INVALID: 409, CONTACT_AMBIGUOUS: 409, COMMERCIAL_ACCESS_MISSING: 409, COMMERCIAL_ACCESS_DISABLED: 409, IDENTITY_NOT_FOUND: 409, OWNERSHIP_CONFLICT: 409, IDENTITY_SNAPSHOT_MISMATCH: 409, IDENTITY_CONFLICT: 409, CONCURRENT_CONFLICT: 409, STORAGE_ERROR: 503 })) test(action + " domain " + code, async () => {
    await error(await fixture(action, { failure: new service.OpenCreditRemoteIdentityServiceError(code as OpenCreditRemoteIdentityServiceCode) }).handler(request()), status, "OPENCREDIT_REMOTE_IDENTITY_" + code);
  });
}
test("module-independent Error contract retains mapping", async () => {
  const req = createRequire(import.meta.url), path = req.resolve("./opencredit-remote-identity.service.ts"), cached = req.cache[path];
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }, original = loader._load;
  try {
    delete req.cache[path]; loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
    const other = req(path) as typeof service;
    assert.notEqual(other.OpenCreditRemoteIdentityServiceError, service.OpenCreditRemoteIdentityServiceError);
    await error(await fixture("claim", { failure: new other.OpenCreditRemoteIdentityServiceError("COMPANY_NOT_FOUND") }).handler(request()), 409, "OPENCREDIT_REMOTE_IDENTITY_COMPANY_NOT_FOUND");
  } finally { loader._load = original; if (cached) req.cache[path] = cached; else delete req.cache[path]; }
});
for (const key of ["name", "code", "message"]) test("error getter never evaluated " + key, async () => {
  let reads = 0; const failure = new service.OpenCreditRemoteIdentityServiceError("STORAGE_ERROR");
  Object.defineProperty(failure, key, { get() { reads++; throw Error("private"); } });
  await error(await fixture("claim", { failure }).handler(request()), 503, "OPENCREDIT_REMOTE_IDENTITY_UNAVAILABLE"); assert.equal(reads, 0);
});
for (const failure of [new Error("private SQL password"), { code: "STORAGE_ERROR" }, "private", Object.assign(new Error("private"), { name: "OpenCreditRemoteIdentityServiceError", code: "toString" })]) test("raw error sanitized " + typeof failure, async () => {
  await error(await fixture("claim", { failure }).handler(request()), 503, "OPENCREDIT_REMOTE_IDENTITY_UNAVAILABLE");
});
for (const value of [{ changed: 1, enabled: true }, { changed: true, enabled: null }, {}, Object.defineProperty({ enabled: true }, "changed", { get() { assert.fail("getter"); } })]) test("invalid result fails closed " + Object.keys(value), async () => {
  await error(await fixture("claim", { value: value as OpenCreditRemoteIdentityResult }).handler(request()), 503, "OPENCREDIT_REMOTE_IDENTITY_UNAVAILABLE");
});
for (const retry of ["0", "12", "01", "-1", "1.5", "9007199254740992", "private"]) test("safe Retry-After " + retry, async () => {
  const response = await fixture("claim", { limited: new Response("private", { status: 429, headers: { "Retry-After": retry, "x-secret": "private" } }) }).handler(request());
  assert.equal(response.headers.get("retry-after"), ["0", "12"].includes(retry) ? retry : null); assert.equal(response.headers.get("x-secret"), null); await error(response, 429, "RATE_LIMITED");
});
test("actual byte cap ignores declared length; split valid body accepted", async () => {
  const raw = '{"companyId":"company","contactId":"contact"}'.padEnd(512, " "); assert.equal((await fixture().handler(request({ body: raw }))).status, 200);
  await error(await fixture().handler(request({ body: raw + " ", headers: { "content-length": "1" } })), 400, "INVALID_REQUEST");
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const b of Array.from(new TextEncoder().encode(raw))) c.enqueue(new Uint8Array([b])); c.close(); } });
  assert.equal((await fixture().handler(request({ body: stream }))).status, 200);
});
for (const action of ["claim", "enable", "disable"] as const) for (const mode of ["stall", "empty", "throw"] as const) test(action + " body deadline/reader failure " + mode, async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { if (mode === "empty") c.enqueue(new Uint8Array()); if (mode === "throw") c.error(Error("private")); },
    cancel() { cancelled = true; return new Promise(() => {}); },
  });
  const f = fixture(action), start = performance.now(); await error(await f.handler(request({ body: stream })), 400, "INVALID_REQUEST");
  assert(performance.now() - start < 2500); if (mode !== "throw") assert(cancelled); assert.equal(f.rules.length, 0);
});
for (const blocked of [0, 1]) test("shared limiter rule " + blocked + " blocks before scope and mutation", async () => {
  const old = process.env.RATE_LIMIT_SECRET; process.env.RATE_LIMIT_SECRET = "synthetic-only"; let increments = 0;
  try {
    const handler = boundary.createOpenCreditRemoteIdentityAdminHandler("claim", {
      db: {} as Parameters<typeof service.claimOpenCreditRemoteIdentity>[0], getSession: async () => actor, requirePlatformAdmin: admin,
      enforceLimits: async rules => { const decision = await consumeRateLimits(rules, { store: { increment: async ({ expiresAt }) => ({ count: increments++ === blocked ? rules[blocked].limit + 1 : 1, expiresAt }) }, shouldCleanup: () => false }); return decision.status === "allowed" ? null : rateLimitResponse(decision); },
      resolveScope: () => assert.fail("scope after limit"), claim: async () => assert.fail("mutation after limit"),
    });
    await error(await handler(request()), 429, "RATE_LIMITED"); assert.equal(increments, blocked + 1);
  } finally { if (old === undefined) delete process.env.RATE_LIMIT_SECRET; else process.env.RATE_LIMIT_SECRET = old; }
});

for (const action of ["claim", "enable", "disable"] as const) for (const contactId of [null, 1, "", " a", "a\n", "a/b", "é", [], {}, "a".repeat(129)]) test(action + " invalid contact " + JSON.stringify(contactId), async () => {
  const f = fixture(action); await error(await f.handler(request({ body: JSON.stringify({ companyId: "company", contactId }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
test("only three fixed routes compose the sole service mutation consumer", () => {
  const handler = "src/lib/opencredit-remote-identity-admin-handler.ts";
  const routes = ["claim", "enable", "disable"].map(a => `src/app/api/admin/integrations/opencredit/remote-identity/${a}/route.ts`);
  for (const dir of ["src", "scripts"]) for (const entry of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const path = dir + "/" + entry.replace(/\\/g, "/");
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path) || path.endsWith("opencredit-remote-identity.service.ts")) continue;
    const source = readFileSync(path, "utf8");
    if (path !== handler) assert.doesNotMatch(source, /opencredit-remote-identity\.service|claimOpenCreditRemoteIdentity|enableOpenCreditRemoteIdentity|disableOpenCreditRemoteIdentity/, path);
    if (path !== handler && !routes.includes(path)) assert.doesNotMatch(source, /opencredit-remote-identity-admin-handler|createOpenCreditRemoteIdentityAdminHandler/, path);
  }
  const source = readFileSync(handler, "utf8");
  assert.match(source, /^import "server-only";/);
  assert.doesNotMatch(source, /JSON\.parse|\bfetch\s*\(|console\.|process\.env|opencredit-api-client|commercial-operation|consumer-authorization|canonicalize|\.(findUnique|findMany|create|update|delete|\$transaction)\(/);
  assert.deepEqual(Object.keys(boundary), ["createOpenCreditRemoteIdentityAdminHandler"]);
  for (const [i, path] of Array.from(routes.entries())) {
    const text = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["@/lib/auth", "@/lib/permissions", "@/lib/rate-limit", "@/lib/db", "@/lib/opencredit-remote-identity-admin-handler"]);
    const calls: ts.CallExpression[] = []; const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); }; visit(ast);
    assert.equal(calls.length, 1); assert.match(calls[0].getText(ast), new RegExp('^createOpenCreditRemoteIdentityAdminHandler\\("' + ["claim", "enable", "disable"][i] + '"'));
    assert.match(text, /runtime = "nodejs"/); assert.match(text, /dynamic = "force-dynamic"/);
  }
});
