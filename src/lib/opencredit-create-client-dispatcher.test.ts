import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module, { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import * as ts from "typescript";
import type { SessionUser } from "./auth";
import type { OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";
import type { OpenCreditCreateClientDiagnostic } from "./opencredit-create-client-diagnostic";

let dispatcher: typeof import("./opencredit-create-client-dispatcher");
let api: typeof import("./opencredit-api-client");
let scope: typeof import("./opencredit-provider-scope-resolver");
let operationService: typeof import("./opencredit-commercial-operation.service");
const observations: OpenCreditCreateClientObservation[] = [];
const diagnostics: OpenCreditCreateClientDiagnostic[] = [];
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }; const original = loader._load;
  loader._load = (s, ...a) => {
    if (s === "server-only") return {};
    const value = original.call(loader, s, ...a);
    if (s === "./opencredit-create-client-diagnostic.service") return { ...(value as Record<string, unknown>),
      persistCreateClientDiagnostic: async (_db: unknown, _input: unknown, diagnostic: OpenCreditCreateClientDiagnostic) => { diagnostics.push({ ...diagnostic }); return true; },
      logCreateClientDiagnostic: () => {} };
    if (s === "./opencredit-commercial-operation.service") {
      const domain = value as typeof import("./opencredit-commercial-operation.service");
      return { ...domain, applyOpenCreditCreateClientObservation: (...args: Parameters<typeof domain.applyOpenCreditCreateClientObservation>) => {
        observations.push(args[2]); return domain.applyOpenCreditCreateClientObservation(...args);
      } };
    }
    return value;
  };
  try { dispatcher = await import("./opencredit-create-client-dispatcher"); api = await import("./opencredit-api-client"); scope = await import("./opencredit-provider-scope-resolver"); operationService = await import("./opencredit-commercial-operation.service"); }
  finally { loader._load = original; }
});
const actor: SessionUser = { id: "synthetic-admin", companyId: "synthetic-platform", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
const command = () => ({ actor: { ...actor }, companyId: "synthetic-company", operationId: "synthetic-operation", expectedRevision: 0 });
const positive = (success = true, created = true, status = 201) => Response.json({ data: { success, created } }, { status });
type Db = Parameters<typeof dispatcher.dispatchOpenCreditCreateClient>[0];
function database() {
  const providerScope = scope.resolveConfiguredOpenCreditProviderScope();
  const identity = { id: "synthetic-identity", companyId: "synthetic-company", contactId: "synthetic-contact", providerScope, normalizedCpf: "00000000000", enabled: true };
  const state = { operation: { id: "synthetic-operation", companyId: "synthetic-company", providerScope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT", state: "PREPARED", revision: 0 },
    active: true, failCommit: false, failTerminalEvent: false, actorPresent: true, events: [] as Record<string, unknown>[] };
  const order: string[] = []; let transactions = 0;
  const db = { $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
    transactions++; order.push("transaction"); let operation = { ...state.operation }; const events = [...state.events];
    const tx = {
      user: { findUnique: async () => state.actorPresent ? actor : null }, company: { findUnique: async () => ({ id: "synthetic-company" }) },
      contact: { findUnique: async () => ({ id: identity.contactId, companyId: identity.companyId, name: "Synthetic", phone: "0007A", email: null, cpf: identity.normalizedCpf, archivedAt: null }), findMany: async () => [{ id: identity.contactId }] },
      openCreditCommercialAccess: { findUnique: async () => ({ enabled: true }) },
      openCreditRemoteIdentity: { findUnique: async () => identity },
      openCreditConsumerAuthorization: { findUnique: async () => ({ id: "synthetic-auth", companyId: identity.companyId, contactId: identity.contactId, providerScope, remoteIdentityId: identity.id, purpose: "CLIENT_PROFILE_UPSERT", active: state.active, revision: 0, evidenceInboundEventId: "synthetic-evidence" }) },
      openCreditConsumerAuthorizationEvent: { findUnique: async () => ({ id: "synthetic-grant", authorizationId: "synthetic-auth", companyId: identity.companyId, providerScope, revision: 0, action: "GRANTED", nextActive: true, evidenceInboundEventId: "synthetic-evidence" }) },
      openCreditCommercialOperation: { findUnique: async () => operation, updateMany: async ({ where, data }: { where: { state: string; revision: number }; data: { state: string; revision: number } }) => {
        assert.equal(where.state, operation.state); assert.equal(where.revision, operation.revision); operation = { ...operation, ...data }; return { count: 1 };
      } },
      openCreditCommercialOperationEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
        if (state.failTerminalEvent && data.previousState === "IN_FLIGHT") throw Error("private"); events.push(data); return { id: "synthetic-event" };
      } }
    };
    const result = await run(tx); if (state.failCommit) throw Error("private");
    state.operation = operation; state.events = events; order.push("commit"); return result;
  } } as unknown as Db;
  return { db, state, order, transactions: () => transactions };
}
async function configured(run: (f: ReturnType<typeof database>) => Promise<void>) {
  observations.length = 0;
  diagnostics.length = 0;
  const keys = ["OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID", "PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS"];
  const old = keys.map(k => process.env[k]);
  ["Synthetic-Tenant", "Synthetic-Partner", actor.companyId, actor.email].forEach((v, i) => { process.env[keys[i]] = v; });
  try { await run(database()); } finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
}
function client(f: ReturnType<typeof database>, response: () => Response | Promise<Response> = () => positive()) {
  let posts = 0, auth = 0; let sent: RequestInit | undefined;
  const instance = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic-only" }), fetch: (async (url, init) => {
    if (String(url).endsWith("/api/auth/login")) { auth++; f.order.push("auth"); return Response.json({ data: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 28800 } }); }
    assert.equal(String(url), "https://core.api.opencredit.tech/api/tenants/Synthetic-Tenant/integration/clients");
    assert.equal(f.state.operation.state, "IN_FLIGHT"); assert.equal(f.order.at(-1), "commit");
    posts++; f.order.push("post"); sent = init; return response();
  }) as typeof fetch });
  return { instance, posts: () => posts, auth: () => auth, sent: () => sent };
}
for (const [success, created] of [[true, true], [true, false], [false, false], [false, true]]) test(`dispatch 201 ${success}/${created}`, () => configured(async f => {
  const c = client(f, () => positive(success, created));
  try {
    const result = await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance });
    assert.deepEqual(result, success ? { operationId: "synthetic-operation", state: "SUCCEEDED", revision: 2, created } : { operationId: "synthetic-operation", state: "UNKNOWN", revision: 2 });
    assert.equal(diagnostics[0].providerHttpStatus, 201);
    assert.equal(diagnostics[0].providerSuccess, success); assert.equal(diagnostics[0].providerCreated, created);
    assert.equal(diagnostics[0].category, success ? "NONE" : "PROVIDER_SUCCESS_FALSE");
    assert.equal(diagnostics.at(-1)!.settlement, "CONFIRMED");
    assert.deepEqual(f.order, ["auth", "transaction", "commit", "post", "transaction", "commit"]);
    assert.equal(c.posts(), 1); assert.equal(c.sent()!.body, '{"cpf":"00000000000","nome":"Synthetic","celular":"0007A"}');
    assert.equal(f.state.events.length, 2); assert.equal(f.state.events[0].dispatchAuthorizationEventId, "synthetic-grant");
    assert.equal(JSON.stringify(result).includes("00000000000"), false); assert.equal(f.state.events.some(e => JSON.stringify(e).includes("profile")), false);
  } finally { c.instance.dispose(); }
}));
for (const status of [200, 202, 400, 401, 403, 429, 500]) test("non-201 one-shot UNKNOWN " + status, () => configured(async f => {
  const c = client(f, () => positive(true, true, status));
  try { assert.equal((await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance })).state, "UNKNOWN"); assert.equal(c.posts(), 1); assert.equal(c.auth(), 1); }
  finally { c.instance.dispose(); }
}));
const invalidResponses: [string, () => Response | Promise<Response>][] = [
  ["INVALID_CONTENT_TYPE", () => new Response("private", { status: 201 })],
  ["TOO_LARGE", () => new Response(" ".repeat(65537), { status: 201, headers: { "content-type": "application/json" } })],
  ["INVALID_UTF8", () => new Response(new Uint8Array([0xc3]), { status: 201, headers: { "content-type": "application/json" } })],
  ["INVALID_JSON", () => new Response('{"data":1,"data":2}', { status: 201, headers: { "content-type": "application/json" } })],
  ["STREAM_ERROR", () => new Response(new ReadableStream({ start(c) { c.error(Error("private")); } }), { status: 201, headers: { "content-type": "application/json" } })],
  ["INVALID_RESPONSE", async () => { const r = positive(); await r.text(); return r; }],
  ["INVALID_CONTRACT", () => Response.json({ data: { success: "true", created: true }, private: "never returned" }, { status: 201 })],
  ["NETWORK", () => { throw Error("private"); }]
];
for (const [label, response] of invalidResponses) test("ambiguous observation " + label, () => configured(async f => {
  const c = client(f, response);
  try { assert.deepEqual(await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance }), { operationId: "synthetic-operation", state: "UNKNOWN", revision: 2 }); assert.equal(c.posts(), 1); assert.equal(f.state.events.at(-1)!.action, "MARKED_UNKNOWN"); }
  finally { c.instance.dispose(); }
}));
for (const mode of ["body", "transport"] as const) test("post-commit " + mode + " timeout becomes UNKNOWN without replay", async t => configured(async f => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let posts = 0;
  const c = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic", password: "synthetic" }), fetch: (async (url, init) => {
    if (String(url).endsWith("/api/auth/login")) return Response.json({ data: { accessToken: "synthetic", refreshToken: "synthetic", expiresIn: 28800 } });
    posts++; assert.equal(f.state.operation.state, "IN_FLIGHT");
    if (mode === "body") return new Response(new ReadableStream({ start() { /* Deliberately stalled fake body. */ } }), { status: 201, headers: { "content-type": "application/json" } });
    return new Promise((_, reject) => init!.signal!.addEventListener("abort", () => reject(Error("synthetic"))));
  }) as typeof fetch });
  try {
    const promise = dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c });
    while (!posts) await new Promise<void>(r => setImmediate(r));
    // Allow the strict reader to install its body deadline before advancing fake time.
    await new Promise<void>(r => setImmediate(r)); t.mock.timers.tick(20_001);
    assert.equal((await promise).state, "UNKNOWN"); assert.equal(posts, 1); assert.equal(f.state.events.at(-1)!.action, "MARKED_UNKNOWN");
  } finally { c.dispose(); }
}));
test("closed input does not execute getters or accept browser use", () => configured(async f => {
  const c = client(f); let gets = 0;
  try {
    const value = { ...command(), get operationId() { gets++; throw Error("private"); } };
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, value as unknown as ReturnType<typeof command>, { client: c.instance }), { code: "INVALID_INPUT" });
    assert.equal(gets, 0); assert.equal(c.auth(), 0);
    Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
    try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance }), { code: "INVALID_INPUT" }); }
    finally { Reflect.deleteProperty(globalThis, "window"); }
  } finally { c.instance.dispose(); }
}));
for (const extra of ["tenantId", "partnerId", "providerScope", "contactId", "cpf", "profile", "authorizationId", "authorizationEventId", "intentKey", "URL", "path", "headers", "token"]) test("closed input rejects " + extra, () => configured(async f => {
  const c = client(f);
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, { ...command(), [extra]: "private" }, { client: c.instance }), { code: "INVALID_INPUT" }); assert.equal(c.auth(), 0); assert.equal(f.transactions(), 0); }
  finally { c.instance.dispose(); }
}));
for (const change of [{ companyId: "bad/path" }, { operationId: "bad\n" }, { expectedRevision: -1 }, { expectedRevision: 1.5 }, { actor: { ...actor, role: "AGENT" } }, { actor: null }]) test("malformed command rejected before auth " + Object.keys(change), () => configured(async f => {
  const c = client(f);
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, { ...command(), ...change } as ReturnType<typeof command>, { client: c.instance }), { code: "INVALID_INPUT" }); assert.equal(c.auth(), 0); }
  finally { c.instance.dispose(); }
}));
test("invalid config never authenticates or reserves", () => configured(async f => {
  delete process.env.OPENCREDIT_TENANT_ID; const c = client(f);
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance }), { code: "CONFIGURATION" }); assert.equal(c.auth(), 0); assert.equal(f.transactions(), 0); }
  finally { c.instance.dispose(); }
}));
for (const code of ["CONFIGURATION", "AUTH_FAILED", "INVALID_RESPONSE", "NETWORK", "TIMEOUT", "DISPOSED"] as const) test("pre-dispatch " + code + " preserves PREPARED", () => configured(async f => {
  const c = api.createOpenCreditApiClient({ credentials: () => ({ email: code === "CONFIGURATION" ? "" : "synthetic", password: "synthetic" }),
    fetch: (async () => { throw new api.OpenCreditApiError(code); }) as typeof fetch });
  if (code === "DISPOSED") c.dispose();
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c })); assert.equal(f.transactions(), 0); assert.equal(f.state.operation.state, "PREPARED"); assert.deepEqual(f.state.events, []); }
  finally { c.dispose(); }
}));
for (const failure of ["authorization", "commit", "actor"]) test("reservation failure zero POST " + failure, () => configured(async f => {
  if (failure === "authorization") f.state.active = false;
  if (failure === "commit") f.state.failCommit = true;
  if (failure === "actor") f.state.actorPresent = false;
  const c = client(f);
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance })); assert.equal(c.posts(), 0); assert.equal(f.state.operation.state, "PREPARED"); assert.deepEqual(f.state.events, []); }
  finally { c.instance.dispose(); }
}));
test("revoke during fake HTTP does not block terminal settlement", () => configured(async f => {
  const c = client(f, () => { f.state.active = false; return positive(); });
  try { assert.equal((await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance })).state, "SUCCEEDED"); assert.equal(f.state.active, false); }
  finally { c.instance.dispose(); }
}));
test("terminal Event failure rolls back settlement and never repeats POST", () => configured(async f => {
  const c = client(f, () => { f.state.failTerminalEvent = true; return positive(); });
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance }), { code: "SETTLEMENT_FAILED", message: "OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED" }); assert.equal(c.posts(), 1); assert.equal(f.state.operation.state, "IN_FLIGHT"); assert.equal(f.state.events.length, 1); }
  finally { c.instance.dispose(); }
}));

