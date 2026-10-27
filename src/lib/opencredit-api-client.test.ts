import assert from "node:assert/strict";
import { before, test } from "node:test";
import { readFileSync } from "node:fs";
import Module from "node:module";

let createOpenCreditApiClient: typeof import("./opencredit-api-client").createOpenCreditApiClient;
let OpenCreditApiError: typeof import("./opencredit-api-client").OpenCreditApiError;
let readApiErrorCode: typeof import("./opencredit-api-client").readOpenCreditApiErrorCode;

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
    readApiErrorCode = client.readOpenCreditApiErrorCode;
  } finally {
    loader._load = original;
  }
});

const creds = { email: "partner@example.invalid", password: "fictitious-test-password" };
for (const code of ["CONFIGURATION", "AUTH_FAILED", "INVALID_RESPONSE", "NETWORK", "TIMEOUT", "INVALID_PATH", "DISPOSED"] as const) {
  test("closed API error reader accepts exact code/message " + code, () => {
    for (const status of [undefined, 100, 401, 599]) assert.equal(readApiErrorCode(new OpenCreditApiError(code, status)), code);
    const absent = new OpenCreditApiError(code); Reflect.deleteProperty(absent, "status"); assert.equal(readApiErrorCode(absent), code);
  });
}
test("API error reader rejects plain, forged, inherited and malformed contracts", () => {
  for (const value of [null, undefined, {}, { code: "AUTH_FAILED", message: "OPENCREDIT_API_AUTH_FAILED" }, new Error("wrong")]) assert.equal(readApiErrorCode(value), null);
  for (const code of ["__proto__", "constructor", "toString", "OTHER"]) {
    const error = Object.assign(new Error("OPENCREDIT_API_" + code), { code }); assert.equal(readApiErrorCode(error), null);
  }
  assert.equal(readApiErrorCode(Object.assign(new Error("wrong"), { code: "AUTH_FAILED" })), null);
  const inherited = Object.create(new OpenCreditApiError("AUTH_FAILED")); assert(inherited instanceof Error); assert.equal(readApiErrorCode(inherited), null);
  for (const status of [null, "401", 99, 600, 401.5, NaN, Infinity, {}, []]) {
    const error = new OpenCreditApiError("AUTH_FAILED"); Object.defineProperty(error, "status", { value: status }); assert.equal(readApiErrorCode(error), null);
  }
});
for (const key of ["code", "message", "status"]) test("API error reader never executes " + key + " accessors", () => {
  let reads = 0;
  for (const descriptor of [{ get() { reads++; throw Error("private"); } }, { set(_v: unknown) { reads++; } }]) {
    const error = new OpenCreditApiError("AUTH_FAILED"); Object.defineProperty(error, key, descriptor); assert.equal(readApiErrorCode(error), null);
  }
  assert.equal(reads, 0);
});
test("API error reader ignores raw properties and rejects inherited status without getter reads", () => {
  let reads = 0; const error = new OpenCreditApiError("TIMEOUT");
  for (const key of ["stack", "cause", "body", "headers", "credentials"]) Object.defineProperty(error, key, { get() { reads++; throw Error("private"); } });
  assert.equal(readApiErrorCode(error), "TIMEOUT"); assert.equal(reads, 0);
  Reflect.deleteProperty(error, "status");
  const prototype = Object.create(Error.prototype); Object.defineProperty(prototype, "status", { get() { reads++; throw Error("private"); } }); Object.setPrototypeOf(error, prototype);
  assert.equal(readApiErrorCode(error), null); assert.equal(reads, 0);
  const { proxy, revoke } = Proxy.revocable(new Error(), {}); revoke(); assert.equal(readApiErrorCode(proxy), null);
});
const pair = (suffix = "1", expiresIn = 28800) => Response.json({ data: {
  accessToken: `test-access-${suffix}`, refreshToken: `test-refresh-${suffix}`, expiresIn
} });

