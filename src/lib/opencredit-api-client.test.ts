import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFileSync } from "node:fs";
import Module from "node:module";

let createOpenCreditApiClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let OpenCreditApiError: typeof import("./opencredit-api-client").OpenCreditApiError;

// Standalone Node does not handle Next's public marker. Stub only that no-op
// import for unit tests, and restore the loader immediately after loading.
before(async () => {
  const loader = Module as typeof Module & {
    _load(specifier: string, ...args: unknown[]): unknown;
  };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only"
    ? {} : original.call(loader, specifier, ...args);
  try {
    const client = await import("./opencredit-api-client");
    createOpenCreditApiClient = client.createOpenCreditApiClient;
    OpenCreditApiError = client.OpenCreditApiError;
  } finally {
    loader._load = original;
  }
});

const creds = { email: "partner@example.invalid", password: "fictitious-test-password" };
const pair = (suffix = "1", expiresIn = 28800) => Response.json({ data: {
  accessToken: `test-access-${suffix}`, refreshToken: `test-refresh-${suffix}`, expiresIn
} });
type Call = { path: string; init: RequestInit };
function fixture(reply: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  let time = 1000;
  let credentials = creds;
  const client = createOpenCreditApiClient({ credentials: () => credentials, now: () => time,
    fetch: (async (url, init) => {
      const call = { path: new URL(String(url)).pathname, init: init ?? {} };
      calls.push(call);
      return reply(call, calls.length);
    }) as typeof fetch
  });
  return { client, calls, advance: (ms: number) => { time += ms; }, change: (value: typeof creds) => { credentials = value; } };
}

test("lazy login uses official contract and reusable bearer; no redirects or HTTP cache", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : Response.json({ ok: true }));
  assert.equal(f.calls.length, 0);
  await f.client.request("/api/tenants/test/banks");
  await f.client.request("/api/tenants/test/banks");
  assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), creds);
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 1);
  assert.equal(new Headers(f.calls[1].init.headers).get("Authorization"), "Bearer test-access-1");
  for (const c of f.calls) { assert.equal(c.init.redirect, "error"); assert.equal(c.init.cache, "no-store"); }
  f.client.dispose();
});

test("proactive expiry refreshes and rotates both tokens before password login", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh" ? pair("2") : new Response());
  await f.client.request("/api/banks"); f.advance(28800000);
  await f.client.request("/api/banks"); f.advance(28800000);
  await f.client.request("/api/banks");
  assert.deepEqual(f.calls.filter(c => c.path === "/api/auth/refresh").map(c => JSON.parse(String(c.init.body))),
    [{ refreshToken: "test-refresh-1" }, { refreshToken: "test-refresh-2" }]);
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 1);
  f.client.dispose();
});

test("simultaneous first requests share one login", async () => {
  const f = fixture(async c => { await Promise.resolve(); return c.path === "/api/auth/login" ? pair() : new Response(); });
  await Promise.all(Array.from({ length: 10 }, () => f.client.request("/api/banks")));
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 1);
  f.client.dispose();
});

test("concurrent 401s renew once, override caller bearer and retry read once", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh" ? pair("2")
    : new Headers(c.init.headers).get("Authorization") === "Bearer test-access-1" ? new Response(null, { status: 401 }) : new Response());
  const responses = await Promise.all(Array.from({ length: 8 }, () => f.client.request("/api/banks", { headers: { Authorization: "wrong-test-token" } })));
  assert.ok(responses.every(r => r.status === 200));
  assert.equal(f.calls.filter(c => c.path === "/api/auth/refresh").length, 1);
  f.client.dispose();
});

test("non-idempotent 401 renews for next request but never replays POST", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh" ? pair("2") : new Response(null, { status: 401 }));
  assert.equal((await f.client.request("/api/test", { method: "POST", body: "{}" })).status, 401);
  assert.equal(f.calls.filter(c => c.path === "/api/test").length, 1);
  f.client.dispose();
});

for (const status of [401, 403]) test(`refresh authentication rejection ${status} permits one login fallback`, async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh" ? new Response(null, { status }) : new Response());
  await f.client.request("/api/banks"); f.advance(28800000); await f.client.request("/api/banks");
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 2);
  f.client.dispose();
});

