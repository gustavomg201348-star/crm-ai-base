import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule, type RateLimitStore } from "./rate-limit";
import type { SessionUser } from "./auth";

let createService: typeof import("./opencredit-connection.service").createOpenCreditConnectionService;
let createHandler: typeof import("./opencredit-connection.service").createOpenCreditConnectionHandler;
let createClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let ApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
let ConnectionError: typeof import("./opencredit-connection.service").OpenCreditConnectionError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const service = await import("./opencredit-connection.service");
    createService = service.createOpenCreditConnectionService;
    createHandler = service.createOpenCreditConnectionHandler;
    ConnectionError = service.OpenCreditConnectionError;
    const client = await import("./opencredit-api-client");
    createClient = client.createOpenCreditApiClient;
    ApiError = client.OpenCreditApiError;
  } finally { loader._load = original; }
});

const config = {
  OPENCREDIT_TENANT_ID: "tenant-fixture",
  OPENCREDIT_API_EMAIL: "fixture@example.invalid", OPENCREDIT_API_PASSWORD: "fictitious-password"
};
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", name: "Fixture", email: "fixture@example.invalid", role: "ADMIN" };
const path = "/api/tenants/tenant-fixture/banks?product=clt";
const success = () => Response.json({ data: { items: [
  { bankId: "bank-fixture", bankName: "Fixture bank", accessToken: "fictitious-provider-token" }
] }, extraSensitiveField: "do-not-return" });

function platformCheck(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID;
  process.env.PLATFORM_COMPANY_ID = admin.companyId;
  try { return requirePlatformAdmin(session); }
  finally {
    if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID;
    else process.env.PLATFORM_COMPANY_ID = previous;
  }
}

