import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule } from "./rate-limit";
import type { SessionUser } from "./auth";
let boundary: typeof import("./opencredit-create-client-dispatch-admin-handler");
let domain: typeof import("./opencredit-commercial-operation.service");
let dispatcher: typeof import("./opencredit-create-client-dispatcher");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { boundary = await import("./opencredit-create-client-dispatch-admin-handler"); domain = await import("./opencredit-commercial-operation.service"); dispatcher = await import("./opencredit-create-client-dispatcher"); }
  finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
const body = { companyId: "company", contactId: "contact", commandId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const prepared = { changed: true, operationId: "operation", state: "PREPARED" as const, revision: 0 };
const dispatched = { operationId: "operation", state: "SUCCEEDED" as const, revision: 2, created: true };
const scope = "synthetic-scope" as ReturnType<typeof import("./opencredit-provider-scope-resolver").resolveConfiguredOpenCreditProviderScope>;
function fixture(options: { session?: SessionUser | null; limited?: Response; limitThrows?: boolean; scopeThrows?: boolean;
  failure?: unknown; prepared?: unknown; result?: unknown; limit?: (rules: readonly RateLimitRule[]) => Promise<Response | null> } = {}) {
  const order: string[] = [], calls: unknown[] = [], rules: RateLimitRule[][] = [], policies: unknown[] = [];
  const db = { $transaction: () => { throw Error("HANDLER_CANNOT_QUERY_DB"); } } as unknown as Parameters<typeof domain.prepareOpenCreditClientProfileOperation>[0];
  const handler = boundary.createOpenCreditCreateClientDispatchAdminHandler({
    db, getSession: async () => { order.push("session"); return options.session === undefined ? actor : options.session; },
    requirePlatformAdmin: session => {
      order.push("admin"); const old = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = actor.companyId;
      try { return requirePlatformAdmin(session); } finally { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; }
    },
    enforceLimits: async r => { order.push("limit"); rules.push([...r]); if (options.limitThrows) throw Error("private"); return options.limit ? options.limit(r) : options.limited ?? null; },
    resolveScope: () => { order.push("scope"); if (options.scopeThrows) throw Error("private"); return scope; },
    prepare: async (database, input, policy) => { order.push("prepare"); assert.equal(database, db); calls.push(input); policies.push(policy); if (options.failure !== undefined) throw options.failure; return (options.prepared ?? prepared) as typeof prepared; },
    dispatch: async (database, input, dispatchOptions) => { order.push("dispatch"); assert.equal(database, db); calls.push(input); policies.push(dispatchOptions?.phonePolicy); return (options.result ?? dispatched) as typeof dispatched; },
  });
  return { handler, order, calls, rules, policies };
}
function request(options: { body?: string | Uint8Array | ReadableStream<Uint8Array> | null; query?: string; headers?: Record<string, string | null | undefined> } = {}) {
  const headers = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [k, v] of Object.entries(options.headers ?? {})) { if (v === null) headers.delete(k); else if (v !== undefined) headers.set(k, v); }
  const value = options.body === undefined ? JSON.stringify(body) : options.body;
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/create-client/dispatch" + (options.query ?? ""), {
    method: "POST", headers, body: value as BodyInit | null, ...(value instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(await response.json(), { error: code });
}
for (const policy of [undefined, "include", "omit"] as const) test("explicit phone policy propagated to prepare and dispatch: " + policy, async () => {
  const f = fixture(); const value = { ...body, ...(policy === undefined ? {} : { phonePolicy: policy }) };
  const response = await f.handler(request({ body: JSON.stringify(value) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(f.policies, [policy ?? "include", policy ?? "include"]);
});
for (const policy of [null, "", "OMIT", "auto", 0, 1, true, {}, []]) test("invalid phone policy rejected before rate limits or writes: " + JSON.stringify(policy), async () => {
  const f = fixture(); await error(await f.handler(request({ body: JSON.stringify({ ...body, phonePolicy: policy }) })), 400, "INVALID_REQUEST");
  assert.equal(f.calls.length, 0); assert(!f.order.includes("limit"));
});
test("session and platform admin precede body reads", async () => {
  for (const session of [null, { ...actor, role: "OPERATOR" }, { ...actor, companyId: "other" }] as (SessionUser | null)[]) {
    const req = request(); let reads = 0; Object.defineProperty(req, "body", { get() { reads++; throw Error("private"); } });
    const f = fixture({ session }); await error(await f.handler(req), session ? 403 : 401, session ? "FORBIDDEN" : "UNAUTHENTICATED"); assert.equal(reads, 0); assert.equal(f.calls.length, 0);
  }
});
for (const headers of [{ origin: "https://evil.invalid" }, { origin: null }, { "sec-fetch-site": "same-site" }, { "sec-fetch-site": "cross-site" }]) test("reject origin " + JSON.stringify(headers), async () => {
  const f = fixture(); await error(await f.handler(request({ headers })), 403, "INVALID_ORIGIN"); assert.deepEqual(f.order, ["session", "admin"]);
});
for (const options of [{ query: "?x=1" }, { headers: { authorization: "" } }, { headers: { "content-type": null } }, { headers: { "content-type": "text/plain" } }, { headers: { "content-type": "application/json;foo=bar" } }]) test("HTTP contract " + JSON.stringify(options), async () => {
  const f = fixture(); await error(await f.handler(request(options)), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0); assert(!f.order.includes("limit"));
});
test("reject bare query delimiter if retained by the HTTP adapter", async () => {
  const req = request(); Object.defineProperty(req, "url", { value: req.url + "?" });
  await error(await fixture().handler(req), 400, "INVALID_REQUEST");
});
for (const raw of ["", "{}", "[]", "null", "true", "{", JSON.stringify(body) + "{}", "\uFEFF" + JSON.stringify(body),
  '{"companyId":"x","company\\u0049d":"company","contactId":"contact","commandId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
  JSON.stringify({ ...body, __proto__: null, constructor: "private" }), JSON.stringify({ ...body, prototype: {} }),
  '{"__proto__":{},"companyId":"company","contactId":"contact","commandId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}',
  ...Object.keys(body).map(key => JSON.stringify(Object.fromEntries(Object.entries(body).filter(([k]) => k !== key))))]) test("strict JSON rejects " + raw.slice(0, 55), async () => {
  const f = fixture(); await error(await f.handler(request({ body: raw })), 400, "INVALID_REQUEST"); assert(!f.order.includes("limit"));
});
for (const extra of ["tenantId", "partnerId", "providerScope", "operationId", "expectedRevision", "intentKey", "cpf", "phone", "email", "name", "profile", "profileJson", "authorizationId", "authorizationRevision", "authorizationEventId", "token", "headers", "path", "method", "created", "state", "revision", "actor"]) test("browser extra rejected " + extra, async () => {
  const f = fixture(); await error(await f.handler(request({ body: JSON.stringify({ ...body, [extra]: "private" }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
for (const key of ["companyId", "contactId"]) for (const value of ["", " x", "x ", "x\n", "á", "-x", "x".repeat(129), null, 1, [], {}]) test("strict ID " + key + " " + JSON.stringify(value), async () => {
  await error(await fixture().handler(request({ body: JSON.stringify({ ...body, [key]: value }) })), 400, "INVALID_REQUEST");
});
for (const value of [body.commandId.toUpperCase(), body.commandId + "\n", " " + body.commandId, body.commandId.replace("4aaa", "1aaa"), body.commandId.replace("4aaa", "3aaa"), body.commandId.replace("4aaa", "5aaa"), body.commandId.replace("8aaa", "7aaa"), null, 3, ""]) test("strict v4 " + JSON.stringify(value), async () => {
  await error(await fixture().handler(request({ body: JSON.stringify({ ...body, commandId: value }) })), 400, "INVALID_REQUEST");
});
test("real bytes not Content-Length bound body, UTF-8 fatal, no body", async () => {
  for (const options of [{ body: "x".repeat(2049), headers: { "content-length": "1" } }, { body: new Uint8Array([0xc3, 0x28]) }, { body: null }]) {
    const f = fixture(); await error(await f.handler(request(options)), 400, "INVALID_REQUEST"); assert(!f.order.includes("limit"));
  }
  const valid = request({ headers: { "content-length": "999999", "content-type": "application/json; charset=utf-8" } }); assert.equal((await fixture().handler(valid)).status, 200);
  const exact = JSON.stringify(body).padEnd(2048, " "); assert.equal((await fixture().handler(request({ body: exact }))).status, 200);
});
test("total deadline covers slow reads, empty chunks and stream failure", async () => {
  for (const mode of ["hung", "empty", "slow", "error"] as const) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (mode === "error") { controller.error(Error("private")); return; }
        if (mode === "empty") { controller.enqueue(new Uint8Array()); return; }
        if (mode === "slow") return new Promise<void>(resolve => setTimeout(() => { if (!cancelled) controller.enqueue(new Uint8Array([32])); resolve(); }, 350));
        return new Promise<void>(() => {});
      }, cancel() { cancelled = true; },
    });
    const f = fixture(), started = performance.now(); await error(await f.handler(request({ body: stream })), 400, "INVALID_REQUEST");
    assert(performance.now() - started < 1800); assert(!f.order.includes("limit"));
  }
});
test("exact composition actor, provider scope, intentKey and revision; closed output", async () => {
  for (const revision of [0, 7]) {
    const result = { ...dispatched, cpf: "private", token: "private" }; let reads = 0; Object.defineProperty(result, "raw", { get() { reads++; throw Error("private"); } });
    const f = fixture({ prepared: { ...prepared, revision }, result }); const response = await f.handler(request());
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, operationId: "operation", state: "SUCCEEDED", revision: 2, dispatched: true });
    assert.deepEqual(f.order, ["session", "admin", "limit", "scope", "prepare", "dispatch"]);
    assert.deepEqual(f.calls, [{ actor, companyId: body.companyId, contactId: body.contactId, providerScope: scope, intentKey: body.commandId },
      { actor, companyId: body.companyId, operationId: "operation", expectedRevision: revision }]);
    assert.equal((f.calls[0] as { actor: SessionUser }).actor, actor); assert.equal(reads, 0);
    assert.deepEqual(f.rules[0], [
      { category: "opencredit-create-client-dispatch-actor", identifiers: [actor.companyId, actor.id], limit: 10, windowMs: 60000 },
      { category: "opencredit-create-client-dispatch-target", identifiers: [body.companyId, body.contactId], limit: 3, windowMs: 60000 },
      { category: "opencredit-create-client-dispatch-command", identifiers: [body.companyId, body.commandId], limit: 3, windowMs: 60000 },
    ]);
  }
});
for (const state of ["IN_FLIGHT", "SUCCEEDED", "UNKNOWN"]) test("existing " + state + " returns snapshot, zero dispatch", async () => {
  const f = fixture({ prepared: { ...prepared, state, revision: 4 } });
  assert.deepEqual(await (await f.handler(request())).json(), { ok: true, operationId: "operation", state, revision: 4, dispatched: false }); assert(!f.order.includes("dispatch"));
});
for (const state of ["FAILED", "OTHER"]) test("closed conflict on " + state, async () => {
  const f = fixture({ prepared: { ...prepared, state } }); await error(await f.handler(request()), 409, "OPENCREDIT_COMMERCIAL_OPERATION_OPERATION_STATE_INVALID"); assert(!f.order.includes("dispatch"));
});
test("UNKNOWN dispatcher output is dispatched true", async () => {
  assert.deepEqual(await (await fixture({ result: { operationId: "operation", state: "UNKNOWN", revision: 2 } }).handler(request())).json(), { ok: true, operationId: "operation", state: "UNKNOWN", revision: 2, dispatched: true });
});
for (const key of ["operationId", "state", "revision"]) test("output accessor is never executed " + key, async () => {
  let reads = 0; const result = { ...prepared }; Object.defineProperty(result, key, { get() { reads++; throw Error("private"); } });
  await error(await fixture({ prepared: result }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_DISPATCH_UNAVAILABLE"); assert.equal(reads, 0);
});
for (const result of [{ ...dispatched, state: "IN_FLIGHT" }, { ...dispatched, operationId: "other" }, { ...dispatched, revision: -1 }, Object.create({ ...dispatched })]) test("invalid dispatcher result fails closed " + JSON.stringify(result), async () => {
  await error(await fixture({ result }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_DISPATCH_UNAVAILABLE");
});
for (const category of ["actor", "target", "command"]) test("independent real limiter " + category, async () => {
  const counts = new Map<string, number>();
  const store = { async increment({ key, expiresAt }: { key: string; expiresAt: Date }) {
    const count = (counts.get(key) ?? 0) + 1; counts.set(key, count); return { count, expiresAt };
  } };
  const f = fixture({ limit: async rules => {
    const rule = rules.find(r => r.category.endsWith("-" + category))!;
    const selected = { ...rule, category: rule.category + "-synthetic-test" };
    const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "synthetic-local-limiter-secret";
    try {
      for (let i = 0; i < rule.limit; i++) await consumeRateLimits([selected], { store, now: new Date(1000) });
      const decision = await consumeRateLimits([selected], { store, now: new Date(1000) });
      assert.equal(decision.status, "limited"); return rateLimitResponse(decision);
    } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
  } });
  await error(await f.handler(request()), 429, "RATE_LIMITED"); assert.equal(f.calls.length, 0); assert(!f.order.includes("scope"));
});
for (const retry of ["0", "12", "-1", "1.5", "01", "Infinity", "9007199254740992", "Wed, 01 Jan 2030 00:00:00 GMT"]) test("closed Retry-After " + retry, async () => {
  const response = await fixture({ limited: new Response("private", { status: 429, headers: { "retry-after": retry } }) }).handler(request());
  assert.equal(response.headers.get("retry-after"), ["0", "12"].includes(retry) ? retry : null); await error(response, 429, "RATE_LIMITED");
});
for (const options of [{ limitThrows: true }, { limited: new Response("private", { status: 503 }) }, { scopeThrows: true }]) test("fail closed before domain " + Object.keys(options), async () => {
  const f = fixture(options); await error(await f.handler(request()), 503, options.scopeThrows ? "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION" : "RATE_LIMIT_UNAVAILABLE"); assert.equal(f.calls.length, 0);
});
function independent<T>(specifier: string): T {
  const require = createRequire(import.meta.url), file = require.resolve(specifier), cached = require.cache[file];
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  try { delete require.cache[file]; loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a); return require(file); }
  finally { loader._load = original; if (cached) require.cache[file] = cached; else delete require.cache[file]; }
}
test("all dispatch codes from independent module have exact closed mapping", async () => {
  const other = independent<typeof dispatcher>("./opencredit-create-client-dispatcher.ts"); assert.notEqual(other.OpenCreditCreateClientDispatchError, dispatcher.OpenCreditCreateClientDispatchError);
  for (const code of ["INVALID_INPUT", "CONFIGURATION", "AUTHENTICATION", "PRE_DISPATCH_UNAVAILABLE", "SETTLEMENT_FAILED"] as const) {
    const failure = new other.OpenCreditCreateClientDispatchError(code); assert(!(failure instanceof dispatcher.OpenCreditCreateClientDispatchError));
    assert.equal(dispatcher.readOpenCreditCreateClientDispatchErrorCode(failure), code);
    await error(await fixture({ failure }).handler(request()), code === "INVALID_INPUT" ? 400 : 503, "OPENCREDIT_CREATE_CLIENT_DISPATCH_" + code);
  }
});
test("all domain codes from independent module preserve mapping", async () => {
  const other = independent<typeof domain>("./opencredit-commercial-operation.service.ts"); assert.notEqual(other.OpenCreditCommercialOperationServiceError, domain.OpenCreditCommercialOperationServiceError);
  const ast = ts.createSourceFile("domain.ts", readFileSync("src/lib/opencredit-commercial-operation.service.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(n => [...n.declarationList.declarations]).find(n => n.name.getText(ast) === "CODES")!.initializer!;
  assert(ts.isAsExpression(declaration) && ts.isArrayLiteralExpression(declaration.expression));
  for (const item of declaration.expression.elements) {
    assert(ts.isStringLiteral(item)); const code = item.text as import("./opencredit-commercial-operation.service").OpenCreditCommercialOperationServiceCode;
    const status = code === "NOT_AUTHORIZED" ? 403 : ["STORAGE_ERROR", "INVALID_OBSERVATION"].includes(code) ? 503 : code.startsWith("INVALID_") ? 400 : 409;
    await error(await fixture({ failure: new other.OpenCreditCommercialOperationServiceError(code) }).handler(request()), status, "OPENCREDIT_COMMERCIAL_OPERATION_" + code);
  }
});
test("plain, inherited, forged and accessor errors are not authority; no raw reads", async () => {
  let reads = 0;
  const failures: unknown[] = [{ name: "OpenCreditCreateClientDispatchError", code: "AUTHENTICATION", message: "OPENCREDIT_CREATE_CLIENT_DISPATCH_AUTHENTICATION" },
    Object.create(new dispatcher.OpenCreditCreateClientDispatchError("AUTHENTICATION")), Object.assign(new Error("wrong"), { name: "OpenCreditCreateClientDispatchError", code: "AUTHENTICATION" })];
  for (const code of ["__proto__", "constructor", "toString"]) failures.push(Object.assign(new Error("OPENCREDIT_CREATE_CLIENT_DISPATCH_" + code), { name: "OpenCreditCreateClientDispatchError", code }));
  for (const key of ["name", "code", "message"]) for (const descriptor of [{ get() { reads++; throw Error("private"); } }, { set(_v: unknown) { reads++; } }]) {
    const failure = new dispatcher.OpenCreditCreateClientDispatchError("AUTHENTICATION"); Object.defineProperty(failure, key, descriptor); failures.push(failure);
  }
  for (const failure of failures) await error(await fixture({ failure }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_DISPATCH_UNAVAILABLE");
  const legit = new dispatcher.OpenCreditCreateClientDispatchError("SETTLEMENT_FAILED");
  for (const key of ["stack", "cause", "body", "headers", "credentials"]) Object.defineProperty(legit, key, { get() { reads++; throw Error("private"); } });
  await error(await fixture({ failure: legit }).handler(request()), 503, "OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED"); assert.equal(reads, 0);
});

test("thin route and exact human-only runtime consumers, all import syntaxes/extensions", () => {
  const handler = "src/lib/opencredit-create-client-dispatch-admin-handler.ts", core = "src/lib/opencredit-create-client-dispatcher.ts";
  const route = "src/app/api/admin/integrations/opencredit/create-client/dispatch/route.ts";
  const text = readFileSync(handler, "utf8"); assert.match(text, /^import "server-only";/);
  assert.doesNotMatch(text, /JSON\.parse|console\.|logger|process\.env|\bfetch\b|opencredit-api-client|\.create\(|\.update\(|\.upsert\(|\.delete\(|instanceof OpenCredit/);
  assert.match(readFileSync(route, "utf8"), /export const runtime = "nodejs";[\s\S]*export const dynamic = "force-dynamic";/);
  assert.doesNotMatch(readFileSync(route, "utf8"), /dispatchOpenCredit|prepareOpenCredit|provider-scope/);
  assert.deepEqual(Object.keys(boundary), ["createOpenCreditCreateClientDispatchAdminHandler"]);
  assert.deepEqual(Object.keys(dispatcher).sort(), ["OpenCreditCreateClientDispatchError", "dispatchOpenCreditCreateClient", "readOpenCreditCreateClientDispatchErrorCode"].sort());
  const consumers: Record<string, string[]> = { "opencredit-create-client-dispatch-admin-handler": [], "opencredit-create-client-dispatcher": [] };
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/"); if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue;
    const source = readFileSync(path, "utf8"), ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteralLike(n)) for (const specifier of Object.keys(consumers)) if (new RegExp("(?:^|/)" + specifier + "(?:\\.[cm]?[jt]s)?$").test(n.text)) {
        consumers[specifier].push(path); assert.equal(path, specifier.endsWith("admin-handler") ? route : handler); assert(ts.isImportDeclaration(n.parent));
      }
      if (ts.isStringLiteralLike(n) && /(?:^|\/)opencredit-commercial-operation\.service(?:\.[cm]?[jt]s)?$/.test(n.text)) {
        assert([handler, core].includes(path)); assert(ts.isImportDeclaration(n.parent));
        if (path === handler) {
          const bindings = n.parent.importClause?.namedBindings; assert(bindings && ts.isNamedImports(bindings));
          assert.deepEqual(bindings.elements.map(e => e.name.text), ["prepareOpenCreditClientProfileOperation", "readOpenCreditCommercialOperationServiceErrorCode", "OpenCreditCommercialOperationServiceCode"]);
        }
      }
      if (ts.isStringLiteralLike(n) && /(?:^|\/)opencredit-provider-scope-resolver(?:\.[cm]?[jt]s)?$/.test(n.text)) {
        assert([handler, core, "src/lib/opencredit-commercial-access-admin-handler.ts", "src/lib/opencredit-remote-identity-admin-handler.ts", "src/lib/opencredit-remote-identity-context-admin-handler.ts", "src/lib/opencredit-commercial-access-context-admin-handler.ts", "src/lib/opencredit-consumer-authorization-admin-handler.ts", "src/lib/opencredit-consumer-authorization-context-admin-handler.ts", "src/lib/opencredit-create-client-context-admin-handler.ts", "src/lib/opencredit-create-client-reconciliation-context-admin-handler.ts", "src/lib/opencredit-client-validation.service.ts", "src/lib/opencredit-client-correction.service.ts", "src/lib/opencredit-clt-simulation.service.ts"].includes(path)); assert(ts.isImportDeclaration(n.parent));
      }
      if (ts.isIdentifier(n) && n.text === "prepareOpenCreditClientProfileOperation") assert([handler, "src/lib/opencredit-commercial-operation.service.ts"].includes(path));
      if (ts.isIdentifier(n) && n.text === "dispatchOpenCreditCreateClient") assert([handler, core].includes(path));
      ts.forEachChild(n, visit);
    }; visit(ast);
  }
  assert.deepEqual(consumers, { "opencredit-create-client-dispatch-admin-handler": [route], "opencredit-create-client-dispatcher": [handler] });
  for (const ext of ["", ".ts", ".js", ".cts", ".mts", ".cjs", ".mjs"]) for (const syntax of [`import x from "./opencredit-create-client-dispatcher${ext}"`, `require("./opencredit-create-client-dispatcher${ext}")`, `import("./opencredit-create-client-dispatcher${ext}")`, `export * from "./opencredit-create-client-dispatcher${ext}"`]) {
    let found = 0; const ast = ts.createSourceFile("synthetic.ts", syntax, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => { if (ts.isStringLiteralLike(n) && /(?:^|\/)opencredit-create-client-dispatcher(?:\.[cm]?[jt]s)?$/.test(n.text)) found++; ts.forEachChild(n, visit); }; visit(ast); assert.equal(found, 1);
  }
  const ci = readFileSync(".github/workflows/ci.yml", "utf8"); assert.match(ci, /tsx@4\.20\.6 --test src\/lib\/opencredit-create-client-dispatch-admin-handler.test.ts/); assert.match(ci, /OPENCREDIT_CREATE_CLIENT_ADMIN_POSTGRES_TEST: "1"/);
});
