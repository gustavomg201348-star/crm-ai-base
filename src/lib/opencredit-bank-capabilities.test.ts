import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule, type RateLimitStore } from "./rate-limit";
import type { SessionUser } from "./auth";

let createService: typeof import("./opencredit-bank-capabilities.service").createOpenCreditBankCapabilitiesService;
let createHandler: typeof import("./opencredit-bank-capabilities.service").createOpenCreditBankCapabilitiesHandler;
let createClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let ApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
let ConnectionError: typeof import("./opencredit-connection.service").OpenCreditConnectionError;
let parseFlags: typeof import("./opencredit-banks").parseOpenCreditCapabilities;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const service = await import("./opencredit-bank-capabilities.service");
    createService = service.createOpenCreditBankCapabilitiesService; createHandler = service.createOpenCreditBankCapabilitiesHandler;
    const client = await import("./opencredit-api-client"); createClient = client.createOpenCreditApiClient; ApiError = client.OpenCreditApiError;
    ConnectionError = (await import("./opencredit-connection.service")).OpenCreditConnectionError;
    parseFlags = (await import("./opencredit-banks")).parseOpenCreditCapabilities;
  } finally { loader._load = original; }
});
const keys = ["simulacaoAtiva", "digitacaoAtiva", "suportaParcela", "suportaLiquido", "aceitaChavePixReal", "somentePix", "exigeContatoEmpregador"] as const;
const config = { OPENCREDIT_TENANT_ID: "tenant-fixture", OPENCREDIT_API_EMAIL: "fixture@example.invalid", OPENCREDIT_API_PASSWORD: "fictitious-password" };
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", email: config.OPENCREDIT_API_EMAIL, name: "Fixture", role: "ADMIN" };
const bank = { bankId: "bank-fixture", bankName: "Banco Fictício" };
const path = "/api/tenants/tenant-fixture/banks?product=clt";
const data = (items: unknown) => Response.json({ data: { items } });
const emptyBank = { bankId: bank.bankId, bankName: bank.bankName, capabilities: {} };
const invalid = { error: "OPENCREDIT_BANK_CAPABILITIES_INVALID_RESPONSE" };
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
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/bank-capabilities${options.query ?? ""}`, { method: "POST", headers, body: options.body });
}
function fixture(options: {
  env?: typeof config & { OPENCREDIT_PARTNER_ID?: string }; session?: SessionUser | null;
  provider?: () => Response | Promise<Response>; timeoutMs?: number; limited?: Response;
} = {}) {
  const calls: { path: string; init?: RequestInit }[] = []; const rules: RateLimitRule[][] = [];
  const service = createService({ env: () => options.env ?? config, timeoutMs: options.timeoutMs,
    client: { request: async (p, init) => { calls.push({ path: p, init }); return options.provider ? options.provider() : data([bank]); } } });
  const handler = createHandler({ getSession: async () => options.session === undefined ? admin : options.session,
    requirePlatformAdmin: platformCheck, enforceLimits: async r => { rules.push([...r]); return options.limited ?? null; }, bankCapabilities: service });
  return { handler, calls, rules };
}
async function check(response: Response, status: number, expected: object) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("x-provider-sensitive"), false);
  const text = await response.text();
  assert.doesNotMatch(text, /fictitious-password|private-provider|raw-provider|example\.invalid|accessToken|refreshToken|Authorization|documentosExigidos|margemMaximaPercentual|valorParcelaMinima|valorLiberadoMinimo|valorLiberadoMaximo|valorPrincipalMinimo|suportaValorSolicitado|suportaPagamentoPix|https?:\/\//i);
  assert.deepEqual(JSON.parse(text), expected);
}
test("one bank with absent capabilities returns an empty object, not inferred false", async () => {
  const f = fixture(); await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [emptyBank] });
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].path, path); assert.equal(f.calls[0].init?.method, "GET"); assert.equal(f.calls[0].init?.body, undefined);
  assert.deepEqual(f.rules[0], [{ category: "opencredit-bank-capabilities", identifiers: [admin.companyId, admin.id], limit: 3, windowMs: 60000 }]);
});
test("all eight observed IDs retain provider order and independent capabilities", async () => {
  const ids = ["uy3", "fintech_corban", "v8", "c6_bank", "facta", "happy", "novosaque_clt", "vctex"];
  const items = ids.map((bankId, i) => ({ bankId, bankName: `Banco ${bankId}`, simulacaoAtiva: i % 2 === 0, digitacaoAtiva: false }));
  const f = fixture({ provider: () => data(items) });
  await check(await f.handler(request()), 200, { ok: true, count: items.length,
    banks: items.map(b => ({ bankId: b.bankId, bankName: b.bankName, capabilities: { simulacaoAtiva: b.simulacaoAtiva, digitacaoAtiva: false } })) });
});
test("empty list remains empty without a synthetic catalogue", async () => {
  const f = fixture({ provider: () => data([]) }); await check(await f.handler(request()), 200, { ok: true, count: 0, banks: [] });
});
for (const key of keys) for (const value of [true, false]) test(`own boolean ${key}=${value} is included without truthiness filtering`, async () => {
  const f = fixture({ provider: () => data([{ ...bank, [key]: value }]) });
  await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [{ ...bank, capabilities: { [key]: value } }] });
  const flags = parseFlags({ [key]: value });
  assert.equal(Object.hasOwn(flags!, key), true); assert.equal(flags![key], value);
  for (const other of keys.filter(k => k !== key)) assert.equal(Object.hasOwn(flags!, other), false);
});
for (const key of keys) for (const value of [null, "true", "false", 0, 1, [], {}]) test(`present non-boolean ${key} rejects the entire result`, async () => {
  const f = fixture({ provider: () => data([bank, { ...bank, bankId: "bad-item", [key]: value }]) });
  await check(await f.handler(request()), 502, invalid);
});
test("explicit undefined is invalid, inherited flags are absent and mixed true/false is retained", () => {
  for (const key of keys) assert.equal(parseFlags({ [key]: undefined }), undefined);
  assert.deepEqual(parseFlags(Object.create({ simulacaoAtiva: true, digitacaoAtiva: false })), {});
  assert.deepEqual(parseFlags({ simulacaoAtiva: true, digitacaoAtiva: false }), { simulacaoAtiva: true, digitacaoAtiva: false });
});
test("all excluded and unknown fields are discarded, not interpreted", async () => {
  const excluded = { documentosExigidos: [{ secret: "private-provider-doc" }], margemMaximaPercentual: 70, valorParcelaMinima: 5000,
    valorLiberadoMinimo: 100000, valorLiberadoMaximo: null, valorPrincipalMinimo: null, product: "clt", enabled: true,
    suportaValorSolicitado: true, suportaPagamentoPix: true, accessToken: "private-provider-access", refreshToken: "private-provider-refresh",
    token: "private-provider-token", credentials: config, tenant: "private-provider-tenant", partner: "private-provider-partner",
    partnerId: "private-provider-partner", metadata: config, config, segredo: "private-provider-secret", headers: config,
    url: "https://example.invalid", requestPayload: config, bankRaw: config, commission: 123, unknown: "private-provider-unknown" };
  const f = fixture({ provider: () => Response.json({ data: { items: [{ ...bank, ...excluded, somentePix: false }], ...excluded }, ...excluded }) });
  await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [{ ...bank, capabilities: { somentePix: false } }] });
});
test("nested provider capabilities do not replace the documented flat source location", async () => {
  const f = fixture({ provider: () => data([{ ...bank, capabilities: { simulacaoAtiva: true, digitacaoAtiva: true } }]) });
  await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [emptyBank] });
});
for (const item of [null, [], "bad", { bankId: "../bad", bankName: "B" }, { bankId: "x".repeat(129), bankName: "B" },
  { bankId: "ok", bankName: "" }, { bankId: "ok", bankName: "x".repeat(201) }]) test("invalid mandatory identity rejects all banks", async () => {
  const f = fixture({ provider: () => data([bank, item]) }); await check(await f.handler(request()), 502, invalid);
});
for (const raw of ["null", "{bad", "{}", '{"data":{}}', '{"data":{"items":null}}', '{"data":{"items":{}}}']) {
  test("invalid JSON/data/items fails closed", async () => { const f = fixture({ provider: () => new Response(raw) }); await check(await f.handler(request()), 502, invalid); });
}
for (const name of [bank.bankName, "Another"]) test("duplicate exact IDs reject even with matching names", async () => {
  const f = fixture({ provider: () => data([bank, { ...bank, bankName: name }]) }); await check(await f.handler(request()), 502, invalid);
});
test("one thousand banks accepted, one thousand and one rejected within byte budget", async () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ bankId: String(i), bankName: "B" }));
  const f = fixture({ provider: () => data(items) });
  await check(await f.handler(request()), 200, { ok: true, count: 1000, banks: items.map(b => ({ ...b, capabilities: {} })) });
  const extra = [...items, { bankId: "1000", bankName: "B" }];
  assert.ok(Buffer.byteLength(JSON.stringify({ data: { items: extra } })) < 65536);
  await check(await fixture({ provider: () => data(extra) }).handler(request()), 502, invalid);
});
test("exact byte cap is preserved and oversized actual/declared responses reject", async () => {
  const exact = fixture({ provider: () => new Response('{"data":{"items":[]}}'.padEnd(65536, " ")) });
  await check(await exact.handler(request()), 200, { ok: true, count: 0, banks: [] });
  const large = fixture({ provider: () => new Response("x".repeat(65537), { headers: { "content-length": "1" } }) });
  await check(await large.handler(request()), 502, invalid);
  let cancelled = false;
  const declared = fixture({ provider: () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "content-length": "65537" } }) });
  await check(await declared.handler(request()), 502, invalid); assert.equal(cancelled, true);
});
test("partner setting is never read and never sent", async () => {
  const f = fixture({ env: { ...config, get OPENCREDIT_PARTNER_ID(): string { throw new Error("must not read partner"); } } });
  await check(await f.handler(request()), 200, { ok: true, count: 1, banks: [emptyBank] }); assert.equal(f.calls[0].path, path);
  assert.equal(new URL(f.calls[0].path, "https://example.invalid").searchParams.has("partnerId"), false);
});
for (const key of Object.keys(config) as (keyof typeof config)[]) test("missing configuration blocks external calls", async () => {
  const f = fixture({ env: { ...config, [key]: "" } });
  await check(await f.handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_CONFIGURATION" }); assert.equal(f.calls.length, 0);
});
test("invalid configured tenant cannot choose an alternate endpoint", async () => {
  for (const tenant of ["../bad", "x?product=other", "https://example.invalid"]) {
    const f = fixture({ env: { ...config, OPENCREDIT_TENANT_ID: tenant } });
    await check(await f.handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_CONFIGURATION" }); assert.equal(f.calls.length, 0);
  }
});
for (const field of ["tenant", "bankId", "product", "partnerId", "path", "url", "query", "method", "Authorization"]) {
  test("browser cannot supply provider options through the body", async () => {
    const f = fixture(); await check(await f.handler(request({ body: JSON.stringify({ [field]: "fictitious-input" }) })), 400, { error: "INVALID_REQUEST" });
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}
test("JSON empty object, whitespace, query and inbound authorization reject", async () => {
  for (const r of [request({ body: "{}" }), request({ body: " " }), request({ bearer: "Bearer private-provider-token" }),
    ...["tenant=x", "bankId=x", "product=inss", "partnerId=x", "path=x", "url=x", "query=x", "method=GET"].map(query => request({ query: `?${query}` }))]) {
    const f = fixture(); await check(await f.handler(r), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
  }
});
for (const session of [null, { ...admin, role: "AGENT" as const }, { ...admin, role: "SUPERVISOR" as const }, { ...admin, companyId: "foreign-company" }]) {
  test("official platform-admin policy denies unauthenticated and other company callers", async () => {
    const f = fixture({ session }); await check(await f.handler(request()), session ? 403 : 401, { error: session ? "FORBIDDEN" : "UNAUTHENTICATED" });
    assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0);
  });
}
for (const options of [{ origin: null }, { origin: "null" }, { origin: "https://foreign.example.invalid" }, { site: "cross-site" }, { site: "same-site" }, { host: "evil@crm.example.invalid" }]) {
  test("same-origin checks fail closed", async () => { const f = fixture(); await check(await f.handler(request(options)), 403, { error: "INVALID_ORIGIN" }); assert.equal(f.calls.length, 0); });
}
test("same-origin follows public Host, not forwarded Host", async () => {
  const f = fixture();
  const r = new NextRequest("https://127.0.0.1:8080/api/admin/integrations/opencredit/bank-capabilities", { method: "POST", headers: {
    origin: "https://crm.example.invalid", host: "crm.example.invalid", "x-forwarded-host": "foreign.example.invalid"
  } });
  await check(await f.handler(r), 200, { ok: true, count: 1, banks: [emptyBank] });
});
test("zero-byte streams accepted, stalled request body cancelled", async () => {
  const make = (body: ReadableStream) => new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/bank-capabilities",
    { method: "POST", headers: { origin: "https://crm.example.invalid" }, body });
  await check(await fixture().handler(make(new ReadableStream({ start(c) { c.close(); } }))), 200, { ok: true, count: 1, banks: [emptyBank] });
  let cancelled = false; const blocked = fixture();
  await check(await blocked.handler(make(new ReadableStream({ cancel() { cancelled = true; } }))), 400, { error: "INVALID_REQUEST" });
  assert.equal(cancelled, true); assert.equal(blocked.calls.length, 0);
});
test("shared limiter allows three, blocks fourth, scopes by company/user and resets", async () => {
  const previous = process.env.AUTH_SECRET; process.env.AUTH_SECRET = "fictitious-rate-secret";
  const rows = new Map<string, { count: number; start: number }>(); let now = new Date(60000); let calls = 0;
  const store: RateLimitStore = { async increment({ key, windowStart, expiresAt }) {
    const prior = rows.get(key); const count = prior?.start === windowStart.getTime() ? prior.count + 1 : 1;
    rows.set(key, { count, start: windowStart.getTime() }); return { count, expiresAt };
  } };
  const make = (session: SessionUser) => createHandler({ getSession: async () => session, requirePlatformAdmin: () => null,
    enforceLimits: async rules => { const d = await consumeRateLimits(rules, { store, now, shouldCleanup: () => false }); return d.status === "allowed" ? null : rateLimitResponse(d); },
    bankCapabilities: async () => { calls++; return [emptyBank]; } });
  try {
    const handler = make(admin);
    for (let i = 0; i < 3; i++) await check(await handler(request()), 200, { ok: true, count: 1, banks: [emptyBank] });
    const response = await handler(request()); assert.equal(response.headers.get("retry-after"), "60");
    await check(response, 429, { error: "RATE_LIMITED" }); assert.equal(calls, 3);
    for (const session of [{ ...admin, id: "other-user" }, { ...admin, companyId: "other-company" }]) await check(await make(session)(request()), 200, { ok: true, count: 1, banks: [emptyBank] });
    now = new Date(120000); await check(await handler(request()), 200, { ok: true, count: 1, banks: [emptyBank] });
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});
test("limiter unavailable prevents provider call", async () => {
  const f = fixture({ limited: new Response("raw-provider-error", { status: 503 }) });
  await check(await f.handler(request()), 503, { error: "RATE_LIMIT_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
});
for (const status of [400, 401, 403, 404, 429, 500, 503]) test("provider HTTP failures expose only sanitized code/status", async () => {
  const f = fixture({ provider: () => new Response("raw-provider-error", { status, headers: { "x-provider-sensitive": "private-provider-header" } }) });
  const unavailable = status === 429 || status >= 500;
  const code = unavailable ? "PROVIDER_UNAVAILABLE" : status === 401 || status === 403 ? "AUTHENTICATION" : "PROVIDER_FAILED";
  await check(await f.handler(request()), unavailable ? 503 : 502, { error: `OPENCREDIT_BANK_CAPABILITIES_${code}`, providerStatus: status });
});
test("network and timeout failures never expose raw errors or synthetic statuses", async () => {
  const network = fixture({ provider: () => { throw new Error("raw-provider-error fictitious-password"); } });
  await check(await network.handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_NETWORK" });
  const pending = fixture({ timeoutMs: 20, provider: () => new Promise(() => {}) });
  await check(await pending.handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_TIMEOUT" });
  let cancelled = false;
  const stalled = fixture({ timeoutMs: 20, provider: () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"data":')); }, cancel() { cancelled = true; } })) });
  await check(await stalled.handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_TIMEOUT" }); assert.equal(cancelled, true);
});
for (const [code, status] of [["CONFIGURATION", 503], ["TIMEOUT", 503], ["NETWORK", 503], ["INVALID_RESPONSE", 502], ["AUTH_FAILED", 502]] as const) {
  test("existing auth error mapping is preserved", async () => {
    const f = fixture({ provider: () => { throw new ApiError(code); } });
    await check(await f.handler(request()), status, { error: `OPENCREDIT_BANK_CAPABILITIES_${code === "AUTH_FAILED" ? "AUTHENTICATION" : code}` });
  });
}
test("invalid provider status metadata is omitted", async () => {
  for (const value of [undefined, 99, 600, 400.5, NaN, "400"]) {
    const f = fixture({ provider: () => { throw new ConnectionError("PROVIDER_FAILED", 502, value as number); } });
    await check(await f.handler(request()), 502, { error: "OPENCREDIT_BANK_CAPABILITIES_PROVIDER_FAILED" });
  }
});
test("handler whitelists nested capabilities independently of service extras", async () => {
  const handler = createHandler({ getSession: async () => admin, requirePlatformAdmin: platformCheck, enforceLimits: async () => null,
    bankCapabilities: async () => [{ ...bank, token: "private-provider-token", capabilities: { simulacaoAtiva: true, digitacaoAtiva: false, unknown: "private-provider-extra" } }] });
  await check(await handler(request()), 200, { ok: true, count: 1, banks: [{ ...bank, capabilities: { simulacaoAtiva: true, digitacaoAtiva: false } }] });
});
test("raw internal failures fail closed", async () => {
  const handler = createHandler({ getSession: async () => { throw new Error("raw-provider-error"); }, requirePlatformAdmin: platformCheck,
    enforceLimits: async () => null, bankCapabilities: async () => [] });
  await check(await handler(request()), 503, { error: "OPENCREDIT_BANK_CAPABILITIES_UNAVAILABLE" });
});
test("actual existing client owns auth/refresh/retry and only the fixed banks GET is a functional call", async () => {
  const calls: { path: string; method: string }[] = []; let count = 0;
  const client = createClient({ credentials: () => ({ email: config.OPENCREDIT_API_EMAIL, password: config.OPENCREDIT_API_PASSWORD }),
    fetch: (async (url, init) => {
      const target = new URL(String(url)); calls.push({ path: target.pathname, method: init?.method ?? "GET" });
      assert.equal(target.origin, "https://core.api.opencredit.tech"); assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store"); assert.equal(init?.credentials, "omit");
      if (target.pathname === "/api/auth/login" || target.pathname === "/api/auth/refresh") return Response.json({ data: {
        accessToken: "private-provider-access", refreshToken: "private-provider-refresh", expiresIn: 28800
      } });
      assert.equal(target.pathname + target.search, path); assert.equal(init?.method, "GET");
      return ++count === 1 ? new Response(null, { status: 401 }) : data([{ ...bank, simulacaoAtiva: false }]);
    }) as typeof fetch });
  try {
    assert.deepEqual(await createService({ client, env: () => config })(), [{ ...bank, capabilities: { simulacaoAtiva: false } }]);
    assert.deepEqual(calls, [
      { path: "/api/auth/login", method: "POST" }, { path: "/api/tenants/tenant-fixture/banks", method: "GET" },
      { path: "/api/auth/refresh", method: "POST" }, { path: "/api/tenants/tenant-fixture/banks", method: "GET" }
    ]);
  } finally { client.dispose(); }
});
test("new route is POST-only with official auth and shared limiter, no logging/domain writes", () => {
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/bank-capabilities/route.ts", import.meta.url), "utf8");
  for (const name of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits", "export const POST"]) assert.ok(route.includes(name));
  assert.doesNotMatch(route, /export const (GET|PATCH|DELETE|PUT)/);
  const source = readFileSync(new URL("./opencredit-bank-capabilities.service.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.|safeLog|prisma\.|\.create\(|\.update\(|\.upsert\(|\.delete\(|OPENCREDIT_PARTNER/);
  assert.match(source, /^import "server-only";/m);
});