/** Exercise actual second module evaluation, not a subclass of the local class. */
function independentModule<T>(specifier: string): T {
  const require = createRequire(import.meta.url), filename = require.resolve(specifier), cached = require.cache[filename];
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }; const original = loader._load;
  try {
    delete require.cache[filename];
    loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
    return require(filename) as T;
  } finally { loader._load = original; if (cached) require.cache[filename] = cached; else delete require.cache[filename]; }
}
for (const code of ["AUTH_FAILED", "TIMEOUT"] as const) test("separately loaded API " + code + " maps before reservation", () => configured(async f => {
  const other = independentModule<typeof api>("./opencredit-api-client.ts");
  assert.notEqual(other.OpenCreditApiError, api.OpenCreditApiError);
  const failure = new other.OpenCreditApiError(code, code === "AUTH_FAILED" ? 401 : undefined);
  assert(failure instanceof Error); assert.equal(failure instanceof api.OpenCreditApiError, false);
  let calls = 0;
  const c = other.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic", password: "synthetic" }), fetch: (async () => { calls++; throw failure; }) as typeof fetch });
  try {
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c }), { code: code === "AUTH_FAILED" ? "AUTHENTICATION" : "PRE_DISPATCH_UNAVAILABLE" });
    assert.equal(calls, 1); assert.equal(f.transactions(), 0); assert.equal(f.state.operation.state, "PREPARED"); assert.deepEqual(observations, []);
  } finally { c.dispose(); other.openCreditApiClient.dispose(); }
}));
test("separately loaded API TIMEOUT after commit records TIMEOUT, UNKNOWN, one attempt", () => configured(async f => {
  const other = independentModule<typeof api>("./opencredit-api-client.ts");
  assert.notEqual(other.OpenCreditApiError, api.OpenCreditApiError);
  let posts = 0;
  const c = other.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic", password: "synthetic" }), fetch: (async (url) => {
    if (String(url).endsWith("/api/auth/login")) return Response.json({ data: { accessToken: "synthetic", refreshToken: "synthetic", expiresIn: 28800 } });
    posts++; assert.equal(f.state.operation.state, "IN_FLIGHT"); throw new other.OpenCreditApiError("TIMEOUT");
  }) as typeof fetch });
  try {
    assert.equal((await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c })).state, "UNKNOWN");
    assert.deepEqual(observations, [{ kind: "NO_RESPONSE", reason: "TIMEOUT" }]); assert.equal(posts, 1);
  } finally { c.dispose(); other.openCreditApiClient.dispose(); }
}));
for (const code of ["CONSUMER_AUTHORIZATION_INACTIVE", "IDENTITY_DISABLED", "COMMERCIAL_ACCESS_DISABLED", "OPERATION_STATE_CONFLICT"] as const) test("separate domain module preserves " + code + " in fresh error", () => configured(async f => {
  const other = independentModule<typeof operationService>("./opencredit-commercial-operation.service.ts");
  assert.notEqual(other.OpenCreditCommercialOperationServiceError, operationService.OpenCreditCommercialOperationServiceError);
  const failure = new other.OpenCreditCommercialOperationServiceError(code);
  assert(failure instanceof Error); assert.equal(failure instanceof operationService.OpenCreditCommercialOperationServiceError, false);
  const c: Pick<typeof api.openCreditApiClient, "postJsonAfterCommit"> = { async postJsonAfterCommit() { throw failure; } };
  await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c }), e => {
    assert.notEqual(e, failure); assert.equal(operationService.readOpenCreditCommercialOperationServiceErrorCode(e), code); return true;
  });
  assert.equal(f.transactions(), 0); assert.deepEqual(observations, []);
}));
test("forged pre-dispatch errors fail closed and never execute getters", () => configured(async f => {
  let reads = 0;
  const getterCode = new Error("OPENCREDIT_API_AUTH_FAILED"); Object.defineProperty(getterCode, "code", { get() { reads++; throw Error("private"); } });
  const getterMessage = Object.assign(new Error(), { code: "AUTH_FAILED" }); Object.defineProperty(getterMessage, "message", { get() { reads++; throw Error("private"); } });
  const getterStatus = new api.OpenCreditApiError("AUTH_FAILED"); Object.defineProperty(getterStatus, "status", { get() { reads++; throw Error("private"); } });
  const failures: unknown[] = [{ code: "AUTH_FAILED", message: "OPENCREDIT_API_AUTH_FAILED" }, Object.assign(new Error("wrong"), { code: "AUTH_FAILED" }), getterCode, getterMessage, getterStatus];
  for (const code of ["__proto__", "constructor", "toString"]) failures.push(Object.assign(new Error("OPENCREDIT_API_" + code), { code }));
  for (const failure of failures) {
    const c: Pick<typeof api.openCreditApiClient, "postJsonAfterCommit"> = { async postJsonAfterCommit() { throw failure; } };
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c }), { code: "PRE_DISPATCH_UNAVAILABLE" });
  }
  assert.equal(reads, 0); assert.equal(f.transactions(), 0); assert.deepEqual(observations, []);
}));
test("unrecognized post-commit error is NETWORK observation with no replay", () => configured(async f => {
  let attempts = 0;
  const failure = Object.assign(new Error("wrong"), { code: "TIMEOUT" });
  const c: Pick<typeof api.openCreditApiClient, "postJsonAfterCommit"> = { async postJsonAfterCommit(_path, commit) { await commit(); attempts++; throw failure; } };
  assert.equal((await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c })).state, "UNKNOWN");
  assert.deepEqual(observations, [{ kind: "NO_RESPONSE", reason: "NETWORK" }]); assert.equal(attempts, 1);
}));
test("runtime import guard covers extension variants", () => {
  const pattern = /(?:^|\/)opencredit-create-client-dispatcher(?:\.[cm]?[jt]s)?$/;
  for (const extension of ["", ".ts", ".js", ".cts", ".mts", ".cjs", ".mjs"]) assert(pattern.test("./opencredit-create-client-dispatcher" + extension));
});