function request(options: { origin?: string | null; site?: string; body?: string; query?: string; bearer?: string } = {}) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://crm.example.invalid");
  if (options.site) headers.set("sec-fetch-site", options.site);
  if (options.bearer) headers.set("authorization", options.bearer);
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/test-connection${options.query ?? ""}`, {
    method: "POST", headers, body: options.body
  });
}

function fixture(options: { env?: typeof config & { OPENCREDIT_PARTNER_ID?: string }; session?: SessionUser | null;
  provider?: () => Response | Promise<Response>; timeoutMs?: number; limitResponse?: Response } = {}) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const rules: RateLimitRule[][] = [];
  const service = createService({ env: () => options.env ?? config, timeoutMs: options.timeoutMs,
    client: { request: async (p, init) => { calls.push({ path: p, init }); return options.provider ? options.provider() : success(); } }
  });
  const handler = createHandler({
    getSession: async () => options.session === undefined ? admin : options.session,
    requirePlatformAdmin: platformCheck,
    enforceLimits: async r => { rules.push([...r]); return options.limitResponse ?? null; },
    testConnection: service
  });
  return { handler, service, calls, rules };
}

async function checkError(response: Response, status: number, providerStatus?: number) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  assert.doesNotMatch(text, /fictitious|do-not-return|example\.invalid|Bearer|stack|https?:\/\//);
  const body = JSON.parse(text);
  assert.deepEqual(Object.keys(body), providerStatus === undefined ? ["error"] : ["error", "providerStatus"]);
  if (providerStatus !== undefined) assert.equal(body.providerStatus, providerStatus);
}

test("platform admin success returns only ok and bankCount from a fixed GET", async () => {
  const f = fixture();
  const response = await f.handler(request({ site: "same-origin" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, bankCount: 1 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, path);
  assert.equal(new URL(f.calls[0].path, "https://example.invalid").searchParams.has("partnerId"), false);
  assert.equal(f.calls[0].init?.method, "GET");
  assert.equal(f.calls[0].init?.body, undefined);
  assert.deepEqual(f.rules[0], [{ category: "opencredit-test-connection", identifiers: [admin.companyId, admin.id], limit: 3, windowMs: 60000 }]);
});

for (const partner of [undefined, "", "partner-fixture", "../invalid-partner"]) {
  test("absent, empty, present or invalid partner configuration is irrelevant to the banks test", async () => {
    const f = fixture({ env: partner === undefined ? config : { ...config, OPENCREDIT_PARTNER_ID: partner } });
    const response = await f.handler(request());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { ok: true, bankCount: 1 });
    assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, path);
  });
}

test("banks test never reads the partner configuration", async () => {
  const f = fixture({ env: { ...config, get OPENCREDIT_PARTNER_ID(): string { throw new Error("must not read partner"); } } });
  assert.deepEqual(await (await f.handler(request())).json(), { ok: true, bankCount: 1 });
  assert.equal(f.calls[0].path, path);
});

for (const key of Object.keys(config) as (keyof typeof config)[]) test(`missing ${key} blocks all external requests`, async () => {
  const f = fixture({ env: { ...config, [key]: "" } });
  const response = await f.handler(request());
  assert.deepEqual(await response.clone().json(), { error: "OPENCREDIT_CONNECTION_CONFIGURATION" });
  await checkError(response, 503);
  assert.equal(f.calls.length, 0);
});

for (const value of ["../another", "tenant?x=1", "https://example.invalid", "partner&product=inss", " x", "x".repeat(129)]) {
  test(`invalid server identifier is rejected: ${value.length}`, async () => {
    const f = fixture({ env: { ...config, OPENCREDIT_TENANT_ID: value } });
    await checkError(await f.handler(request()), 503);
    assert.equal(f.calls.length, 0);
  });
}

for (const session of [null, { ...admin, role: "AGENT" as const }, { ...admin, role: "SUPERVISOR" as const }, { ...admin, companyId: "other-company" }]) {
  test(`session/real platform permission denies ${session?.role ?? "missing"}/${session?.companyId ?? "none"}`, async () => {
    const f = fixture({ session });
    await checkError(await f.handler(request()), session ? 403 : 401);
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}

for (const field of ["tenantId", "partnerId", "product", "query", "email", "password", "url", "path", "token", "accessToken"]) {
  test(`browser body cannot supply ${field}`, async () => {
    const f = fixture();
    await checkError(await f.handler(request({ body: JSON.stringify({ [field]: "fictitious-input" }) })), 400);
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}

test("JSON empty object, query configuration and inbound bearer are rejected", async () => {
  for (const r of [request({ body: "{}" }), request({ bearer: "Bearer fictitious-token" }),
    ...["tenantId=another", "partnerId=another", "product=inss", "path=other", "url=https://example.invalid", "query=external"]
      .map(query => request({ query: `?${query}` }))]) {
    const f = fixture(); await checkError(await f.handler(r), 400); assert.equal(f.calls.length, 0);
  }
});

test("actual empty POST stream is accepted; request body cannot stall forever", async () => {
  const empty = new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/test-connection", {
    method: "POST", headers: { origin: "https://crm.example.invalid" },
    body: new ReadableStream({ start(controller) { controller.close(); } })
  });
  const f = fixture(); assert.equal((await f.handler(empty)).status, 200);
  let cancelled = false;
  const stalled = new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/test-connection", {
    method: "POST", headers: { origin: "https://crm.example.invalid" },
    body: new ReadableStream({ cancel() { cancelled = true; } })
  });
  const blocked = fixture();
  await checkError(await blocked.handler(stalled), 400);
  assert.equal(cancelled, true); assert.equal(blocked.calls.length, 0); assert.equal(blocked.rules.length, 0);
});

test("missing, foreign, null and cross-site Origin are blocked before limiter/provider", async () => {
  for (const options of [{ origin: null }, { origin: "null" }, { origin: "https://foreign.example.invalid" }, { site: "cross-site" }, { site: "same-site" }]) {
    const f = fixture(); await checkError(await f.handler(request(options)), 403);
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  }
});

test("same-origin uses public Host behind proxy, never a spoofed X-Forwarded-Host", async () => {
  const make = (origin: string, host = "crm.example.invalid") => new NextRequest(
    "https://127.0.0.1:8080/api/admin/integrations/opencredit/test-connection", {
      method: "POST", headers: { origin, host, "x-forwarded-host": "foreign.example.invalid", "sec-fetch-site": "same-origin" }
    });
  const f = fixture();
  assert.equal((await f.handler(make("https://crm.example.invalid"))).status, 200);
  for (const r of [make("https://foreign.example.invalid"), make("http://crm.example.invalid"),
    make("https://crm.example.invalid", "user@crm.example.invalid")]) {
    await checkError(await f.handler(r), 403);
  }
  assert.equal(f.calls.length, 1);
});

test("real shared limiter with isolated in-memory store allows three, blocks fourth and resets", async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "fictitious-limiter-secret";
  const rows = new Map<string, { count: number; start: number }>();
  let now = new Date(60000);
  let requests = 0;
  const store: RateLimitStore = { async increment({ key, windowStart, expiresAt }) {
    const prior = rows.get(key);
    const count = prior?.start === windowStart.getTime() ? prior.count + 1 : 1;
    rows.set(key, { count, start: windowStart.getTime() });
    return { count, expiresAt };
  } };
  const make = (session: SessionUser) => createHandler({ getSession: async () => session, requirePlatformAdmin: platformCheck,
    enforceLimits: async rules => {
      const decision = await consumeRateLimits(rules, { store, now, shouldCleanup: () => false });
      return decision.status === "allowed" ? null : rateLimitResponse(decision);
    }, testConnection: async () => { requests++; return { ok: true, bankCount: 0 }; }
  });
  try {
    const handler = make(admin);
    for (let i = 0; i < 3; i++) assert.equal((await handler(request())).status, 200);
    const blocked = await handler(request());
    assert.equal(blocked.headers.get("retry-after"), "60"); await checkError(blocked, 429);
    assert.equal(requests, 3);
    assert.equal((await make({ ...admin, id: "another-admin" })(request())).status, 200);
    now = new Date(120000);
    assert.equal((await handler(request())).status, 200);
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});

test("limiter unavailable fails closed before provider", async () => {
  const f = fixture({ limitResponse: new Response("do-not-return", { status: 503 }) });
  await checkError(await f.handler(request()), 503); assert.equal(f.calls.length, 0);
});

for (const status of [400, 401, 403, 404, 429, 500, 503]) test(`provider HTTP ${status} has sanitized non-success response and no service retry`, async () => {
  const f = fixture({ provider: () => new Response("Bearer fictitious-token; fixture@example.invalid; do-not-return", {
    status, headers: { "x-provider-sensitive": "do-not-return" }
  }) });
  const response = await f.handler(request());
  const code = status === 401 || status === 403 ? "AUTHENTICATION"
    : status === 429 || status >= 500 ? "PROVIDER_UNAVAILABLE" : "PROVIDER_FAILED";
  assert.deepEqual(await response.clone().json(), { error: `OPENCREDIT_CONNECTION_${code}`, providerStatus: status });
  await checkError(response, status === 429 || status >= 500 ? 503 : 502, status);
  assert.equal(response.headers.has("x-provider-sensitive"), false); assert.equal(f.calls.length, 1);
});

for (const payload of ["{invalid", "null", '{"data":{}}', '{"data":{"items":[null]}}', '{"data":{"items":[{"bankId":"x"}]}}']) {
  test("malformed JSON/item structure fails closed", async () => {
    const f = fixture({ provider: () => new Response(payload) });
    await checkError(await f.handler(request()), 502);
  });
}

test("empty bank list is a valid result without synthetic banks", async () => {
  const f = fixture({ provider: () => Response.json({ data: { items: [] } }) });
  assert.deepEqual(await (await f.handler(request())).json(), { ok: true, bankCount: 0 });
});

test("shared banks reader preserves connection count semantics for repeated provider IDs", async () => {
  const f = fixture({ provider: () => Response.json({ data: { items: [
    { bankId: "same", bankName: "First" }, { bankId: "same", bankName: "Second", token: "do-not-return" }
  ] } }) });
  const response = await f.handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, bankCount: 2 });
});

test("real byte limit rejects streamed oversized body independently of Content-Length", async () => {
  const f = fixture({ provider: () => new Response("x".repeat(65537), { headers: { "content-length": "1" } }) });
  await checkError(await f.handler(request()), 502);
});

test("declared oversized body is cancelled before JSON parsing", async () => {
  let cancelled = false;
  const f = fixture({ provider: () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
    headers: { "content-length": "65537" }
  }) });
  await checkError(await f.handler(request()), 502); assert.equal(cancelled, true);
});

test("timeout covers stalled provider body and cancels reader", async () => {
  let cancelled = false;
  const f = fixture({ timeoutMs: 20, provider: () => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); },
    cancel() { cancelled = true; }
  })) });
  await checkError(await f.handler(request()), 503); assert.equal(cancelled, true);
});

test("total timeout covers stalled client and sanitizes late completion", async () => {
  let finish!: (response: Response) => void;
  const f = fixture({ timeoutMs: 20, provider: () => new Promise<Response>(resolve => { finish = resolve; }) });
  await checkError(await f.handler(request()), 503);
  finish(success()); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.calls.length, 1);
});

for (const code of ["CONFIGURATION", "AUTH_FAILED", "INVALID_RESPONSE", "TIMEOUT", "NETWORK"] as const) {
  test(`auth client error ${code} is mapped without raw details`, async () => {
    const f = fixture({ provider: () => { throw new ApiError(code, 401); } });
    await checkError(await f.handler(request()), code === "AUTH_FAILED" || code === "INVALID_RESPONSE" ? 502 : 503,
      code === "AUTH_FAILED" ? 401 : undefined);
  });
}

test("raw network errors never reach the response", async () => {
  const f = fixture({ provider: () => { throw new Error("fictitious-password https://internal.example.invalid stack do-not-return"); } });
  await checkError(await f.handler(request()), 503);
});

test("auth failure without a known HTTP status never invents providerStatus", async () => {
  const f = fixture({ provider: () => { throw new ApiError("AUTH_FAILED"); } });
  const response = await f.handler(request());
  assert.deepEqual(await response.clone().json(), { error: "OPENCREDIT_CONNECTION_AUTHENTICATION" });
  await checkError(response, 502);
});

test("invalid provider status metadata is never serialized", async () => {
  for (const status of [0, 99, 600, 999, 400.5, NaN, Infinity, "400"]) {
    const f = fixture({ provider: () => { throw new ConnectionError("PROVIDER_FAILED", 502, status as number); } });
    await checkError(await f.handler(request()), 502);
  }
});

test("actual auth client owns one refresh/retry; probe sends only banks GET and auth POSTs", async () => {
  const calls: { path: string; method: string }[] = [];
  let bankCalls = 0;
  const client = createClient({ credentials: () => ({ email: config.OPENCREDIT_API_EMAIL, password: config.OPENCREDIT_API_PASSWORD }),
    fetch: (async (url, init) => {
      const endpoint = new URL(String(url)).pathname;
      calls.push({ path: endpoint, method: init?.method ?? "GET" });
      if (endpoint === "/api/auth/login" || endpoint === "/api/auth/refresh") return Response.json({ data: {
        accessToken: "fictitious-access", refreshToken: "fictitious-refresh", expiresIn: 28800
      } });
      assert.equal(String(url), `https://core.api.opencredit.tech${path}`);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fictitious-access");
      return ++bankCalls === 1 ? new Response(null, { status: 401 }) : success();
    }) as typeof fetch
  });
  try {
    assert.deepEqual(await createService({ client, env: () => config })(), { ok: true, bankCount: 1 });
    assert.deepEqual(calls, [
      { path: "/api/auth/login", method: "POST" },
      { path: "/api/tenants/tenant-fixture/banks", method: "GET" },
      { path: "/api/auth/refresh", method: "POST" },
      { path: "/api/tenants/tenant-fixture/banks", method: "GET" }
    ]);
  } finally { client.dispose(); }
});

test("thin route uses official session, platform permission and shared limiter", () => {
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/test-connection/route.ts", import.meta.url), "utf8");
  assert.match(route, /getSessionFromRequest/); assert.match(route, /requirePlatformAdmin/); assert.match(route, /enforceRateLimits/);
  assert.match(route, /export const POST/);
  const source = readFileSync(new URL("./opencredit-connection.service.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/m);
  assert.doesNotMatch(source, /console\.|safeLog|prisma\.|\.create\(|\.update\(|\.upsert\(|\.delete\(/);
});