for (const status of [200, 401, 403, 429, 500]) test("getOnce authenticates then executes exactly one GET without 401 replay " + status, async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response("unread", { status }));
  const r = await f.client.getOnce("/api/tenants/synthetic/integration/clients/validate?cpf=synthetic&stage=simulate&product=clt");
  assert.equal(r.response.status, status); assert.equal(r.response.bodyUsed, false);
  assert.deepEqual(f.calls.map(c => c.init.method), ["POST", "GET"]);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].init.redirect, "error");
  assert.equal(f.calls[1].init.credentials, "omit"); assert.equal(f.calls[1].init.body, undefined); f.client.dispose();
});
test("getOnce shares the existing refresh cache BEFORE its sole GET", async () => {
  const f = fixture(c => c.path.startsWith("/api/auth/") ? pair() : Response.json({}));
  await f.client.getOnce("/api/test"); f.advance(8 * 60 * 60 * 1000); await f.client.getOnce("/api/test");
  assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/test", "/api/auth/refresh", "/api/test"]); f.client.dispose();
});
test("getOnce network failure never retries and diagnostic identifiers exclude credentials", async () => {
  const secret = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const f = fixture(c => c.path.startsWith("/api/auth/") ? pair() : Response.json({}));
  f.change({ ...creds, password: secret }); const r = await f.client.getOnce("/api/test");
  assert.equal(r.sanitizeDiagnosticIdentifier(secret), null); assert.equal(r.sanitizeDiagnosticIdentifier("12345678909"), null);
  assert.equal(r.sanitizeDiagnosticIdentifier("req_abcdefabcdef"), "req_abcdefabcdef"); f.client.dispose();
  const failed = fixture(c => { if (c.path.startsWith("/api/auth/")) return pair(); throw Error("private"); });
  await assert.rejects(failed.client.getOnce("/api/test"), { code: "NETWORK" }); assert.equal(failed.calls.length, 2); failed.client.dispose();
});
for (const path of ["https://example.invalid/api/test", "/api/auth/login", "/api/%2e%2e/test", "/api/a\\b", "/api/test\n"]) test("getOnce rejects unsafe path before auth " + path, async () => {
  const f = fixture(() => { throw Error(); }); await assert.rejects(f.client.getOnce(path), { code: "INVALID_PATH" }); assert.equal(f.calls.length, 0); f.client.dispose();
});
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

for (const path of ["https://elsewhere.invalid/api/test", "/api/auth/login", "/api/../auth/login", "/api/test#x", "/api/%2e%2e/test", "//elsewhere.invalid/api/test", "/api/%61uth/login", "/api/%252e%252e/auth/login", "/api/a%2f..%2fauth/login", "/api/a\\..\\auth/login", "/api/test\n"]) {
  test("one-shot rejects path before auth/commit " + path, async () => {
    const f = fixture(() => { throw Error(); }); let commits = 0;
    await assert.rejects(f.client.postJsonAfterCommit(path, async () => { commits++; return { body: "{}", committed: 1 }; }), { code: "INVALID_PATH" });
    assert.equal(commits, 0); assert.equal(f.calls.length, 0); f.client.dispose();
  });
}
for (const status of [201, 401, 403, 429, 500]) test("one-shot auth -> commit -> single POST, status " + status, async () => {
  const order: string[] = []; const response = new Response("DO_NOT_READ", { status });
  const f = fixture(c => { order.push(c.path === "/api/auth/login" ? "auth" : "post"); return c.path === "/api/auth/login" ? pair() : response; });
  let commits = 0;
  const result = await f.client.postJsonAfterCommit("/api/tenants/test/integration/clients", async (...args: unknown[]) => {
    assert.equal(args.length, 0); commits++; order.push("commit"); return { body: '{"cpf":"synthetic"}', committed: "opaque" };
  });
  assert.deepEqual(order, ["auth", "commit", "post"]); assert.equal(commits, 1);
  assert.equal(result.response, response); assert.equal(response.bodyUsed, false); assert.equal(result.committed, "opaque");
  const init = f.calls[1].init; assert.equal(init.method, "POST"); assert.equal(init.body, '{"cpf":"synthetic"}');
  assert.equal(new Headers(init.headers).get("Content-Type"), "application/json");
  assert.equal(new Headers(init.headers).get("Authorization"), "Bearer test-access-1");
  assert.equal(f.calls.length, 2); f.client.dispose();
});
test("one-shot ignores extraneous caller method/header options and callback token injection", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  await f.client.postJsonAfterCommit("/api/test", async () => ({ body: "{}", committed: null,
    method: "DELETE", headers: { Authorization: "caller", "Content-Type": "text/plain" } }));
  assert.equal(f.calls[1].init.method, "POST"); assert.equal(new Headers(f.calls[1].init.headers).get("Authorization"), "Bearer test-access-1"); f.client.dispose();
});
test("one-shot commit failure never attempts business transport", async () => {
  const f = fixture(() => pair()); const error = Error("synthetic commit failure");
  await assert.rejects(f.client.postJsonAfterCommit("/api/test", async () => { throw error; }), e => e === error);
  assert.equal(f.calls.length, 1); f.client.dispose();
});
for (const mode of ["NETWORK", "TIMEOUT"] as const) test("one-shot transport " + mode + " attempts once after commit", async t => {
  if (mode === "TIMEOUT") t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : mode === "NETWORK" ? Promise.reject(Error("private"))
    : new Promise((_, reject) => c.init.signal!.addEventListener("abort", () => reject(Error("private")))));
  let committed = false;
  const pending = f.client.postJsonAfterCommit("/api/test", async () => { committed = true; return { body: "{}", committed: 1 }; });
  const rejected = assert.rejects(pending, { code: mode, message: "OPENCREDIT_API_" + mode });
  if (mode === "TIMEOUT") { while (f.calls.length < 2) await new Promise<void>(r => setImmediate(r)); t.mock.timers.tick(10_001); }
  await rejected; assert.equal(committed, true); assert.equal(f.calls.length, 2); f.client.dispose();
});
test("one-shot 401 expires cached access for NEXT operation only", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : c.path === "/api/auth/refresh" ? pair("2") : new Response(null, { status: 401 }));
  const commit = async () => ({ body: "{}", committed: 1 });
  await f.client.postJsonAfterCommit("/api/test", commit); assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/test"]);
  await f.client.postJsonAfterCommit("/api/test", commit); assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/test", "/api/auth/refresh", "/api/test"]); f.client.dispose();
});
test("one-shot disposal while awaiting cached auth prevents the commit callback", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  await f.client.request("/api/warm"); let commits = 0;
  const pending = f.client.postJsonAfterCommit("/api/test", async () => { commits++; return { body: "{}", committed: 1 }; });
  f.client.dispose();
  await assert.rejects(pending, { code: "DISPOSED" }); assert.equal(commits, 0); assert.equal(f.calls.length, 2);
});

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