for (const status of [400, 401, 500]) test("safe diagnostic non-201 JSON " + status, () => configured(async f => {
  const privateText = "00000000000 +55 (00) 90000-0000 private@example.invalid Bearer synthetic-access password synthetic-only";
  const c = client(f, () => Response.json({ requestId: "req_abcdefabcdef", error: { code: "VALIDATION_ERROR", message: privateText },
    accessToken: "synthetic-access", refreshToken: "synthetic-refresh", customer: privateText },
  { status, headers: { "x-correlation-id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" } }));
  try {
    await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance });
    const d = diagnostics[0]; assert.equal(d.category, "HTTP_NON_201"); assert.equal(d.providerHttpStatus, status);
    assert.equal(d.providerRequestId, "req_abcdefabcdef"); assert.equal(d.providerErrorCode, "VALIDATION_ERROR");
    assert.equal(d.providerCorrelationId, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert.equal(d.responseParsed, true); assert.equal(c.posts(), 1);
    assert.doesNotMatch(JSON.stringify(diagnostics), /00000000000|90000|private@|Bearer|synthetic-access|synthetic-refresh|synthetic-only|customer/);
  } finally { c.instance.dispose(); }
}));
test("diagnostics discard arbitrary error messages and unsafe/missing IDs", () => configured(async f => {
  const c = client(f, () => Response.json({ requestId: "00000000000", error: { code: "SECRET_PRIVATE", message: "anything" } },
    { status: 400, headers: { "x-request-id": "Bearer secret", "x-correlation-id": "email@example.invalid" } }));
  try { await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance });
    assert.equal(diagnostics[0].providerRequestId, null); assert.equal(diagnostics[0].providerCorrelationId, null);
    assert.equal(diagnostics[0].providerErrorCode, null); assert.doesNotMatch(JSON.stringify(diagnostics), /secret|anything|example.invalid|00000000000/i);
  } finally { c.instance.dispose(); }
}));
for (const [label, response] of invalidResponses) test("diagnostic body failure " + label, () => configured(async f => {
  const c = client(f, response);
  try { await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance });
    assert.equal(c.posts(), 1); assert.equal(diagnostics[0].providerHttpStatus, label === "NETWORK" ? null : 201);
    if (label === "INVALID_JSON") { assert.equal(diagnostics[0].responseReadable, true); assert.equal(diagnostics[0].responseParsed, false); }
    assert.notEqual(diagnostics[0].category, "NONE"); assert.equal(diagnostics.at(-1)!.settlement, "CONFIRMED");
  } finally { c.instance.dispose(); }
}));
test("settlement failure retains independent observation and records ERROR without second POST", () => configured(async f => {
  f.state.failTerminalEvent = true; const c = client(f);
  try { await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c.instance }), { code: "SETTLEMENT_FAILED" });
    assert.equal(c.posts(), 1); assert.equal(f.state.operation.state, "IN_FLIGHT");
    assert.equal(diagnostics[0].providerSuccess, true); assert.equal(diagnostics[0].settlement, "NOT_CONFIRMED");
    assert.equal(diagnostics.at(-1)!.settlement, "ERROR");
  } finally { c.instance.dispose(); }
}));
test("authentication rejection is diagnosed before reservation with zero business POST", () => configured(async f => {
  let calls = 0;
  const c = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic", password: "synthetic" }), fetch: (async () => {
    calls++; return Response.json({ error: { message: "PRIVATE" } }, { status: 401 });
  }) as typeof fetch });
  try {
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c }), { code: "AUTHENTICATION" });
    assert.equal(calls, 1); assert.equal(f.state.operation.state, "PREPARED"); assert.equal(f.state.events.length, 0);
    assert.equal(diagnostics[0].category, "AUTH_ERROR"); assert.equal(diagnostics[0].providerHttpStatus, 401);
    assert.equal(diagnostics[0].dispatchCommittedAt, null); assert.equal(diagnostics[0].settlement, "NOT_ATTEMPTED");
  } finally { c.dispose(); }
}));
test("opaque tokens shaped like valid provider IDs are never persisted as correlation metadata", () => configured(async f => {
  const access = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", refresh = "req_abcdefabcdef"; let posts = 0;
  const c = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic", password: "synthetic" }), fetch: (async url => {
    if (String(url).endsWith("/api/auth/login")) return Response.json({ data: { accessToken: access, refreshToken: refresh, expiresIn: 28800 } });
    posts++; return Response.json({ data: { success: true, created: true }, requestId: refresh },
      { status: 201, headers: { "x-correlation-id": access } });
  }) as typeof fetch });
  try { await dispatcher.dispatchOpenCreditCreateClient(f.db, command(), { client: c });
    assert.equal(posts, 1); assert.equal(diagnostics[0].providerRequestId, null); assert.equal(diagnostics[0].providerCorrelationId, null);
    assert(!JSON.stringify(diagnostics).includes(access)); assert(!JSON.stringify(diagnostics).includes(refresh));
  } finally { c.dispose(); }
}));