for (const status of [400, 429, 500]) test(`refresh ${status} never falls back to password or leaks provider body`, async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh"
    ? new Response("sensitive-provider-error", { status }) : new Response());
  await f.client.request("/api/banks"); f.advance(28800000);
  await assert.rejects(f.client.request("/api/banks"), e => e instanceof OpenCreditApiError && e.code === "AUTH_FAILED"
    && e.status === status && !String(e).includes("sensitive"));
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 1);
  f.client.dispose();
});

test("second 401 stops after one retry, invalidates pair and avoids infinite loop", async () => {
  const f = fixture(c => c.path.includes("/auth/") ? pair() : new Response(null, { status: 401 }));
  assert.equal((await f.client.request("/api/banks")).status, 401);
  assert.equal(f.calls.length, 4);
  f.client.dispose();
});

test("credential changes discard old refresh and missing env fails before network", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  await f.client.request("/api/banks"); f.change({ ...creds, password: "another-fictitious-password" });
  await f.client.request("/api/banks");
  assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 2);
  f.change({ email: "", password: "" });
  await assert.rejects(f.client.request("/api/banks"), { code: "CONFIGURATION" });
  assert.equal(f.calls.length, 4);
  f.client.dispose();
});

test("unknown token response and overlarge auth body fail closed", async () => {
  for (const response of [Response.json({ data: { accessToken: "bad\nheader", refreshToken: "x", expiresIn: 5 } }),
    Response.json({ data: { accessToken: "x", refreshToken: "y", expiresIn: 0 } }), new Response("x".repeat(17000))]) {
    const f = fixture(() => response);
    await assert.rejects(f.client.request("/api/banks"), { code: "INVALID_RESPONSE" });
    assert.equal(f.calls.length, 1); f.client.dispose();
  }
});

test("network failures sanitized; invalid destinations rejected before login", async () => {
  const f = fixture(() => { throw new Error("raw-error-containing-password"); });
  for (const path of ["https://example.invalid/api/x", "/api/../auth/login", "/api/auth/login", "/api/banks#fragment", "//example.invalid/api/x"]) {
    await assert.rejects(f.client.request(path), { code: "INVALID_PATH" });
  }
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.client.request("/api/banks"), { code: "NETWORK", message: "OPENCREDIT_API_NETWORK" });
  f.client.dispose();
});

test("dispose prevents late auth publication and further network requests", async () => {
  let finish!: (value: Response) => void;
  const f = fixture(() => new Promise<Response>(resolve => { finish = resolve; }));
  const request = f.client.request("/api/banks");
  f.client.dispose(); finish(pair());
  await assert.rejects(request, { code: "DISPOSED" });
  await assert.rejects(f.client.request("/api/banks"), { code: "DISPOSED" });
  assert.equal(f.calls.length, 1);
});

test("idle expiry discards the pair and requires a fresh login", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  try {
    await f.client.request("/api/banks");
    t.mock.timers.tick(600001);
    await f.client.request("/api/banks");
    assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 2);
    assert.equal(f.calls.filter(c => c.path === "/api/auth/refresh").length, 0);
  } finally { f.client.dispose(); t.mock.timers.reset(); }
});

test("authentication timeout sanitizes abort errors without a password retry", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(c => new Promise<Response>((_, reject) => {
    c.init.signal?.addEventListener("abort", () => reject(new Error("raw abort details")), { once: true });
  }));
  try {
    const request = f.client.request("/api/banks");
    const check = assert.rejects(request, { code: "TIMEOUT", message: "OPENCREDIT_API_TIMEOUT" });
    t.mock.timers.tick(10001);
    await check;
    assert.equal(f.calls.length, 1);
  } finally { f.client.dispose(); t.mock.timers.reset(); }
});

test("client has no DB, logging, webhook linkage or persisted browser token storage", () => {
  const source = readFileSync(new URL("./opencredit-api-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.|safeLog|prisma|localStorage|sessionStorage|opencredit-webhook|opencredit-management/);
});

test("client declares the public server-only marker", () => {
  const source = readFileSync(new URL("./opencredit-api-client.ts", import.meta.url), "utf8");
  assert.match(source, /^import "server-only";/m);
});

test("existing runtime browser guard remains effective after the server-marker test bootstrap", async () => {
  const f = fixture(() => { throw new Error("transport must not run"); });
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  try {
    assert.throws(() => createOpenCreditApiClient(), { code: "CONFIGURATION" });
    await assert.rejects(f.client.request("/api/banks"), { code: "CONFIGURATION" });
    assert.equal(f.calls.length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
    f.client.dispose();
  }
});