test("diagnoseAccess uses one fresh pair without changing the normal cached pair or refresh", async () => {
  let login = 0;
  const f = fixture(c => c.path === "/api/auth/login" ? pair(String(++login)) : c.path === "/api/auth/refresh" ? pair("refreshed") : new Response());
  try {
    await f.client.request("/api/banks");
    await f.client.diagnoseAccess("tenant-fixture", "partner-fixture");
    await f.client.request("/api/banks");
    const banks = f.calls.filter(c => !c.path.includes("/auth/"));
    assert.deepEqual(banks.map(c => new Headers(c.init.headers).get("authorization")),
      ["Bearer test-access-1", "Bearer test-access-2", "Bearer test-access-2", "Bearer test-access-2", "Bearer test-access-1"]);
    assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 2);
    assert.equal(f.calls.filter(c => c.path === "/api/auth/refresh").length, 0);
    f.advance(28800000); await f.client.request("/api/banks");
    const refresh = f.calls.find(c => c.path === "/api/auth/refresh");
    assert.deepEqual(JSON.parse(String(refresh?.init.body)), { refreshToken: "test-refresh-1" });
  } finally { f.client.dispose(); }
});

test("diagnoseAccess does not reset the normal cache idle timer", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  try {
    await f.client.request("/api/banks"); t.mock.timers.tick(300000);
    await f.client.diagnoseAccess("tenant-fixture", "partner-fixture"); t.mock.timers.tick(300001);
    await f.client.request("/api/banks");
    assert.equal(f.calls.filter(c => c.path === "/api/auth/login").length, 3);
    assert.equal(f.calls.filter(c => c.path === "/api/auth/refresh").length, 0);
  } finally { f.client.dispose(); t.mock.timers.reset(); }
});

test("verifyCredentials always logs in with the current password, returns void and never refreshes", async () => {
  const f = fixture(c => c.path === "/api/auth/login" ? pair() : new Response());
  try {
    await f.client.request("/api/banks");
    assert.equal(await f.client.verifyCredentials(), undefined);
    assert.equal(await f.client.verifyCredentials(), undefined);
    assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/banks", "/api/auth/login", "/api/auth/login"]);
    f.change({ ...creds, password: "rotated-fictitious-password" });
    await f.client.verifyCredentials();
    assert.deepEqual(JSON.parse(String(f.calls.at(-1)?.init.body)), { ...creds, password: "rotated-fictitious-password" });
    assert.equal(f.calls.at(-1)?.init.method, "POST");
    assert.equal(new Headers(f.calls.at(-1)?.init.headers).has("authorization"), false);
  } finally { f.client.dispose(); }
});

test("verifyCredentials does not publish its tokens or change request refresh policy", async () => {
  const f = fixture(c => c.path.includes("/auth/") ? pair() : new Response());
  try {
    await f.client.verifyCredentials();
    await f.client.request("/api/banks");
    assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/auth/login", "/api/banks"]);
    f.advance(28800000);
    await f.client.request("/api/banks");
    assert.deepEqual(f.calls.slice(-2).map(c => c.path), ["/api/auth/refresh", "/api/banks"]);
  } finally { f.client.dispose(); }
});

test("verifyCredentials cannot publish success after disposal", async () => {
  let finish!: (response: Response) => void;
  const f = fixture(() => new Promise<Response>(resolve => { finish = resolve; }));
  const verifying = f.client.verifyCredentials();
  f.client.dispose(); finish(pair());
  await assert.rejects(verifying, { code: "DISPOSED" });
  await assert.rejects(f.client.verifyCredentials(), { code: "DISPOSED" });
  assert.equal(f.calls.length, 1);
});

test("cached access cannot hide a rejected password probe or trigger refresh fallback", async () => {
  let logins = 0;
  const f = fixture(c => c.path === "/api/auth/login"
    ? (++logins === 1 ? pair() : new Response("sensitive-provider-error", { status: 401 })) : new Response());
  try {
    await f.client.request("/api/banks");
    await assert.rejects(f.client.verifyCredentials(), { code: "AUTH_FAILED", status: 401, message: "OPENCREDIT_API_AUTH_FAILED" });
    assert.deepEqual(f.calls.map(c => c.path), ["/api/auth/login", "/api/banks", "/api/auth/login"]);
  } finally { f.client.dispose(); }
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
