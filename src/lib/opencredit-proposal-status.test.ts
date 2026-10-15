import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import type { RateLimitRule } from "./rate-limit";

let createService: typeof import("./opencredit-proposal-status.service").createOpenCreditStatusCatalogService;
let createHandler: typeof import("./opencredit-proposal-status.service").createOpenCreditStatusCatalogHandler;
let parse: typeof import("./opencredit-proposal-status.service").parseOpenCreditStatusCatalog;
let ApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    const service = await import("./opencredit-proposal-status.service");
    createService = service.createOpenCreditStatusCatalogService; createHandler = service.createOpenCreditStatusCatalogHandler; parse = service.parseOpenCreditStatusCatalog;
    ApiError = (await import("./opencredit-api-client")).OpenCreditApiError;
  } finally { loader._load = original; }
});
const config = { OPENCREDIT_TENANT_ID: "tenant-fixture", OPENCREDIT_API_EMAIL: "fixture@example.invalid", OPENCREDIT_API_PASSWORD: "fixture-password" };
const admin: SessionUser = { id: "admin-fixture", companyId: "platform-fixture", name: "Fixture", email: config.OPENCREDIT_API_EMAIL, role: "ADMIN" };
const categories = [{ code: "APROVADA", terminal: true }, { code: "NOVA_CATEGORIA", terminal: false }];
const statuses = [{ status: "Paga", category: "APROVADA", terminal: true, hasSignUrl: false }];
function payload() { return { data: { categories: structuredClone(categories), items: [{ bankId: "v8", bankName: "Banco Fixture", statuses: structuredClone(statuses) }] } }; }
const expected = { ok: true, bankId: "v8", categories, statuses };
const invalid = { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_INVALID_RESPONSE" };
function request(options: { body?: string; query?: string; type?: string | null; origin?: string | null; bearer?: string; site?: string } = {}) {
  const headers = new Headers();
  if (options.type !== null) headers.set("content-type", options.type ?? "application/json");
  if (options.origin !== null) headers.set("origin", options.origin ?? "https://crm.example.invalid");
  if (options.bearer) headers.set("authorization", options.bearer);
  if (options.site) headers.set("sec-fetch-site", options.site);
  return new NextRequest(`https://crm.example.invalid/api/admin/integrations/opencredit/proposal-status-catalog${options.query ?? ""}`, {
    method: "POST", headers, body: options.body ?? '{"bankId":"v8"}'
  });
}
function platformCheck(session: SessionUser) {
  const previous = process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_COMPANY_ID = admin.companyId;
  try { return requirePlatformAdmin(session); }
  finally { if (previous === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = previous; }
}
function fixture(options: { provider?: () => Promise<Response> | Response; session?: SessionUser | null; limited?: Response; limiterThrows?: boolean; env?: typeof config; timeoutMs?: number } = {}) {
  const calls: { path: string; init?: RequestInit }[] = []; const rules: RateLimitRule[][] = [];
  const service = createService({ env: () => options.env ?? config, timeoutMs: options.timeoutMs,
    client: { request: async (path, init) => { calls.push({ path, init }); return options.provider ? options.provider() : Response.json(payload()); } } });
  const handler = createHandler({ getSession: async () => options.session === undefined ? admin : options.session,
    requirePlatformAdmin: platformCheck, enforceLimits: async r => { rules.push([...r]); if (options.limiterThrows) throw Error("private-provider"); return options.limited ?? null; }, catalog: service });
  return { handler, service, calls, rules };
}
async function check(response: Response, status: number, expectedBody: object) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("x-provider-sensitive"), false);
  const text = await response.text();
  assert.doesNotMatch(text, /fixture-password|private-provider|accessToken|refreshToken|Authorization|https?:\/\/|requestId|bankName|description|tenant-fixture/i);
  assert.deepEqual(JSON.parse(text), expectedBody);
}
test("safe metadata, one exact GET, fixed tenant, no partner/CPF/business request", async () => {
  const f = fixture(); await check(await f.handler(request()), 200, expected);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/api/tenants/tenant-fixture/integration/proposal-status?bankId=v8");
  assert.equal(f.calls[0].init?.method, "GET"); assert.equal(f.calls[0].init?.body, undefined);
  assert.deepEqual(f.rules[0], [{ category: "opencredit-proposal-status-catalog", identifiers: [admin.companyId, admin.id], limit: 3, windowMs: 60000 }]);
});
test("ID is URLSearchParams encoded without allowing query injection; new bank need not be hardcoded", async () => {
  const id = "new_BANK-42"; const p = payload(); p.data.items[0].bankId = id;
  const f = fixture({ provider: () => Response.json(p) });
  const result = await f.service(id); assert.equal(result.bankId, id);
  assert.equal(f.calls[0].path, `/api/tenants/tenant-fixture/integration/proposal-status?${new URLSearchParams({ bankId: id })}`);
});
test("empty provider wallet does not create synthetic statuses", async () => {
  const f = fixture({ provider: () => Response.json({ data: { categories, items: [] } }) });
  await check(await f.handler(request()), 200, { ...expected, statuses: [] });
});
test("missing booleans stay absent; false is retained, future category accepted", async () => {
  const f = fixture({ provider: () => Response.json({ data: { categories: [{ code: "FUTURE_42" }], items: [{ bankId: "v8", statuses: [{ status: "Novo", category: "FUTURE_42", hasSignUrl: false }] }] } }) });
  await check(await f.handler(request()), 200, { ok: true, bankId: "v8", categories: [{ code: "FUTURE_42" }], statuses: [{ status: "Novo", category: "FUTURE_42", hasSignUrl: false }] });
});
for (const body of ["", " ", "{}", "[]", "null", '"v8"', '{"bankId":null}', '{"bankId":true}', '{"bankId":1}', '{"bankId":[]}', '{"bankId":{}}', '{"bankId":""}', '{"bankId":"v8","bankId":"v8"}', '{"bankId":"v8"', '{"bankId":"v8"}' + " ".repeat(257), '{"bankId":"v8&tenant=other"}', '{"bankId":"https://host"}', '{"bankId":"../v8"}', '{"bankId":"v8\\n"}', JSON.stringify({ bankId: "a".repeat(129) })]) {
  test(`invalid body ${JSON.stringify(body).slice(0, 70)}`, async () => { const f = fixture(); await check(await f.handler(request({ body })), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0); });
}
for (const key of ["partnerId", "tenant", "cpf", "proposalId", "simulationId", "product", "url", "path", "query", "headers", "method", "bearer", "__proto__"]) test(`extra ${key} rejected`, async () => {
  const f = fixture(); await check(await f.handler(request({ body: `{"bankId":"v8","${key}":"forbidden"}` })), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
});
for (const type of [null, "text/plain", "application/x-www-form-urlencoded", "application/jsonp"]) test(`wrong Content-Type ${type}`, async () => {
  const f = fixture(); await check(await f.handler(request({ type })), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
});
test("UTF-8 charset accepted", async () => { const f = fixture(); await check(await f.handler(request({ type: "application/json; charset=utf-8" })), 200, expected); });
for (const options of [{ query: "?bankId=v8" }, { bearer: "private-provider" }]) test(`forbidden transport ${JSON.stringify(options)}`, async () => {
  const f = fixture(); await check(await f.handler(request(options)), 400, { error: "INVALID_REQUEST" }); assert.equal(f.calls.length, 0);
});
for (const options of [{ origin: null }, { origin: "https://evil.invalid" }, { site: "cross-site" }]) test(`origin denied ${JSON.stringify(options)}`, async () => {
  const f = fixture(); await check(await f.handler(request(options)), 403, { error: "INVALID_ORIGIN" }); assert.equal(f.calls.length, 0);
});
for (const session of [null, { ...admin, companyId: "other" }, { ...admin, role: "AGENT" } as SessionUser]) test(`access denied ${session?.role ?? "anonymous"}`, async () => {
  const f = fixture({ session }); await check(await f.handler(request()), session ? 403 : 401, { error: session ? "FORBIDDEN" : "UNAUTHENTICATED" }); assert.equal(f.calls.length, 0);
});
for (const status of [429, 503]) test(`limiter ${status}`, async () => {
  const f = fixture({ limited: new Response("private-provider", { status, headers: { "Retry-After": "60" } }) });
  const response = await f.handler(request()); assert.equal(response.headers.get("retry-after"), "60");
  await check(response, status, { error: status === 429 ? "RATE_LIMITED" : "RATE_LIMIT_UNAVAILABLE" }); assert.equal(f.calls.length, 0);
});
test("limiter exception fails closed", async () => { const f = fixture({ limiterThrows: true }); await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_UNAVAILABLE" }); assert.equal(f.calls.length, 0); });
const badPayloads: unknown[] = [null, [], {}, { data: null }, { data: {} }, { data: { categories: [], items: null } },
  { data: { categories: Array(33).fill({ code: "A" }), items: [] } }, { data: { categories, items: Array(2).fill(payload().data.items[0]) } }];
for (const value of [null, "true", 0, [], {}]) {
  badPayloads.push({ data: { categories: [{ code: "APROVADA", terminal: value }], items: [] } });
  for (const key of ["terminal", "hasSignUrl"]) {
    const p = payload(); Object.assign(p.data.items[0].statuses[0], { [key]: value }); badPayloads.push(p);
  }
}
for (const value of [null, "", " ", "s".repeat(161), "https://private-provider", "bad\ntext", 123]) {
  const p = payload(); Object.assign(p.data.items[0].statuses[0], { status: value }); badPayloads.push(p);
}
for (const value of [null, "", "NEW".repeat(30), "with spaces", "APROVADA\n", 42]) {
  const p = payload(); Object.assign(p.data.categories[0], { code: value }); badPayloads.push(p);
}
{
  const p = payload(); p.data.items[0].bankId = "other"; badPayloads.push(p);
  const q = payload(); q.data.items[0].statuses = Array(101).fill(statuses[0]); badPayloads.push(q);
  const r = payload(); r.data.items[0].statuses[0].category = "UNDECLARED"; badPayloads.push(r);
  const s = payload(); s.data.items[0].statuses[0].terminal = false; badPayloads.push(s);
  const t = payload(); t.data.categories.push(t.data.categories[0]); badPayloads.push(t);
  const u = payload(); u.data.items[0].statuses.push(u.data.items[0].statuses[0]); badPayloads.push(u);
}
badPayloads.forEach((p, i) => test(`invalid provider shape ${i}`, async () => { const f = fixture({ provider: () => Response.json(p) }); await check(await f.handler(request()), 502, invalid); }));
test("unknown fields are discarded at every level", async () => {
  const extra = { accessToken: "private-provider", url: "https://private-provider", metadata: config, headers: config, requestId: "private-provider" };
  const p = payload(); Object.assign(p, extra); Object.assign(p.data, extra);
  for (const c of p.data.categories) Object.assign(c, extra, { description: "private-provider" });
  Object.assign(p.data.items[0], extra); for (const s of p.data.items[0].statuses) Object.assign(s, extra);
  const f = fixture({ provider: () => Response.json(p) }); await check(await f.handler(request()), 200, expected);
});
for (const response of [() => new Response("not JSON"), () => new Response("x".repeat(32769)), () => new Response("{}", { headers: { "content-length": "32769" } }), () => new Response(null, { status: 204 })]) test("invalid/oversize/missing provider body", async () => {
  const f = fixture({ provider: response }); await check(await f.handler(request()), 502, invalid);
});
for (const status of [400, 401, 403, 404, 429, 500, 503]) test(`provider HTTP ${status} sanitized`, async () => {
  const f = fixture({ provider: () => new Response("private-provider", { status, headers: { "x-provider-sensitive": "private-provider" } }) });
  const unavailable = status === 429 || status >= 500;
  await check(await f.handler(request()), unavailable ? 503 : 502, { error: `OPENCREDIT_PROPOSAL_STATUS_CATALOG_${unavailable ? "PROVIDER_UNAVAILABLE" : status === 401 || status === 403 ? "AUTHENTICATION" : "PROVIDER_FAILED"}`, providerStatus: status });
});
test("network has no invented status", async () => { const f = fixture({ provider: () => { throw Error("private-provider"); } }); await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_NETWORK" }); });
test("missing configuration never calls provider", async () => { const f = fixture({ env: { ...config, OPENCREDIT_API_PASSWORD: " " } }); await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_CONFIGURATION" }); assert.equal(f.calls.length, 0); });
test("whole request deadline cancels stalled provider", async () => {
  const f = fixture({ timeoutMs: 5, provider: () => new Promise(() => {}) }); await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_TIMEOUT" }); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].init?.signal?.aborted, true);
});
test("deadline covers stalled provider body", async () => {
  let cancelled = false;
  const f = fixture({ timeoutMs: 5, provider: () => new Response(new ReadableStream({ cancel() { cancelled = true; } })) });
  await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_TIMEOUT" }); assert.equal(cancelled, true);
});
test("true signature flag is preserved and never expanded into a URL", async () => {
  const p = payload(); p.data.items[0].statuses[0].hasSignUrl = true;
  const f = fixture({ provider: () => Response.json(p) });
  await check(await f.handler(request()), 200, { ...expected, statuses: [{ ...statuses[0], hasSignUrl: true }] });
});
test("invalid UTF-8 provider response rejects rather than replacing text", async () => {
  const f = fixture({ provider: () => new Response(new Uint8Array([123, 34, 255, 34, 58, 49, 125])) });
  await check(await f.handler(request()), 502, invalid);
});
test("stalled incoming body is bounded and cancelled without a provider call", async () => {
  let cancelled = false;
  const req = new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/proposal-status-catalog", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" },
    body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: "half"
  } as ConstructorParameters<typeof NextRequest>[1]);
  const f = fixture(); await check(await f.handler(req), 400, { error: "INVALID_REQUEST" });
  assert.equal(cancelled, true); assert.equal(f.calls.length, 0);
});
test("late provider response after timeout is cancelled, not read or retried", async () => {
  let finish!: (response: Response) => void; let cancelled = false;
  const f = fixture({ timeoutMs: 5, provider: () => new Promise(resolve => { finish = resolve; }) });
  await check(await f.handler(request()), 503, { error: "OPENCREDIT_PROPOSAL_STATUS_CATALOG_TIMEOUT" });
  finish(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cancelled, true); assert.equal(f.calls.length, 1);
});
for (const code of ["CONFIGURATION", "TIMEOUT", "NETWORK", "INVALID_RESPONSE", "AUTH_FAILED"] as const) test(`client ${code} is sanitized`, async () => {
  const f = fixture({ provider: () => { throw new ApiError(code); } });
  await check(await f.handler(request()), ["CONFIGURATION", "TIMEOUT", "NETWORK"].includes(code) ? 503 : 502, { error: `OPENCREDIT_PROPOSAL_STATUS_CATALOG_${code === "AUTH_FAILED" ? "AUTHENTICATION" : code}` });
});
test("direct parser validates identity, absent booleans and non-coerced undefined", () => {
  assert.throws(() => parse(payload(), "v8\n"));
  const p = payload(); Object.assign(p.data.categories[0], { terminal: undefined }); assert.throws(() => parse(p, "v8"));
});
test("composition has only explicit POST and service only fixed GET, no domain persistence", () => {
  const source = readFileSync(new URL("./opencredit-proposal-status.service.ts", import.meta.url), "utf8");
  assert.match(source, /import "server-only"/); assert.match(source, /options\.client \?\? openCreditApiClient/);
  assert.equal((source.match(/client\.request\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /partnerId|cpf|\/simulate|\/clients|\/proposals|\/bank-accounts|\.upsert\(|\.create\(|\.update\(|\.delete\(|console\./i);
  const route = readFileSync(new URL("../app/api/admin/integrations/opencredit/proposal-status-catalog/route.ts", import.meta.url), "utf8");
  for (const name of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits"]) assert.match(route, new RegExp(name));
  assert.match(route, /export const POST/); assert.doesNotMatch(route, /export const (GET|PATCH|DELETE|PUT)/);
});
