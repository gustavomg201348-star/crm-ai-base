import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitStore } from "./rate-limit";
import type { SessionUser } from "./auth";

let createClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let ApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
let createService: typeof import("./opencredit-authentication.service").createOpenCreditAuthenticationService;
let createHandler: typeof import("./opencredit-authentication.service").createOpenCreditAuthenticationHandler;
let AuthenticationError: typeof import("./opencredit-authentication.service").OpenCreditAuthenticationError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const client = await import("./opencredit-api-client");
    createClient = client.createOpenCreditApiClient; ApiError = client.OpenCreditApiError;
    const service = await import("./opencredit-authentication.service");
    createService = service.createOpenCreditAuthenticationService;
    createHandler = service.createOpenCreditAuthenticationHandler;
    AuthenticationError = service.OpenCreditAuthenticationError;
  } finally { loader._load = original; }
});

const creds = { email: "fixture@example.invalid", password: "fictitious-password" };
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", name: "Fixture", email: creds.email, role: "ADMIN" };
const pair = () => Response.json({ data: { accessToken: "fictitious-access", refreshToken: "fictitious-refresh", expiresIn: 28800 }, extra: "raw-sensitive-body" });
function platformCheck(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = admin.companyId;
  try { return requirePlatformAdmin(session); }
  finally {
    if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous;
  }
}
function request(options: { origin?: string | null; site?: string; body?: string; query?: string; bearer?: string; host?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://crm.example.invalid");
  if (options.site) headers.set("sec-fetch-site", options.site);
  if (options.bearer) headers.set("authorization", options.bearer);
  if (options.host) headers.set("host", options.host);
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/test-authentication${options.query ?? ""}`, {
    method: "POST", headers, body: options.body
  });
}
function fixture(options: { credentials?: typeof creds; session?: SessionUser | null; provider?: typeof fetch; limited?: Response } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const client = createClient({ credentials: () => options.credentials ?? creds, fetch: (async (url, init) => {
    calls.push({ url: String(url), init });
    assert.equal(String(url), "https://core.api.opencredit.tech/api/auth/login");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "omit");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return options.provider ? options.provider(url, init) : pair();
  }) as typeof fetch });
  const handler = createHandler({ getSession: async () => options.session === undefined ? admin : options.session,
    requirePlatformAdmin: platformCheck, enforceLimits: async rules => {
      assert.deepEqual(rules, [{ category: "opencredit-test-authentication", identifiers: [admin.companyId, admin.id], limit: 3, windowMs: 60000 }]);
      return options.limited ?? null;
    }, testAuthentication: createService({ client }) });
  return { handler, calls, client };
}
async function expectResponse(response: Response, status: number, body: object) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("x-provider-sensitive"), false);
  const text = await response.text();
  assert.doesNotMatch(text, /fictitious|raw-sensitive|example\.invalid|https?:|accessToken|refreshToken|password|Authorization|expiresIn|tenantId|partnerId/i);
  assert.deepEqual(JSON.parse(text), body);
}

test("valid login returns only ok, without tenant or partner configuration", async t => {
  const f = fixture(); t.after(() => f.client.dispose());
  await expectResponse(await f.handler(request({ body: "" })), 200, { ok: true });
  await expectResponse(await f.handler(request()), 200, { ok: true });
  assert.equal(f.calls.length, 2);
  assert.deepEqual(JSON.parse(String(f.calls[0].init?.body)), creds);
});
for (const status of [400, 401, 403, 404, 429, 500, 503]) test(`login HTTP ${status} exposes only sanitized code and real status`, async t => {
  const f = fixture({ provider: async () => new Response("raw-sensitive-body fictitious-password", { status, headers: { "x-provider-sensitive": "fictitious-access" } }) });
  t.after(() => f.client.dispose());
  const unavailable = status === 429 || status >= 500;
  await expectResponse(await f.handler(request()), unavailable ? 503 : 502,
    { error: `OPENCREDIT_AUTHENTICATION_${unavailable ? "PROVIDER_UNAVAILABLE" : "FAILED"}`, providerStatus: status });
  assert.equal(f.calls.length, 1);
});
for (const key of ["email", "password"] as const) test(`missing ${key} rejects before any provider request`, async t => {
  const f = fixture({ credentials: { ...creds, [key]: "  " } }); t.after(() => f.client.dispose());
  await expectResponse(await f.handler(request()), 503, { error: "OPENCREDIT_AUTHENTICATION_CONFIGURATION" });
  assert.equal(f.calls.length, 0);
});
for (const [label, value] of [
  ["invalid JSON", "{bad"], ["missing access", JSON.stringify({ data: { refreshToken: "fictitious-refresh", expiresIn: 28800 } })],
  ["missing refresh", JSON.stringify({ data: { accessToken: "fictitious-access", expiresIn: 28800 } })],
  ["invalid expires", JSON.stringify({ data: { accessToken: "fictitious-access", refreshToken: "fictitious-refresh", expiresIn: "28800" } })],
  ["zero expires", JSON.stringify({ data: { accessToken: "fictitious-access", refreshToken: "fictitious-refresh", expiresIn: 0 } })],
  ["oversized body", "x".repeat(17000)]
]) test(`login 200 with ${label} is invalid, without synthetic providerStatus`, async t => {
  const f = fixture({ provider: async () => new Response(value) }); t.after(() => f.client.dispose());
  await expectResponse(await f.handler(request()), 502, { error: "OPENCREDIT_AUTHENTICATION_INVALID_RESPONSE" });
});
test("network errors are sanitized and never retried", async t => {
  const f = fixture({ provider: async () => { throw new Error("raw-sensitive-body fictitious-password"); } }); t.after(() => f.client.dispose());
  await expectResponse(await f.handler(request()), 503, { error: "OPENCREDIT_AUTHENTICATION_NETWORK" });
  assert.equal(f.calls.length, 1);
});
test("login timeout retains the client deadline without retry or providerStatus", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ provider: async (_url, init) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("raw-sensitive-body")), { once: true });
  }) });
  try {
    const response = f.handler(request());
    for (let i = 0; i < 20; i++) await Promise.resolve();
    assert.equal(f.calls.length, 1);
    t.mock.timers.tick(10001);
    await expectResponse(await response, 503, { error: "OPENCREDIT_AUTHENTICATION_TIMEOUT" });
    assert.equal(f.calls.length, 1);
  } finally { f.client.dispose(); t.mock.timers.reset(); }
});
test("deadline also covers a stalled login response body", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture({ provider: async (_url, init) => new Response(new ReadableStream({ start(controller) {
    init?.signal?.addEventListener("abort", () => controller.error(new Error("raw-sensitive-body")), { once: true });
  } })) });
  try {
    const response = f.handler(request());
    for (let i = 0; i < 30; i++) await Promise.resolve();
    t.mock.timers.tick(10001);
    await expectResponse(await response, 503, { error: "OPENCREDIT_AUTHENTICATION_TIMEOUT" });
  } finally { f.client.dispose(); t.mock.timers.reset(); }
});
for (const options of [{ body: JSON.stringify(creds) }, { body: "{}" }, { body: " " }, { query: "?email=x" }, { bearer: "Bearer fictitious-access" }]) {
  test("browser payload, query or bearer rejected before provider", async t => {
    const f = fixture(); t.after(() => f.client.dispose());
    await expectResponse(await f.handler(request(options)), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
  });
}
for (const options of [{ origin: null }, { origin: "https://foreign.example.invalid" }, { site: "cross-site" }, { host: "user@crm.example.invalid" }]) {
  test("missing or foreign origin and cross-site requests fail closed", async t => {
    const f = fixture(); t.after(() => f.client.dispose());
    await expectResponse(await f.handler(request(options)), 403, { error: "INVALID_ORIGIN" }); assert.equal(f.calls.length, 0);
  });
}
for (const session of [null, { ...admin, companyId: "other-company" }, { ...admin, role: "AGENT" as const }]) {
  test("session and platform-only authorization enforced before provider", async t => {
    const f = fixture({ session }); t.after(() => f.client.dispose());
    await expectResponse(await f.handler(request()), session ? 403 : 401, { error: session ? "FORBIDDEN" : "UNAUTHENTICATED" });
    assert.equal(f.calls.length, 0);
  });
}
test("shared limiter blocks the fourth attempt and preserves tenant/user scope", async () => {
  const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "fictitious-limiter-secret";
  const counts = new Map<string, { count: number; start: number }>(); let calls = 0; let now = new Date(60000);
  const store: RateLimitStore = { async increment({ key, windowStart, expiresAt }) {
    const prior = counts.get(key);
    const count = prior?.start === windowStart.getTime() ? prior.count + 1 : 1;
    counts.set(key, { count, start: windowStart.getTime() }); return { count, expiresAt };
  } };
  const handlerFor = (session: SessionUser) => createHandler({ getSession: async () => session, requirePlatformAdmin: () => null,
    enforceLimits: async rules => {
      const result = await consumeRateLimits(rules, { store, now, shouldCleanup: () => false });
      return result.status === "allowed" ? null : rateLimitResponse(result);
    }, testAuthentication: async () => { calls++; } });
  try {
    const handler = handlerFor(admin);
    for (let i = 0; i < 3; i++) await expectResponse(await handler(request()), 200, { ok: true });
    const response = await handler(request()); assert.equal(response.headers.get("retry-after"), "60");
    await expectResponse(response, 429, { error: "RATE_LIMITED" }); assert.equal(calls, 3);
    await expectResponse(await handlerFor({ ...admin, id: "other-user" })(request()), 200, { ok: true });
    await expectResponse(await handlerFor({ ...admin, companyId: "other-company" })(request()), 200, { ok: true });
    now = new Date(120000);
    await expectResponse(await handler(request()), 200, { ok: true });
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
test("limiter unavailable prevents a login", async t => {
  const f = fixture({ limited: new Response("raw-sensitive-body", { status: 503 }) }); t.after(() => f.client.dispose());
  await expectResponse(await f.handler(request()), 503, { error: "RATE_LIMIT_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
});
test("unknown exceptions and invalid status metadata never leak", async () => {
  for (const error of [new Error("raw-sensitive-body fictitious-password"), ...[undefined, 99, 600, 400.5, NaN, "400"].map(s => new AuthenticationError("FAILED", 502, s as number))]) {
    const handler = createHandler({ getSession: async () => admin, requirePlatformAdmin: platformCheck, enforceLimits: async () => null,
      testAuthentication: async () => { throw error; } });
    await expectResponse(await handler(request()), error instanceof AuthenticationError ? 502 : 503,
      { error: `OPENCREDIT_AUTHENTICATION_${error instanceof AuthenticationError ? "FAILED" : "PROVIDER_UNAVAILABLE"}` });
  }
  await assert.rejects(createService({ client: { verifyCredentials: async () => { throw new ApiError("AUTH_FAILED"); } } })(),
    { code: "FAILED", status: 502, providerStatus: undefined });
});
test("route binds official session/permission/limiter and contains no domain mutations", () => {
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/test-authentication/route.ts", import.meta.url), "utf8");
  for (const symbol of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits", "export const POST"]) assert.ok(route.includes(symbol));
  const source = readFileSync(new URL("./opencredit-authentication.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.|safeLog|prisma\.|\.request\(|OPENCREDIT_TENANT|OPENCREDIT_PARTNER|\/banks|\.create\(|\.upsert\(|\.update\(|\.delete\(/);
});
