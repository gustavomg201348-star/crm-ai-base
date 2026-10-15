import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule, type RateLimitStore } from "./rate-limit";
import type { SessionUser } from "./auth";

let createService: typeof import("./opencredit-list-banks.service").createOpenCreditListBanksService;
let createHandler: typeof import("./opencredit-list-banks.service").createOpenCreditListBanksHandler;
let createClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let ApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
let ConnectionError: typeof import("./opencredit-connection.service").OpenCreditConnectionError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const service = await import("./opencredit-list-banks.service");
    createService = service.createOpenCreditListBanksService; createHandler = service.createOpenCreditListBanksHandler;
    const client = await import("./opencredit-api-client");
    createClient = client.createOpenCreditApiClient; ApiError = client.OpenCreditApiError;
    ConnectionError = (await import("./opencredit-connection.service")).OpenCreditConnectionError;
  } finally { loader._load = original; }
});

const config = { OPENCREDIT_TENANT_ID: "tenant-fixture", OPENCREDIT_API_EMAIL: "fixture@example.invalid", OPENCREDIT_API_PASSWORD: "fictitious-password" };
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", email: config.OPENCREDIT_API_EMAIL, role: "ADMIN", name: "Fixture" };
const path = "/api/tenants/tenant-fixture/banks?product=clt";
const bank = { bankId: "bank-fixture", bankName: "Banco Fictício" };
const payload = (items: unknown) => Response.json({ data: { items } });
function platformCheck(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = admin.companyId;
  try { return requirePlatformAdmin(session); }
  finally { if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous; }
}
function request(options: { body?: string; query?: string; bearer?: string; origin?: string | null; site?: string; host?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://crm.example.invalid");
  if (options.site) headers.set("sec-fetch-site", options.site);
  if (options.bearer) headers.set("authorization", options.bearer);
  if (options.host) headers.set("host", options.host);
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/list-banks${options.query ?? ""}`,
    { method: "POST", headers, body: options.body });
}
function fixture(options: {
  env?: typeof config & { OPENCREDIT_PARTNER_ID?: string }; session?: SessionUser | null;
  provider?: () => Response | Promise<Response>; timeoutMs?: number; limitResponse?: Response;
} = {}) {
  const calls: { path: string; init?: RequestInit }[] = []; const rules: RateLimitRule[][] = [];
  const service = createService({ env: () => options.env ?? config, timeoutMs: options.timeoutMs,
    client: { request: async (p, init) => { calls.push({ path: p, init }); return options.provider ? options.provider() : payload([bank]); } } });
  const handler = createHandler({ getSession: async () => options.session === undefined ? admin : options.session, requirePlatformAdmin: platformCheck,
    enforceLimits: async r => { rules.push([...r]); return options.limitResponse ?? null; }, listBanks: service });
  return { calls, rules, handler };
}
async function check(response: Response, status: number, expected: object) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("x-provider-sensitive"), false);
  const text = await response.text();
  assert.doesNotMatch(text, /fictitious-password|private-provider|raw-provider|example\.invalid|accessToken|refreshToken|Authorization|https?:\/\//i);
  assert.deepEqual(JSON.parse(text), expected);
}
const invalid = { error: "OPENCREDIT_LIST_BANKS_INVALID_RESPONSE" };

test("one bank returns exactly the whitelist and a computed count", async () => {
  const f = fixture(); await check(await f.handler(request({ body: "" })), 200, { ok: true, count: 1, banks: [bank] });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, path);
  assert.equal(f.calls[0].init?.method, "GET"); assert.equal(f.calls[0].init?.body, undefined);
  assert.equal(new URL(f.calls[0].path, "https://example.invalid").searchParams.has("partnerId"), false);
  assert.deepEqual(f.rules[0], [{ category: "opencredit-list-banks", identifiers: [admin.companyId, admin.id], limit: 3, windowMs: 60000 }]);
});
test("multiple banks preserve provider order and discard every extra field", async () => {
  const extras = { accessToken: "private-provider-access", token: "private-provider-token", credentials: config,
    partner: "private-provider-partner", tenant: "private-provider-tenant", metadata: { secret: "private-provider-secret" },
    config, url: "https://example.invalid", secrets: ["private-provider-secret"], commission: 99, rates: [1], products: ["x"], permissions: ["all"] };
  const ordered = [{ bankId: "Z", bankName: "Zeta" }, { bankId: "A", bankName: "Alpha" }, { bankId: "M", bankName: "Meio" }];
  const f = fixture({ provider: () => Response.json({ data: { items: ordered.map(b => ({ ...b, ...extras })), ...extras }, ...extras }) });
  await check(await f.handler(request()), 200, { ok: true, count: ordered.length, banks: ordered });
});
test("empty array is valid and not replaced with synthetic banks", async () => {
  const f = fixture({ provider: () => payload([]) }); await check(await f.handler(request()), 200, { ok: true, count: 0, banks: [] });
});
test("one thousand unique small banks are accepted", async () => {
  const banks = Array.from({ length: 1000 }, (_, i) => ({ bankId: String(i), bankName: "B" }));
  const f = fixture({ provider: () => payload(banks) }); await check(await f.handler(request()), 200, { ok: true, count: 1000, banks });
});
for (const value of [null, 123, "", "../bad", "x".repeat(129), " bad", "é", "_bad"]) test("invalid bank IDs reject the entire list", async () => {
  const f = fixture({ provider: () => payload([bank, { ...bank, bankId: value }]) }); await check(await f.handler(request()), 502, invalid);
});
for (const value of [undefined, null, 123, "", "   ", "x".repeat(201)]) test("missing/invalid/oversized names fail closed without partial results", async () => {
  const f = fixture({ provider: () => payload([bank, { bankId: "another", bankName: value }]) }); await check(await f.handler(request()), 502, invalid);
});
test("name limit of 200 characters remains valid", async () => {
  const b = { ...bank, bankName: "x".repeat(200) };
  const f = fixture({ provider: () => payload([b]) }); await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [b] });
});
for (const items of [null, {}, "x", 5, [null], [[]], ["x"], [7]]) test("items must be an array of valid objects", async () => {
  const f = fixture({ provider: () => payload(items) }); await check(await f.handler(request()), 502, invalid);
});
for (const value of ["{bad", "null", "{}", '{"data":{}}']) test("invalid JSON or absent data/items returns a sanitized failure", async () => {
  const f = fixture({ provider: () => new Response(value) }); await check(await f.handler(request()), 502, invalid);
});
test("more than one thousand items are rejected even inside the byte budget", async () => {
  const items = Array.from({ length: 1001 }, (_, i) => ({ bankId: String(i), bankName: "B" }));
  assert.ok(Buffer.byteLength(JSON.stringify({ data: { items } })) < 65536);
  const f = fixture({ provider: () => payload(items) }); await check(await f.handler(request()), 502, invalid);
});
for (const name of [bank.bankName, "Different"]) test("duplicate bank IDs always reject, including identical names", async () => {
  const f = fixture({ provider: () => payload([bank, { ...bank, bankName: name }]) }); await check(await f.handler(request()), 502, invalid);
});
test("provider ID case and order are preserved without normalization", async () => {
  const banks = [{ bankId: "a", bankName: "lower" }, { bankId: "A", bankName: "upper" }];
  const f = fixture({ provider: () => payload(banks) }); await check(await f.handler(request()), 200, { ok: true, count: 2, banks });
});
test("exactly 64 KiB is accepted and a larger actual body is rejected", async () => {
  const f = fixture({ provider: () => new Response('{"data":{"items":[]}}'.padEnd(65536, " ")) });
  await check(await f.handler(request()), 200, { ok: true, count: 0, banks: [] });
  const large = fixture({ provider: () => new Response("x".repeat(65537), { headers: { "content-length": "1" } }) });
  await check(await large.handler(request()), 502, invalid);
});
test("oversized declared body is cancelled without reading it", async () => {
  let cancelled = false;
  const f = fixture({ provider: () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "65537" } }) });
  await check(await f.handler(request()), 502, invalid); assert.equal(cancelled, true);
});
for (const partner of [undefined, "", "../bad", "partner-fixture"]) test("partner configuration is neither required nor used in the URL", async () => {
  const f = fixture({ env: partner === undefined ? config : { ...config, OPENCREDIT_PARTNER_ID: partner } });
  await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [bank] }); assert.equal(f.calls[0].path, path);
});
for (const key of Object.keys(config) as (keyof typeof config)[]) test("required config missing blocks all provider calls", async () => {
  const f = fixture({ env: { ...config, [key]: "" } }); await check(await f.handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_CONFIGURATION" });
  assert.equal(f.calls.length, 0);
});
for (const value of ["../bad", "bad?product=inss", "https://example.invalid", "x".repeat(129)]) test("invalid configured tenant cannot change the path", async () => {
  const f = fixture({ env: { ...config, OPENCREDIT_TENANT_ID: value } });
  await check(await f.handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_CONFIGURATION" }); assert.equal(f.calls.length, 0);
});
for (const field of ["tenant", "partnerId", "product", "path", "url", "query", "method", "Authorization", "email", "password"]) {
  test("browser body cannot select any provider option", async () => {
    const f = fixture(); await check(await f.handler(request({ body: JSON.stringify({ [field]: "fictitious-input" }) })), 400, { error: "INVALID_REQUEST" });
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}
test("JSON empty object, query parameters and inbound bearer are all rejected", async () => {
  for (const r of [request({ body: "{}" }), request({ bearer: "Bearer private-provider-token" }),
    ...["tenant=x", "partnerId=x", "product=inss", "path=/x", "url=https://example.invalid", "query=x", "method=POST"].map(query => request({ query: `?${query}` }))]) {
    const f = fixture(); await check(await f.handler(r), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
  }
});
for (const session of [null, { ...admin, role: "AGENT" as const }, { ...admin, role: "SUPERVISOR" as const }, { ...admin, companyId: "foreign-company" }]) {
  test("session and real platform-admin policy are enforced before provider access", async () => {
    const f = fixture({ session }); await check(await f.handler(request()), session ? 403 : 401, { error: session ? "FORBIDDEN" : "UNAUTHENTICATED" });
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}
for (const options of [{ origin: null }, { origin: "null" }, { origin: "https://foreign.example.invalid" }, { site: "cross-site" }, { site: "same-site" }, { host: "evil@crm.example.invalid" }]) {
  test("invalid origin fails closed before limiter/provider", async () => {
    const f = fixture(); await check(await f.handler(request(options)), 403, { error: "INVALID_ORIGIN" }); assert.equal(f.calls.length, 0);
  });
}
test("same-origin follows public Host behind a proxy and ignores forwarded host", async () => {
  const f = fixture();
  const r = new NextRequest("https://127.0.0.1:8080/api/admin/integrations/opencredit/list-banks", { method: "POST", headers: {
    origin: "https://crm.example.invalid", host: "crm.example.invalid", "x-forwarded-host": "foreign.example.invalid"
  } });
  await check(await f.handler(r), 200, { ok: true, count: 1, banks: [bank] });
});
test("empty transport streams are accepted but stalled bodies are cancelled", async () => {
  const make = (body: ReadableStream) => new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/list-banks",
    { method: "POST", headers: { origin: "https://crm.example.invalid" }, body });
  const f = fixture(); await check(await f.handler(make(new ReadableStream({ start(c) { c.close(); } }))), 200, { ok: true, count: 1, banks: [bank] });
  let cancelled = false;
  const blocked = fixture(); await check(await blocked.handler(make(new ReadableStream({ cancel() { cancelled = true; } }))), 400, { error: "INVALID_REQUEST" });
  assert.equal(cancelled, true); assert.equal(blocked.calls.length, 0);
});
test("shared limiter scopes by company/user, blocks fourth and resets", async () => {
  const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "fictitious-rate-secret";
  const rows = new Map<string, { count: number; start: number }>(); let now = new Date(60000); let calls = 0;
  const store: RateLimitStore = { async increment({ key, windowStart, expiresAt }) {
    const previous = rows.get(key); const count = previous?.start === windowStart.getTime() ? previous.count + 1 : 1;
    rows.set(key, { count, start: windowStart.getTime() }); return { count, expiresAt };
  } };
  const make = (session: SessionUser) => createHandler({ getSession: async () => session, requirePlatformAdmin: () => null,
    enforceLimits: async rules => { const r = await consumeRateLimits(rules, { store, now, shouldCleanup: () => false }); return r.status === "allowed" ? null : rateLimitResponse(r); },
    listBanks: async () => { calls++; return [bank]; } });
  try {
    const handler = make(admin);
    for (let i = 0; i < 3; i++) await check(await handler(request()), 200, { ok: true, count: 1, banks: [bank] });
    const response = await handler(request()); assert.equal(response.headers.get("retry-after"), "60");
    await check(response, 429, { error: "RATE_LIMITED" }); assert.equal(calls, 3);
    for (const session of [{ ...admin, id: "other-user" }, { ...admin, companyId: "other-company" }]) await check(await make(session)(request()), 200, { ok: true, count: 1, banks: [bank] });
    now = new Date(120000); await check(await handler(request()), 200, { ok: true, count: 1, banks: [bank] });
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
test("limiter unavailable rejects without any provider call", async () => {
  const f = fixture({ limitResponse: new Response("raw-provider-error", { status: 503 }) });
  await check(await f.handler(request()), 503, { error: "RATE_LIMIT_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
});
for (const status of [400, 401, 403, 404, 429, 500, 503]) test("provider failure returns only code and known numeric status", async () => {
  const f = fixture({ provider: () => new Response("raw-provider-error", { status, headers: { "x-provider-sensitive": "private-provider-header" } }) });
  const unavailable = status === 429 || status >= 500;
  const code = unavailable ? "PROVIDER_UNAVAILABLE" : status === 401 || status === 403 ? "AUTHENTICATION" : "PROVIDER_FAILED";
  await check(await f.handler(request()), unavailable ? 503 : 502, { error: `OPENCREDIT_LIST_BANKS_${code}`, providerStatus: status }); assert.equal(f.calls.length, 1);
});
test("network failure never exposes raw exception or fake status", async () => {
  const f = fixture({ provider: () => { throw new Error("raw-provider-error fictitious-password"); } });
  await check(await f.handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_NETWORK" });
});
test("timeout covers pending client and stalled provider body", async () => {
  const pending = fixture({ timeoutMs: 20, provider: () => new Promise(() => {}) });
  await check(await pending.handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_TIMEOUT" });
  let cancelled = false;
  const stalled = fixture({ timeoutMs: 20, provider: () => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"data":')); }, cancel() { cancelled = true; }
  })) });
  await check(await stalled.handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_TIMEOUT" }); assert.equal(cancelled, true);
});
for (const [code, status] of [["CONFIGURATION", 503], ["TIMEOUT", 503], ["NETWORK", 503], ["INVALID_RESPONSE", 502], ["AUTH_FAILED", 502]] as const) {
  test("existing auth-client errors retain sanitized mapping", async () => {
    const f = fixture({ provider: () => { throw new ApiError(code); } });
    await check(await f.handler(request()), status, { error: `OPENCREDIT_LIST_BANKS_${code === "AUTH_FAILED" ? "AUTHENTICATION" : code}` });
  });
}
test("untrusted provider status metadata is never serialized", async () => {
  for (const value of [undefined, 99, 600, 400.5, NaN, "400"]) {
    const f = fixture({ provider: () => { throw new ConnectionError("PROVIDER_FAILED", 502, value as number); } });
    await check(await f.handler(request()), 502, { error: "OPENCREDIT_LIST_BANKS_PROVIDER_FAILED" });
  }
});
test("handler rebuilds its response rather than spreading service objects", async () => {
  const handler = createHandler({ getSession: async () => admin, requirePlatformAdmin: platformCheck, enforceLimits: async () => null,
    listBanks: async () => [{ ...bank, accessToken: "private-provider-access", credentials: config }] });
  await check(await handler(request()), 200, { ok: true, count: 1, banks: [bank] });
});
test("unknown internal errors are sanitized", async () => {
  const handler = createHandler({ getSession: async () => { throw new Error("raw-provider-error"); },
    requirePlatformAdmin: platformCheck, enforceLimits: async () => null, listBanks: async () => [] });
  await check(await handler(request()), 503, { error: "OPENCREDIT_LIST_BANKS_UNAVAILABLE" });
});
test("real client owns login/refresh/single GET retry; no commercial endpoint is called", async () => {
  const calls: { path: string; method: string }[] = []; let bankCalls = 0;
  const client = createClient({ credentials: () => ({ email: config.OPENCREDIT_API_EMAIL, password: config.OPENCREDIT_API_PASSWORD }),
    fetch: (async (url, init) => {
      const target = new URL(String(url)); calls.push({ path: target.pathname, method: init?.method ?? "GET" });
      assert.equal(target.origin, "https://core.api.opencredit.tech"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "omit");
      if (target.pathname === "/api/auth/login" || target.pathname === "/api/auth/refresh") return Response.json({ data: {
        accessToken: "private-provider-access", refreshToken: "private-provider-refresh", expiresIn: 28800
      } });
      assert.equal(target.pathname + target.search, path);
      return ++bankCalls === 1 ? new Response(null, { status: 401 }) : payload([bank]);
    }) as typeof fetch });
  try {
    assert.deepEqual(await createService({ client, env: () => config })(), [bank]);
    assert.deepEqual(calls, [
      { path: "/api/auth/login", method: "POST" }, { path: "/api/tenants/tenant-fixture/banks", method: "GET" },
      { path: "/api/auth/refresh", method: "POST" }, { path: "/api/tenants/tenant-fixture/banks", method: "GET" }
    ]);
  } finally { client.dispose(); }
});
test("thin route uses official auth and shared limiter; new modules have no functional writes or logs", () => {
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/list-banks/route.ts", import.meta.url), "utf8");
  for (const name of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits", "export const POST"]) assert.ok(route.includes(name));
  assert.doesNotMatch(route, /export const (GET|PUT|PATCH|DELETE)/);
  for (const file of ["./opencredit-list-banks.service.ts", "./opencredit-banks.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /^import "server-only";/m);
    assert.doesNotMatch(source, /console\.|safeLog|prisma\.|\.create\(|\.update\(|\.upsert\(|\.delete\(|OPENCREDIT_PARTNER/);
  }
});
