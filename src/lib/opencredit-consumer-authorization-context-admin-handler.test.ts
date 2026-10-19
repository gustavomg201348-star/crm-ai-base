import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import { consumeRateLimits, rateLimitResponse, type RateLimitRule } from "./rate-limit";
let boundary: typeof import("./opencredit-consumer-authorization-context-admin-handler");
before(async () => {
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (name, ...args) => name === "server-only" ? {} : original.call(loader, name, ...args);
  try { boundary = await import("./opencredit-consumer-authorization-context-admin-handler"); } finally { loader._load = original; }
});
const actor: SessionUser = { id: "admin", companyId: "platform", role: "ADMIN", name: "Synthetic", email: "test@example.invalid" };
const input = { companyId: "company", contactId: "contact", conversationId: "conversation" };
const success = { ok: true as const, authorization: { exists: false, active: false, revision: null, evidenceInboundEventId: null, evidenceMessageId: null }, evidenceCandidates: [{ inboundEventId: "evidence", messageId: "message" }] };
function request(options: { body?: string | Uint8Array | ReadableStream<Uint8Array> | null; query?: string; headers?: Record<string, string | null> } = {}) {
  const headers = new Headers({ origin: "https://crm.example.invalid", "content-type": "application/json" });
  for (const [k, v] of Object.entries(options.headers ?? {})) { if (v === null) headers.delete(k); else headers.set(k, v); }
  const body = options.body === undefined ? JSON.stringify(input) : options.body;
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/consumer-authorization/context" + (options.query ?? ""), { method: "POST", headers, body: body as BodyInit | null, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) });
}
function fixture(options: { session?: SessionUser | null; denied?: boolean; limited?: Response; blockedIndex?: number; limitThrows?: boolean; configError?: boolean; failure?: unknown; result?: unknown } = {}) {
  const calls: unknown[] = []; const rules: RateLimitRule[][] = []; const order: string[] = [];
  const db = {} as Parameters<typeof boundary.createOpenCreditConsumerAuthorizationContextHandler>[0]["db"];
  const scope = "synthetic-scope" as ReturnType<NonNullable<Parameters<typeof boundary.createOpenCreditConsumerAuthorizationContextHandler>[0]["resolveScope"]>>;
  const handler = boundary.createOpenCreditConsumerAuthorizationContextHandler({ db,
    getSession: async () => { order.push("session"); return options.session === undefined ? actor : options.session; },
    requirePlatformAdmin: () => { order.push("admin"); return options.denied ? new Response("sensitive", { status: 403 }) : null; },
    enforceLimits: async r => {
      order.push("limit"); rules.push([...r]); if (options.limitThrows) throw new Error("sensitive");
      if (options.blockedIndex !== undefined) {
        const previous = process.env.RATE_LIMIT_SECRET; process.env.RATE_LIMIT_SECRET = "synthetic-context-limiter"; let count = 0;
        try {
          const decision = await consumeRateLimits(r, { shouldCleanup: () => false, store: { increment: async ({ expiresAt }) => ({ count: count++ === options.blockedIndex ? r[options.blockedIndex!].limit + 1 : 1, expiresAt }) } });
          assert.equal(count, options.blockedIndex + 1); assert.equal(decision.status, "limited");
          return rateLimitResponse(decision);
        } finally { if (previous === undefined) delete process.env.RATE_LIMIT_SECRET; else process.env.RATE_LIMIT_SECRET = previous; }
      }
      return options.limited ?? null;
    },
    resolveScope: () => { order.push("scope"); if (options.configError) throw new Error("sensitive config"); return scope; },
    read: async (database, i) => { assert.equal(database, db); order.push("read"); calls.push(i); if (options.failure) throw options.failure; return (options.result ?? success) as typeof success; },
  });
  return { handler, calls, rules, order, scope };
}
async function error(response: Response, status: number, code: string) {
  assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(await response.json(), { error: code });
}
test("session first", async () => { const f = fixture({ session: null }); await error(await f.handler(request({ body: "bad" })), 401, "UNAUTHENTICATED"); assert.deepEqual(f.order, ["session"]); });
test("Platform Admin required", async () => { const f = fixture({ denied: true }); await error(await f.handler(request()), 403, "FORBIDDEN"); assert.deepEqual(f.order, ["session", "admin"]); });
for (const headers of [{ origin: null }, { origin: "https://other.invalid" }, { "sec-fetch-site": "cross-site" }] as Record<string, string | null>[]) test("origin " + JSON.stringify(headers), async () => {
  await error(await fixture().handler(request({ headers })), 403, "INVALID_ORIGIN");
});
for (const options of [{ query: "?x=1" }, { headers: { authorization: "Bearer sensitive" } }, { headers: { "content-type": null } }, { headers: { "content-type": "text/plain" } }] as Parameters<typeof request>[0][]) {
  test("invalid request options " + JSON.stringify(options), async () => { const f = fixture(); await error(await f.handler(request(options)), 400, "INVALID_REQUEST"); assert.equal(f.rules.length, 0); });
}
for (const body of [null, "", "{", "[]", "null", "true", "1", '"string"', JSON.stringify(input) + "{}", '{"companyId":"a","\\u0063ompanyId":"b"}', '{"companyId":"\\ud800"}', " ".repeat(2049), new Uint8Array([0xc3, 0x28])]) {
  test("strict body rejected " + String(body).slice(0, 45), async () => { const f = fixture(); await error(await f.handler(request({ body })), 400, "INVALID_REQUEST"); assert.equal(f.calls.length, 0); assert.equal(f.rules.length, 0); });
}
for (const key of Object.keys(input)) {
  test("missing " + key, async () => { const body: Record<string, unknown> = { ...input }; delete body[key]; await error(await fixture().handler(request({ body: JSON.stringify(body) })), 400, "INVALID_REQUEST"); });
  for (const v of [null, false, 4, [], {}, "", "a\n", "a/b", "é", "a".repeat(129), "_a"]) test("invalid " + key + JSON.stringify(v), async () => {
    await error(await fixture().handler(request({ body: JSON.stringify({ ...input, [key]: v }) })), 400, "INVALID_REQUEST");
  });
}
for (const key of ["providerScope", "actor", "purpose", "authorizationId", "inboundEventId", "messageId", "cpf", "providerMessageId", "body", "active", "revision", "__proto__"]) test("extra field " + key, async () => {
  await error(await fixture().handler(request({ body: JSON.stringify({ ...input, [key]: "sensitive" }) })), 400, "INVALID_REQUEST");
});
test("exact actor/scope/order/rules/closed output", async () => {
  const f = fixture(); const response = await f.handler(request()); assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(await response.json(), success);
  assert.deepEqual(f.order, ["session", "admin", "limit", "scope", "read"]); assert.equal((f.calls[0] as { actor: SessionUser }).actor, actor); assert.deepEqual(f.calls, [{ actor, ...input, providerScope: f.scope }]);
  assert.deepEqual(f.rules, [[{ category: "opencredit-consumer-authorization-context-actor", identifiers: ["platform", "admin"], limit: 60, windowMs: 60000 }, { category: "opencredit-consumer-authorization-context-target", identifiers: ["company", "contact"], limit: 30, windowMs: 60000 }]]);
});
for (const [blockedIndex, label] of Array.from(["actor", "target"].entries())) test("shared rate limit " + label, async () => { const f = fixture({ blockedIndex }); const r = await f.handler(request()); assert.match(r.headers.get("retry-after") ?? "", /^\d+$/); assert.equal(r.headers.get("x-sensitive"), null); await error(r, 429, "RATE_LIMITED"); assert(!f.order.includes("scope")); });
for (const retry of ["-1", "1.5", "9007199254740992", "date", "__proto__"]) test("unsafe Retry-After " + retry, async () => { const r = await fixture({ limited: new Response("sensitive", { status: 429, headers: { "Retry-After": retry } }) }).handler(request()); assert.equal(r.headers.get("retry-after"), null); });
test("limiter unavailable", async () => { const f = fixture({ limited: new Response("sensitive", { status: 503 }) }); await error(await f.handler(request()), 503, "RATE_LIMIT_UNAVAILABLE"); assert.equal(f.calls.length, 0); });
test("limiter exception", async () => { await error(await fixture({ limitThrows: true }).handler(request()), 503, "RATE_LIMIT_UNAVAILABLE"); });
test("resolver configuration failure", async () => { const f = fixture({ configError: true }); await error(await f.handler(request()), 503, "OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION"); assert.equal(f.calls.length, 0); });
for (const [code, status] of [["NOT_AUTHORIZED", 403], ["COMPANY_NOT_FOUND", 404], ["CONTACT_NOT_FOUND", 404], ["CONVERSATION_NOT_FOUND", 404], ["STORAGE_ERROR", 503]] as const) {
  test("closed module-independent error " + code, async () => {
    const failure = Object.assign(new Error("OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_" + code), { name: "OpenCreditConsumerAuthorizationContextError", code });
    await error(await fixture({ failure }).handler(request()), status, "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_" + code);
  });
}
for (const failure of [new Error("sensitive raw Prisma error"), { code: "CONTACT_NOT_FOUND" }]) test("unknown exception sanitized " + typeof failure, async () => { await error(await fixture({ failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_UNAVAILABLE"); });
for (const key of ["name", "code", "message"]) test("exception accessor never executes " + key, async () => {
  let reads = 0; const failure = Object.assign(new Error("OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_STORAGE_ERROR"), { name: "OpenCreditConsumerAuthorizationContextError", code: "STORAGE_ERROR" });
  Object.defineProperty(failure, key, { get() { reads++; throw new Error("sensitive"); } }); await error(await fixture({ failure }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_UNAVAILABLE"); assert.equal(reads, 0);
});
test("extra result fields never leak", async () => { await error(await fixture({ result: { ...success, body: "sensitive" } }).handler(request()), 503, "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_UNAVAILABLE"); });
test("1000ms deadline with nonsettling cancel rejects valid prefix", async () => {
  const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(input))); }, cancel() { return new Promise(() => {}); } });
  const f = fixture(); const start = performance.now(); await error(await f.handler(request({ body: stream })), 400, "INVALID_REQUEST"); assert(performance.now() - start < 2500); assert.equal(f.calls.length, 0);
});
test("real byte limit independent of content-length", async () => { await error(await fixture().handler(request({ body: JSON.stringify(input).padEnd(2049, " "), headers: { "content-length": "1" } })), 400, "INVALID_REQUEST"); });
test("thin route and no domain mutation/HTTP imports", () => {
  const route = readFileSync("src/app/api/admin/integrations/opencredit/consumer-authorization/context/route.ts", "utf8");
  for (const name of ["getSessionFromRequest", "requirePlatformAdmin", "enforceRateLimits", "prisma", "createOpenCreditConsumerAuthorizationContextHandler"]) assert(route.includes(name));
  const source = readFileSync("src/lib/opencredit-consumer-authorization-context-admin-handler.ts", "utf8");
  assert.doesNotMatch(source, /JSON\.parse|\bfetch\s*\(|opencredit-api-client|console\.|grantOpenCredit|revokeOpenCredit|commercial-operation/);
});
