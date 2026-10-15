import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitStore, type RateLimitRule } from "./rate-limit";
import type { SessionUser } from "./auth";

let createClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let createService: typeof import("./opencredit-access-diagnostic.service").createOpenCreditAccessDiagnosticService;
let createHandler: typeof import("./opencredit-access-diagnostic.service").createOpenCreditAccessDiagnosticHandler;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    createClient = (await import("./opencredit-api-client")).createOpenCreditApiClient;
    const service = await import("./opencredit-access-diagnostic.service");
    createService = service.createOpenCreditAccessDiagnosticService; createHandler = service.createOpenCreditAccessDiagnosticHandler;
  } finally { loader._load = original; }
});

const creds = { email: "operator@example.invalid", password: "fake-password" };
const config = { OPENCREDIT_TENANT_ID: "tenant-fixture", OPENCREDIT_PARTNER_ID: "partner-fixture" };
const refresh = "private-refresh-fixture";
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", name: "Fixture", email: creds.email, role: "ADMIN" };
const jwt = (payload: unknown) => `${Buffer.from('{"alg":"fixture"}').toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.fixtureSignature`;
function platformCheck(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = admin.companyId;
  try { return requirePlatformAdmin(session); }
  finally { if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous; }
}
function request(options: { origin?: string | null; site?: string; body?: string; query?: string; bearer?: string; host?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://crm.example.invalid");
  if (options.site) headers.set("sec-fetch-site", options.site);
  if (options.bearer) headers.set("authorization", options.bearer);
  if (options.host) headers.set("host", options.host);
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/diagnose-access${options.query ?? ""}`, {
    method: "POST", headers, body: options.body
  });
}
type Options = {
  access?: string; credentials?: typeof creds; config?: typeof config; session?: SessionUser | null;
  login?: (init: RequestInit) => Response | Promise<Response>;
  probe?: (index: number, init: RequestInit) => Response | Promise<Response>;
  enforce?: (rules: readonly RateLimitRule[]) => Promise<Response | null>;
};
function fixture(options: Options = {}) {
  const access = options.access ?? "opaque-private-access-fixture";
  const calls: { url: URL; init: RequestInit }[] = [];
  let probeCount = 0; let clients = 0;
  const service = createService({ env: () => options.config ?? config, clientFactory: () => {
    clients++;
    return createClient({ credentials: () => options.credentials ?? creds, fetch: (async (url, init = {}) => {
      const target = new URL(String(url)); calls.push({ url: target, init });
      assert.equal(target.origin, "https://core.api.opencredit.tech");
      assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "omit");
      if (target.pathname === "/api/auth/login") {
        assert.equal(init.method, "POST"); assert.deepEqual(JSON.parse(String(init.body)), options.credentials ?? creds);
        assert.equal(new Headers(init.headers).has("authorization"), false);
        return options.login ? options.login(init) : Response.json({ data: { accessToken: access, refreshToken: refresh, expiresIn: 28800 } });
      }
      assert.equal(target.pathname, "/api/tenants/tenant-fixture/banks"); assert.equal(init.method, "GET");
      assert.equal(init.body, undefined); assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${access}`);
      return options.probe ? options.probe(probeCount++, init) : new Response("private-provider-body", { status: [404, 400, 400][probeCount++] });
    }) as typeof fetch });
  } });
  const handler = createHandler({ getSession: async () => options.session === undefined ? admin : options.session,
    requirePlatformAdmin: platformCheck, enforceLimits: options.enforce ?? (async rules => {
      assert.deepEqual(rules, [{ category: "opencredit-diagnose-access", identifiers: [admin.companyId, admin.id], limit: 2, windowMs: 60000 }]);
      return null;
    }), diagnoseAccess: service });
  return { handler, calls, service, clients: () => clients, access };
}
async function responseBody(response: Response, status = 200, access?: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  for (const secret of [creds.email, creds.password, refresh, "private-provider-body", "raw-private-error", access]) {
    if (secret) assert.ok(!text.includes(secret), "sensitive fixture must not be exposed");
  }
  assert.doesNotMatch(text, /accessToken|refreshToken|Authorization|set-cookie|location|https?:\/\//i);
  return JSON.parse(text);
}
const probes = { configured: { status: 404 }, missingPartnerId: { status: 400 }, missingProduct: { status: 400 } };

test("fresh JWT login and exactly three fixed GETs share one private access token", async () => {
  const f = fixture({ access: jwt({ role: "OPERATOR", tenantId: "tenant-fixture", partnerId: "partner-fixture",
    sub: "private-sub-fixture", email: creds.email, jti: "private-jti-fixture", name: "private-name-fixture", arbitrary: "private-extra-fixture", exp: 999999 }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body, { ok: true, authentication: { ok: true }, token: { format: "jwt", decodedOnly: true,
    role: { present: true, value: ["OPERATOR"] }, tenant: { present: true, value: "tenant-fixture" }, partner: { present: true, value: "partner-fixture" } },
    tenantMatchesConfigured: true, partnerMatchesConfigured: true, probes });
  assert.equal(f.calls.length, 4); assert.equal(f.clients(), 1);
  assert.deepEqual(f.calls.map(c => c.url.pathname), ["/api/auth/login", ...Array(3).fill("/api/tenants/tenant-fixture/banks")]);
  assert.deepEqual(f.calls.slice(1).map(c => c.url.search), ["?product=clt&partnerId=partner-fixture", "?product=clt", "?partnerId=partner-fixture"]);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 1);
  await responseBody(await f.handler(request()), 200, f.access);
  assert.equal(f.calls.filter(c => c.url.pathname === "/api/auth/login").length, 2); assert.equal(f.clients(), 2);
});
for (const token of ["opaque-private-access-fixture", "a.b", "a.b.c.d", "a.%%%.c",
  "a." + Buffer.from("not-json").toString("base64url") + ".c",
  jwt(null), jwt([]), jwt("invalid-payload"), "a._w.c"]) {
  test("opaque or malformed token never exposes claims", async () => {
    const f = fixture({ access: token });
    const body = await responseBody(await f.handler(request()), 200, token);
    assert.deepEqual(body.token, { format: "opaque" }); assert.equal(body.tenantMatchesConfigured, null); assert.equal(body.partnerMatchesConfigured, null);
    assert.deepEqual(body.probes, probes);
  });
}
test("missing claims are not invented from arbitrary token fields", async () => {
  const f = fixture({ access: jwt({ sub: "private-sub-fixture", email: creds.email, jti: "private-jti-fixture", companyId: "private-company-fixture", tenant: { id: "x" } }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.token, { format: "jwt", decodedOnly: true, role: { present: false }, tenant: { present: false }, partner: { present: false } });
  assert.equal(body.tenantMatchesConfigured, null); assert.equal(body.partnerMatchesConfigured, null);
});
for (const role of ["OPERATOR", ["OPERATOR", "PARTNER"], []]) test("role string/roles arrays are bounded and whitelisted", async () => {
  const f = fixture({ access: jwt({ roles: role }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.token.role, { present: true, value: typeof role === "string" ? [role] : role });
});
for (const role of ["x".repeat(65), ["x", 7], Array(11).fill("x"), "unsafe\nvalue", "<script>", null, {}, ""]) {
  test("invalid or excessive roles expose presence only", async () => {
    const f = fixture({ access: jwt({ role }) });
    const body = await responseBody(await f.handler(request()), 200, f.access);
    assert.deepEqual(body.token.role, { present: true });
  });
}
for (const [tenant, partner, expectedTenant, expectedPartner] of [
  ["tenant-fixture", "partner-fixture", "tenant-fixture", "partner-fixture"],
  [123, 456, "123", "456"], ["TENANT-fixture", "PARTNER-fixture", "TENANT-fixture", "PARTNER-fixture"]
]) test("safe tenant/partner aliases and safe integers are decoded without config fallback", async () => {
  const f = fixture({ access: jwt({ tenant_id: tenant, partner_id: partner }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.token.tenant, { present: true, value: expectedTenant });
  assert.deepEqual(body.token.partner, { present: true, value: expectedPartner });
  assert.equal(body.tenantMatchesConfigured, expectedTenant === config.OPENCREDIT_TENANT_ID);
  assert.equal(body.partnerMatchesConfigured, expectedPartner === config.OPENCREDIT_PARTNER_ID);
});
for (const value of ["../unsafe", "a".repeat(129), "<unsafe>", 1.5, Number.MAX_SAFE_INTEGER + 1, null, [], {}, ""]) {
  test("unsafe tenant/partner values reveal only presence", async () => {
    const f = fixture({ access: jwt({ tenantId: value, partnerId: value }) });
    const body = await responseBody(await f.handler(request()), 200, f.access);
    assert.deepEqual(body.token.tenant, { present: true }); assert.deepEqual(body.token.partner, { present: true });
    assert.equal(body.tenantMatchesConfigured, null); assert.equal(body.partnerMatchesConfigured, null);
  });
}
test("conflicting explicit claim aliases are not silently selected", async () => {
  const f = fixture({ access: jwt({ role: "OPERATOR", roles: ["ADMIN"], tenantId: "one", tenant_id: "two", partnerId: "one", partner_id: "<bad>" }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.token.role, { present: true }); assert.deepEqual(body.token.tenant, { present: true }); assert.deepEqual(body.token.partner, { present: true });
});
test("known credentials and refresh cannot leak even inside allowed claim names", async () => {
  const f = fixture({ access: jwt({ role: creds.password, tenantId: refresh, partnerId: creds.password }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.token.role, { present: true }); assert.deepEqual(body.token.tenant, { present: true }); assert.deepEqual(body.token.partner, { present: true });
});
test("probe 200 and 401 report facts without refresh, retry or body parsing", async () => {
  const cancelled: number[] = [];
  const f = fixture({ probe: index => new Response(new ReadableStream({ cancel() { cancelled.push(index); } }), {
    status: [200, 401, 403][index], headers: { "set-cookie": "private-provider-body", location: "private-provider-body", authorization: "private-provider-body", "x-extra": "private-provider-body" }
  }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.probes, { configured: { status: 200 }, missingPartnerId: { status: 401 }, missingProduct: { status: 403 } });
  assert.deepEqual(cancelled, [0, 1, 2]); assert.equal(f.calls.length, 4);
});
test("allowed correlation headers are selectively returned", async () => {
  const f = fixture({ probe: () => new Response(null, { status: 404, headers: {
    "x-request-id": "req-123", "x-correlation-id": "corr_456", "x-trace-id": "trace:789",
    traceparent: "00-12345678901234567890123456789012-1234567890123456-01", "x-unknown": "private-provider-body"
  } }) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.probes.configured, { status: 404, requestId: "req-123", correlationId: "corr_456", traceId: "trace:789", traceparent: "00-12345678901234567890123456789012-1234567890123456-01" });
});
for (const value of ["x".repeat(257), "<unsafe>", "opaque-private-access-fixture", refresh, creds.password, creds.email, "café"]) {
  test("invalid, long or sensitive correlation IDs are omitted", async () => {
    const f = fixture({ probe: () => new Response(null, { status: 404, headers: { "x-request-id": value } }) });
    const body = await responseBody(await f.handler(request()), 200, f.access);
    assert.deepEqual(body.probes.configured, { status: 404 });
  });
}
for (const status of [400, 401, 403, 404, 429, 500]) test("login failure returns sanitized authentication mapping and zero probes", async () => {
  const f = fixture({ login: () => new Response("raw-private-error", { status }) });
  const unavailable = status === 429 || status >= 500;
  assert.deepEqual(await responseBody(await f.handler(request()), unavailable ? 503 : 502, f.access),
    { error: `OPENCREDIT_AUTHENTICATION_${unavailable ? "PROVIDER_UNAVAILABLE" : "FAILED"}`, providerStatus: status });
  assert.equal(f.calls.length, 1);
});
test("invalid login response stops before probes without inventing status", async () => {
  const f = fixture({ login: () => Response.json({ data: { accessToken: "opaque" } }) });
  assert.deepEqual(await responseBody(await f.handler(request()), 502), { error: "OPENCREDIT_AUTHENTICATION_INVALID_RESPONSE" });
  assert.equal(f.calls.length, 1);
});
for (const key of ["OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"] as const) {
  for (const value of ["", "../bad", "x".repeat(129)]) test("missing/invalid configured IDs stop before login and probes", async () => {
    const f = fixture({ config: { ...config, [key]: value } });
    assert.deepEqual(await responseBody(await f.handler(request()), 503), { error: "OPENCREDIT_AUTHENTICATION_CONFIGURATION" });
    assert.equal(f.calls.length, 0); assert.equal(f.clients(), 0);
  });
}
for (const key of ["email", "password"] as const) test("missing credentials prevent all external calls", async () => {
  const f = fixture({ credentials: { ...creds, [key]: "" } });
  assert.deepEqual(await responseBody(await f.handler(request()), 503), { error: "OPENCREDIT_AUTHENTICATION_CONFIGURATION" });
  assert.equal(f.calls.length, 0);
});
test("probe network errors do not invent statuses, retry or expose exceptions", async () => {
  const f = fixture({ probe: () => { throw new Error("raw-private-error"); } });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.deepEqual(body.probes, { configured: { error: "NETWORK" }, missingPartnerId: { error: "NETWORK" }, missingProduct: { error: "NETWORK" } });
  assert.equal(f.calls.length, 4);
});
test("login network error is sanitized and does not run probes", async () => {
  const f = fixture({ login: () => { throw new Error("raw-private-error"); } });
  assert.deepEqual(await responseBody(await f.handler(request()), 503), { error: "OPENCREDIT_AUTHENTICATION_NETWORK" }); assert.equal(f.calls.length, 1);
});
test("login timeout stops before probes without synthetic provider status", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ login: init => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("raw-private-error")), { once: true });
  }) });
  try {
    const response = f.handler(request());
    for (let i = 0; i < 60; i++) await Promise.resolve();
    assert.equal(f.calls.length, 1); t.mock.timers.tick(10001);
    assert.deepEqual(await responseBody(await response, 503), { error: "OPENCREDIT_AUTHENTICATION_TIMEOUT" });
    assert.equal(f.calls.length, 1);
  } finally { t.mock.timers.reset(); }
});
test("each probe retains a ten-second timeout, without retries or made-up statuses", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ probe: (_index, init) => new Promise<Response>((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new Error("raw-private-error")), { once: true });
  }) });
  try {
    const response = f.handler(request());
    for (let p = 0; p < 3; p++) {
      for (let i = 0; i < 60; i++) await Promise.resolve();
      assert.equal(f.calls.length, p + 2); t.mock.timers.tick(10001);
    }
    const body = await responseBody(await response, 200, f.access);
    assert.deepEqual(body.probes, { configured: { error: "TIMEOUT" }, missingPartnerId: { error: "TIMEOUT" }, missingProduct: { error: "TIMEOUT" } });
    assert.equal(f.calls.length, 4);
  } finally { t.mock.timers.reset(); }
});
test("stalled probe body cancellation is not awaited or parsed", async () => {
  const f = fixture({ probe: () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })) });
  const body = await responseBody(await f.handler(request()), 200, f.access);
  assert.equal(body.probes.configured.status, 200); assert.equal(f.calls.length, 4);
});
for (const options of [{ body: "{}" }, { body: JSON.stringify(creds) }, { body: " " }, { query: "?tenantId=other" }, { bearer: "Bearer fake" }]) {
  test("browser cannot supply payload, query or authorization", async () => {
    const f = fixture(); assert.deepEqual(await responseBody(await f.handler(request(options)), 400), { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
  });
}
for (const options of [{ origin: null }, { origin: "https://foreign.example.invalid" }, { site: "cross-site" }, { host: "evil@crm.example.invalid" }]) {
  test("same-origin protection rejects missing/foreign origin and cross-site", async () => {
    const f = fixture(); assert.deepEqual(await responseBody(await f.handler(request(options)), 403), { error: "INVALID_ORIGIN" }); assert.equal(f.calls.length, 0);
  });
}
for (const session of [null, { ...admin, role: "AGENT" as const }, { ...admin, companyId: "another-company" }]) {
  test("only an authenticated platform administrator may run the diagnostic", async () => {
    const f = fixture({ session });
    assert.deepEqual(await responseBody(await f.handler(request()), session ? 403 : 401), { error: session ? "FORBIDDEN" : "UNAUTHENTICATED" });
    assert.equal(f.calls.length, 0);
  });
}
test("shared limiter permits two, blocks third, scopes by company/user and resets", async () => {
  const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "fake-limiter-secret";
  const rows = new Map<string, { count: number; start: number }>(); let now = new Date(60000);
  const store: RateLimitStore = { async increment({ key, windowStart, expiresAt }) {
    const previous = rows.get(key); const count = previous?.start === windowStart.getTime() ? previous.count + 1 : 1;
    rows.set(key, { count, start: windowStart.getTime() }); return { count, expiresAt };
  } };
  const enforce = async (rules: readonly RateLimitRule[]) => {
    const result = await consumeRateLimits(rules, { store, now, shouldCleanup: () => false });
    return result.status === "allowed" ? null : rateLimitResponse(result);
  };
  const f = fixture({ enforce });
  try {
    await responseBody(await f.handler(request()), 200, f.access); await responseBody(await f.handler(request()), 200, f.access);
    const response = await f.handler(request()); assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(await responseBody(response, 429), { error: "RATE_LIMITED" }); assert.equal(f.calls.length, 8);
    const other = fixture({ enforce, session: { ...admin, id: "another-user" } });
    await responseBody(await other.handler(request()), 200, other.access);
    // Store-level scope includes company; platform permission is tested independently.
    assert.equal((await consumeRateLimits([{ category: "opencredit-diagnose-access", identifiers: ["another-company", admin.id], limit: 2, windowMs: 60000 }], { store, now, shouldCleanup: () => false })).status, "allowed");
    now = new Date(120000); await responseBody(await f.handler(request()), 200, f.access);
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
test("limiter unavailable prevents all login/probe calls", async () => {
  const f = fixture({ enforce: async () => new Response("raw-private-error", { status: 503 }) });
  assert.deepEqual(await responseBody(await f.handler(request()), 503), { error: "RATE_LIMIT_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
});
test("disposal occurs on service failure and handler suppresses raw internal exceptions", async () => {
  let disposed = false;
  const service = createService({ env: () => config, clientFactory: () => ({ diagnoseAccess: async () => { throw new Error("raw-private-error"); }, dispose: () => { disposed = true; } }) });
  await assert.rejects(service(), { code: "PROVIDER_UNAVAILABLE" }); assert.equal(disposed, true);
  const handler = createHandler({ getSession: async () => { throw new Error("raw-private-error"); }, requirePlatformAdmin: platformCheck,
    enforceLimits: async () => null, diagnoseAccess: service });
  assert.deepEqual(await responseBody(await handler(request()), 503), { error: "OPENCREDIT_ACCESS_DIAGNOSTIC_UNAVAILABLE" });
});
test("thin route and diagnostic modules have no logging/domain mutations/refresh or generic request()", () => {
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/diagnose-access/route.ts", import.meta.url), "utf8");
  for (const name of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits", "export const POST"]) assert.ok(route.includes(name));
  for (const file of ["./opencredit-access-summary.ts", "./opencredit-access-diagnostic.service.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /console\.|safeLog|prisma\.|\.create\(|\.upsert\(|\.update\(|\.delete\(|\.request\(|\/auth\/refresh/);
    assert.match(source, /^import "server-only";/m);
  }
});