test("AST guards: exact dispatcher core, one-shot caller only; single human command consumer", () => {
  const filename = "src/lib/opencredit-create-client-dispatcher.ts";
  const source = readFileSync(filename, "utf8");
  assert.match(source, /^import "server-only";/);
  assert.doesNotMatch(source, /instanceof (?:OpenCreditApiError|OpenCreditCommercialOperationServiceError)/);
  assert.doesNotMatch(source, /\bfetch\b|console\.|\.request\(|prepareOpenCredit|grantOpenCredit|mark.*Failed|"FAILED"|setInterval|setTimeout|\bwhile\b/);
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const execution = tree.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "dispatchOpenCreditCreateClient")!;
  assert.doesNotMatch(execution.getText(tree), /\bfor\s*\(/);
  let callers = 0;
  for (const root of ["src", "scripts"]) for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = root + "/" + file.replace(/\\/g, "/");
    if (!/\.[cm]?[jt]sx?$/.test(path) || /\.(test|integration)\./.test(path)) continue;
    const text = readFileSync(path, "utf8"); const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteralLike(n) && /(?:^|\/)opencredit-create-client-dispatcher(?:\.[cm]?[jt]s)?$/.test(n.text)) {
        assert.equal(path, "src/lib/opencredit-create-client-dispatch-admin-handler.ts");
        assert(ts.isImportDeclaration(n.parent));
      }
      if (ts.isPropertyAccessExpression(n) && n.name.text === "postJsonAfterCommit") { callers++; assert.equal(path, filename); }
      if ((ts.isIdentifier(n) || ts.isStringLiteralLike(n)) && n.text === "postJsonAfterCommit") assert([filename, "src/lib/opencredit-api-client.ts"].includes(path));
      ts.forEachChild(n, visit);
    }; visit(ast);
  }
  assert.equal(callers, 1);
  assert.doesNotMatch(readFileSync("src/lib/opencredit-commercial-operation.service.ts", "utf8"), /fetch|opencredit-api-client|data:\s*\{[^}]*profileJson/);
});
