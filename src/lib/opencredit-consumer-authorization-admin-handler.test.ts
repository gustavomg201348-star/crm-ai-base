import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule } from "./rate-limit";
import type { OpenCreditConsumerAuthorizationCode, OpenCreditConsumerAuthorizationResult } from "./opencredit-consumer-authorization.service";

let boundary: typeof import("./opencredit-consumer-authorization-admin-handler");
let domain: typeof import("./opencredit-consumer-authorization.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { boundary = await import("./opencredit-consumer-authorization-admin-handler"); domain = await import("./opencredit-consumer-authorization.service"); }
  finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
const scope = "synthetic-scope" as ReturnType<NonNullable<Parameters<typeof boundary.createOpenCreditConsumerAuthorizationAdminHandler>[1]["resolveScope"]>>;
const result = { changed: true, authorizationId: "auth", active: true, revision: 0 };
const payload = (action: "grant" | "revoke") => ({ companyId: "company", contactId: "contact", ...(action === "grant" ? { inboundEventId: "evidence" } : {}) });
function platform(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = actor.companyId;
  try { return requirePlatformAdmin(session); }
  finally { if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous; }
}
function fixture(action: "grant" | "revoke" = "grant", options: {
  session?: SessionUser | null; limited?: Response; limitThrows?: boolean; scopeThrows?: boolean;
  failure?: unknown; value?: OpenCreditConsumerAuthorizationResult;
} = {}) {
  const order: string[] = []; const rules: RateLimitRule[][] = []; const calls: unknown[] = [];
  const db = { $transaction: () => { throw new Error("HANDLER_MUST_NOT_QUERY_DB"); } } as unknown as Parameters<typeof domain.revokeOpenCreditConsumerAuthorization>[0];
  const command = async (database: unknown, input: unknown) => {
    assert.equal(database, db); order.push("command"); calls.push(input);
    if (options.failure !== undefined) throw options.failure;
    return options.value ?? result;
  };
  const handler = boundary.createOpenCreditConsumerAuthorizationAdminHandler(action, {
    db, getSession: async () => { order.push("session"); return options.session === undefined ? actor : options.session; },
    requirePlatformAdmin: session => { order.push("admin"); return platform(session); },
    enforceLimits: async r => { order.push("limit"); rules.push([...r]); if (options.limitThrows) throw new Error("sensitive"); return options.limited ?? null; },
    resolveScope: () => { order.push("scope"); if (options.scopeThrows) throw new Error("sensitive tenant/partner"); return scope; },
    grant: command, revoke: command,
  });
  return { handler, order, rules, calls };
}
function request(action: "grant" | "revoke" = "grant", options: {
  body?: string | Uint8Array | ReadableStream<Uint8Array> | null; query?: string; headers?: Record<string, string | null | undefined>;
} = {}) {
  const headers = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [key, value] of Object.entries(options.headers ?? {})) { if (value === null) headers.delete(key); else if (value !== undefined) headers.set(key, value); }
  const body = options.body === undefined ? JSON.stringify(payload(action)) : options.body;
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/consumer-authorization/${action}${options.query ?? ""}`,
    { method: "POST", headers, body: body as BodyInit | null, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: code });
}
for (const action of ["grant", "revoke"] as const) {
  test(action + " unauthenticated precedes body and origin", async () => {
    const f = fixture(action, { session: null }); await error(await f.handler(request(action, { body: "bad", headers: { origin: null } })), 401, "UNAUTHENTICATED");
    assert.deepEqual(f.order, ["session"]); assert.equal(f.calls.length, 0);
  });
  for (const session of [{ ...actor, role: "AGENT" as const }, { ...actor, companyId: "other" }]) {
    test(action + " rejects non-platform session " + session.companyId + session.role, async () => {
      const f = fixture(action, { session }); await error(await f.handler(request(action)), 403, "FORBIDDEN"); assert.deepEqual(f.order, ["session", "admin"]);
    });
  }
  for (const headers of [{ origin: null }, { origin: "https://other.example.invalid" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    test(action + " rejects origin " + JSON.stringify(headers), async () => { const f = fixture(action); await error(await f.handler(request(action, { headers })), 403, "INVALID_ORIGIN"); assert.equal(f.rules.length, 0); });
  }
  const invalidRequests = [
    { query: "?action=grant" }, { headers: { authorization: "Bearer sensitive" } },
    { headers: { "content-type": null } }, { headers: { "content-type": "text/plain" } },
    { headers: { "content-type": "application/json; charset=latin1" } }, { headers: { "content-type": "application/json; extra=1" } },
    ...[null, "", " ", "{", "{} trailing", "[]", "null", "true", "1", '"scalar"', '{"companyId":"a","companyId":"b"}',
      '{"companyId":"a","\\u0063ompanyId":"b"}', '{"companyId":"\\ud800"}', "[".repeat(65) + "0" + "]".repeat(65),
      JSON.stringify(payload(action)) + "x", " ".repeat(2049), "\ufeff" + JSON.stringify(payload(action))].map(body => ({ body })),
    { body: new Uint8Array([0x7b, 0xc3, 0x28, 0x7d]) },
  ];
  invalidRequests.forEach((options, i) => test(action + " invalid HTTP/strict body " + i, async () => {
    const f = fixture(action); await error(await f.handler(request(action, options)), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  }));
  for (const key of Object.keys(payload(action))) {
    test(action + " missing " + key, async () => {
      const p: Record<string, unknown> = payload(action); delete p[key]; const f = fixture(action);
      await error(await f.handler(request(action, { body: JSON.stringify(p) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
    });
    for (const value of [null, false, 1, [], {}, "", " x", "x ", "x\n", "x/1", "é", "x".repeat(129), "_x", "-x"]) {
      test(action + " invalid ID " + key + JSON.stringify(value), async () => { const f = fixture(action); await error(await f.handler(request(action, { body: JSON.stringify({ ...payload(action), [key]: value }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0); });
    }
  }
  for (const field of ["actor", "providerScope", "purpose", "consent", "authorized", "active", "revision", "authorizationId", "remoteIdentityId", "cpf", "messageId", "conversationId", "providerMessageId", "body", "legalBasis", "notes", "metadata", "tenantId", "partnerId", "action", "__proto__", ...(action === "revoke" ? ["inboundEventId"] : [])]) {
    test(action + " rejects forbidden extra " + field, async () => { const f = fixture(action); await error(await f.handler(request(action, { body: JSON.stringify({ ...payload(action), [field]: "sensitive" }) })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0); });
  }
  test(action + " exact actor, trusted scope, keys, ordering, rules and closed response", async () => {
    const f = fixture(action, { value: { ...result, extra: "sensitive" } as OpenCreditConsumerAuthorizationResult });
    const response = await f.handler(request(action, { headers: { "content-type": "application/json; charset=utf-8", "sec-fetch-site": "same-origin" } }));
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, ...result }); assert.deepEqual(f.order, ["session", "admin", "limit", "scope", "command"]);
    assert.equal(f.calls.length, 1); const input = f.calls[0] as { actor: SessionUser }; assert.equal(input.actor, actor);
    assert.deepEqual(input, { actor, ...payload(action), providerScope: scope });
    assert.deepEqual(f.rules, [[
      { category: "opencredit-consumer-authorization-actor", identifiers: [actor.companyId, actor.id, action], limit: 20, windowMs: 60000 },
      { category: "opencredit-consumer-authorization-target", identifiers: ["company", "contact", action], limit: 10, windowMs: 60000 },
    ]]);
  });
  for (const value of [{ ...result, changed: false }, { changed: false, authorizationId: null, active: false, revision: null }, { ...result, active: false, revision: 1 }]) {
    test(action + " explicit no-op/revoke result " + JSON.stringify(value), async () => {
      const response = await fixture(action, { value }).handler(request(action)); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, ...value });
    });
  }
  for (const [label, options, code] of [
    ["actor limited", { limited: new Response("sensitive", { status: 429 }) }, "RATE_LIMITED"],
    ["target limited", { limited: new Response("sensitive", { status: 429 }) }, "RATE_LIMITED"],
    ["limiter unavailable", { limited: new Response("sensitive", { status: 503 }) }, "RATE_LIMIT_UNAVAILABLE"],
    ["limiter throws", { limitThrows: true }, "RATE_LIMIT_UNAVAILABLE"],
    ["resolver fails", { scopeThrows: true }, "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION"],
  ] as const) {
    test(action + " " + label, async () => {
      const f = fixture(action, options); await error(await f.handler(request(action)), code === "RATE_LIMITED" ? 429 : 503, code); assert.equal(f.calls.length, 0);
      assert.equal(f.order.includes("scope"), label === "resolver fails");
    });
  }
}
const semantic: OpenCreditConsumerAuthorizationCode[] = ["COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CONTACT_ARCHIVED", "CONTACT_CPF_MISSING", "CONTACT_CPF_INVALID", "CONTACT_AMBIGUOUS", "COMMERCIAL_ACCESS_MISSING", "COMMERCIAL_ACCESS_DISABLED", "IDENTITY_NOT_FOUND", "IDENTITY_DISABLED", "IDENTITY_SNAPSHOT_MISMATCH", "IDENTITY_CONFLICT", "EVIDENCE_NOT_FOUND", "EVIDENCE_SCOPE_MISMATCH", "EVIDENCE_NOT_VERIFIED", "EVIDENCE_UNSUPPORTED", "AUTHORIZATION_CONFLICT", "CONCURRENT_CONFLICT"];
for (const action of ["grant", "revoke"] as const) for (const code of ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "INVALID_EVIDENCE", ...semantic, "STORAGE_ERROR"] as OpenCreditConsumerAuthorizationCode[]) {
  test(action + " closed service error " + code, async () => {
    const status = code === "NOT_AUTHORIZED" ? 403 : code.startsWith("INVALID_") ? 400 : code === "STORAGE_ERROR" ? 503 : 409;
    await error(await fixture(action, { failure: new domain.OpenCreditConsumerAuthorizationServiceError(code) }).handler(request(action)), status, "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code);
  });
}
for (const retry of ["0", "12", "-1", "1.5", "Infinity", "Wed, 01 Jan 2030 00:00:00 GMT", "9007199254740992", "01", "sensitive"]) {
  test("Retry-After strict integer only " + retry, async () => {
    const response = await fixture("grant", { limited: new Response("sensitive", { status: 429, headers: { "Retry-After": retry, "x-secret": "sensitive" } }) }).handler(request());
    assert.equal(response.headers.get("retry-after"), ["0", "12"].includes(retry) ? retry : null); assert.equal(response.headers.get("x-secret"), null);
    await error(response, 429, "RATE_LIMITED");
  });
}
for (const failure of [new Error("sensitive password body CPF"), { code: "P2002", meta: { sensitive: true } }, "sensitive"]) {
  test("unknown/raw storage exception sanitized " + typeof failure, async () => { await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE"); });
}
test("forged code/getter never leaks or executes", async () => {
  const failure = new domain.OpenCreditConsumerAuthorizationServiceError("STORAGE_ERROR");
  Object.defineProperty(failure, "code", { get() { assert.fail("getter invoked"); } });
  await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
  Object.defineProperty(failure, "code", { value: "toString" });
  await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
});

test("domain error from a separately loaded module instance retains all specific mappings", async () => {
  const require = createRequire(import.meta.url);
  const path = require.resolve("./opencredit-consumer-authorization.service.ts");
  const cached = require.cache[path];
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  let independent: typeof domain;
  try {
    delete require.cache[path];
    loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
    independent = require(path) as typeof domain;
  } finally {
    loader._load = original;
    if (cached) require.cache[path] = cached; else delete require.cache[path];
  }
  assert.notEqual(independent.OpenCreditConsumerAuthorizationServiceError, domain.OpenCreditConsumerAuthorizationServiceError);
  for (const action of ["grant", "revoke"] as const) for (const code of ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "INVALID_EVIDENCE", ...semantic, "STORAGE_ERROR"] as OpenCreditConsumerAuthorizationCode[]) {
    const failure = new independent.OpenCreditConsumerAuthorizationServiceError(code);
    assert(failure instanceof Error);
    assert.equal(failure instanceof domain.OpenCreditConsumerAuthorizationServiceError, false);
    const status = code === "NOT_AUTHORIZED" ? 403 : code.startsWith("INVALID_") ? 400 : code === "STORAGE_ERROR" ? 503 : 409;
    await error(await fixture(action, { failure }).handler(request(action)), status, "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code);
  }
});
function descriptorError(code = "COMPANY_NOT_FOUND") {
  return Object.defineProperties(new Error(), {
    name: { configurable: true, value: "OpenCreditConsumerAuthorizationServiceError" },
    code: { configurable: true, value: code },
    message: { configurable: true, value: "OPENCREDIT_CONSUMER_AUTHORIZATION_" + code },
  });
}
test("plain object with valid code or even all matching fields is not a domain Error", async () => {
  for (const failure of [{ code: "COMPANY_NOT_FOUND" }, { name: "OpenCreditConsumerAuthorizationServiceError", code: "COMPANY_NOT_FOUND", message: "OPENCREDIT_CONSUMER_AUTHORIZATION_COMPANY_NOT_FOUND" }]) {
    await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
  }
});
for (const key of ["name", "code", "message"] as const) {
  test("missing own data descriptor " + key + " fails closed", async () => {
    const failure = descriptorError(); delete (failure as unknown as Record<string, unknown>)[key];
    await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
  });
  test("getter for " + key + " is never invoked", async () => {
    let reads = 0; const failure = descriptorError(); Object.defineProperty(failure, key, { get() { reads++; throw new Error("sensitive"); } });
    await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE"); assert.equal(reads, 0);
  });
  test("setter-only descriptor for " + key + " is rejected", async () => {
    let writes = 0; const failure = descriptorError(); Object.defineProperty(failure, key, { set(_value: unknown) { writes++; } });
    await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE"); assert.equal(writes, 0);
  });
}
for (const [key, value] of [["name", "Error"], ["name", null], ["code", 409], ["message", "sensitive arbitrary provider body"], ["message", null]] as const) {
  test("mismatched error contract " + key + JSON.stringify(value), async () => {
    const failure = descriptorError(); Object.defineProperty(failure, key, { value });
    await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
  });
}
for (const code of ["toString", "__proto__", "constructor", "NOT_A_CODE", "COMPANY_NOT_FOUND\n"]) {
  test("forged non-own STATUS code rejected " + JSON.stringify(code), async () => {
    await error(await fixture("grant", { failure: descriptorError(code) }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
    assert.equal(Object.getPrototypeOf({}), Object.prototype);
  });
}
test("valid own descriptors map specifically without reading raw stack/cause/meta", async () => {
  let reads = 0; const failure = descriptorError();
  for (const key of ["stack", "cause", "meta"]) Object.defineProperty(failure, key, { get() { reads++; throw new Error("sensitive"); } });
  await error(await fixture("grant", { failure }).handler(request()), 409, "OPENCREDIT_CONSUMER_AUTHORIZATION_COMPANY_NOT_FOUND"); assert.equal(reads, 0);
});
test("wrong message and raw cause/meta/stack never appear in fallback", async () => {
  const failure = Object.assign(descriptorError(), { cause: "sensitive cause", meta: { password: "sensitive" } });
  Object.defineProperty(failure, "message", { value: "sensitive raw response" });
  await error(await fixture("grant", { failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE");
});
for (const value of [{ ...result, revision: -1 }, { ...result, authorizationId: {} }, { ...result, active: "true" }, { ...result, changed: 1 }, Object.defineProperty({ ...result }, "changed", { get() { assert.fail("getter invoked"); } })]) {
  test("invalid domain result sanitized " + Object.keys(value).join(), async () => { await error(await fixture("grant", { value: value as OpenCreditConsumerAuthorizationResult }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_UNAVAILABLE"); });
}
test("2048 actual bytes accepted, 2049 rejected despite forged length", async () => {
  const text = JSON.stringify(payload("grant"));
  const good = text.padEnd(2048, " "); assert.equal((await fixture().handler(request("grant", { body: good }))).status, 200);
  await error(await fixture().handler(request("grant", { body: good + " ", headers: { "content-length": "1" } })), 400, "INVALID_REQUEST");
  await error(await fixture().handler(request("grant", { body: text + "é".repeat(1000) })), 400, "INVALID_REQUEST");
});
test("split JSON chunks are decoded after bounded collection", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload("grant")));
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (const byte of Array.from(bytes)) c.enqueue(new Uint8Array([byte])); c.close(); } });
  assert.equal((await fixture().handler(request("grant", { body: stream }))).status, 200);
});
test("total read deadline rejects even valid prefix and nonsettling cancellation", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(payload("grant")))); }, cancel() { cancelled = true; return new Promise(() => {}); } });
  const f = fixture(); const started = performance.now();
  await error(await f.handler(request("grant", { body: stream })), 400, "INVALID_REQUEST");
  assert(performance.now() - started < 2500); assert(cancelled); assert.equal(f.calls.length, 0);
});
test("endless empty chunks cannot reset/starve total deadline", async () => {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array()); } }); const f = fixture();
  await error(await f.handler(request("grant", { body: stream })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0);
});
test("stream failure sanitized before rate limit", async () => {
  const f = fixture(); const stream = new ReadableStream<Uint8Array>({ start(c) { c.error(new Error("sensitive")); } });
  await error(await f.handler(request("grant", { body: stream })), 400, "INVALID_REQUEST"); assert.equal(f.rules.length, 0);
});

for (const action of ["grant", "revoke"] as const) for (const blockedIndex of [0, 1]) {
  test(`${action} shared limiter actually blocks rule ${blockedIndex} before scope/domain`, async () => {
    const previous = process.env.RATE_LIMIT_SECRET;
    process.env.RATE_LIMIT_SECRET = "synthetic-test-only";
    let increments = 0; let calls = 0;
    const db = {} as Parameters<typeof domain.revokeOpenCreditConsumerAuthorization>[0];
    const handler = boundary.createOpenCreditConsumerAuthorizationAdminHandler(action, {
      db, getSession: async () => actor, requirePlatformAdmin: platform,
      enforceLimits: async rules => {
        const decision = await consumeRateLimits(rules, { store: { increment: async ({ expiresAt }) => ({ count: increments++ === blockedIndex ? rules[blockedIndex].limit + 1 : 1, expiresAt }) }, shouldCleanup: () => false });
        return decision.status === "allowed" ? null : rateLimitResponse(decision);
      },
      resolveScope: () => { assert.fail("limited request must not resolve scope"); },
      grant: async () => { calls++; return result; }, revoke: async () => { calls++; return result; },
    });
    try { await error(await handler(request(action)), 429, "RATE_LIMITED"); assert.equal(calls, 0); assert.equal(increments, blockedIndex + 1); }
    finally { if (previous === undefined) delete process.env.RATE_LIMIT_SECRET; else process.env.RATE_LIMIT_SECRET = previous; }
  });
}

test("thin routes wire only existing session/admin/limiter/db and fixed command", () => {
  for (const action of ["grant", "revoke"]) {
    const path = `src/app/api/admin/integrations/opencredit/consumer-authorization/${action}/route.ts`;
    const source = readFileSync(path, "utf8"); const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["@/lib/auth", "@/lib/permissions", "@/lib/rate-limit", "@/lib/db", "@/lib/opencredit-consumer-authorization-admin-handler"]);
    const calls: ts.CallExpression[] = []; const visit = (n: ts.Node) => { if (ts.isCallExpression(n)) calls.push(n); ts.forEachChild(n, visit); }; visit(ast);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].getText(ast), `createOpenCreditConsumerAuthorizationAdminHandler("${action}", {\n  getSession: getSessionFromRequest, requirePlatformAdmin, enforceLimits: enforceRateLimits, db: prisma,\n})`);
    assert.match(source, /runtime = "nodejs"/); assert.match(source, /dynamic = "force-dynamic"/);
  }
});
test("server-only minimal HTTP boundary cannot perform domain queries, HTTP, automation or commercial operations", () => {
  const source = readFileSync("src/lib/opencredit-consumer-authorization-admin-handler.ts", "utf8");
  const ast = ts.createSourceFile("handler.ts", source, ts.ScriptTarget.Latest, true);
  assert.deepEqual(ast.statements.filter(ts.isImportDeclaration).map(n => (n.moduleSpecifier as ts.StringLiteral).text), ["server-only", "next/server", "./auth", "./rate-limit", "./opencredit-admin-request", "./opencredit-strict-json", "./opencredit-provider-scope-resolver", "./opencredit-consumer-authorization.service"]);
  assert.doesNotMatch(source, /JSON\.parse|\bfetch\s*\(|console\.|process\.env|\.message\b|\.cause\b|\.meta\b|opencredit-api-client|commercial-operation|\b(?:chatbot|OpenAI|axios|https?):|\.(?:findUnique|findMany|create|updateMany|\$transaction)\(/);
  assert.match(source, /deps\.grant \?\? grantOpenCreditConsumerAuthorizationFromInboundEvidence/);
  assert.match(source, /deps\.revoke \?\? revokeOpenCreditConsumerAuthorization/);
  assert.match(source, /deps\.resolveScope \?\? resolveConfiguredOpenCreditProviderScope/);
  assert.deepEqual(Object.keys(boundary), ["createOpenCreditConsumerAuthorizationAdminHandler"]);
});
test("only exact grant/revoke routes consume admin handler; no implicit inbound/AI/worker consumers", () => {
  const own = "src/lib/opencredit-consumer-authorization-admin-handler.ts";
  const allowed = ["grant", "revoke"].map(action => `src/app/api/admin/integrations/opencredit/consumer-authorization/${action}/route.ts`);
  for (const dir of ["src", "scripts"]) for (const file of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const path = dir + "/" + file.replace(/\\/g, "/");
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(?:test|integration)\./.test(path) || path === own || allowed.includes(path)) continue;
    assert.doesNotMatch(readFileSync(path, "utf8"), /opencredit-consumer-authorization-admin-handler|createOpenCreditConsumerAuthorizationAdminHandler/, path);
  }
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /tsx@4\.20\.6 --test src\/lib\/opencredit-consumer-authorization-admin-handler\.test\.ts/);
});
