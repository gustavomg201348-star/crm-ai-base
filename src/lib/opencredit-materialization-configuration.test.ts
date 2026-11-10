import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module, { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import type { SessionUser } from "./auth";
let service: typeof import("./opencredit-materialization-configuration.service");
let boundary: typeof import("./opencredit-materialization-configuration-handler");
let requireAdmin: typeof import("./permissions").requirePlatformAdmin;
const old = process.env.PLATFORM_COMPANY_ID;
before(() => {
  process.env.PLATFORM_COMPANY_ID = "platform";
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { const require = createRequire(import.meta.url); service = require("./opencredit-materialization-configuration.service"); boundary = require("./opencredit-materialization-configuration-handler"); requireAdmin = require("./permissions").requirePlatformAdmin; }
  finally { loader._load = original; }
});
after(() => { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; });
const actor: SessionUser = { id: "actor", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const read = { action: "READ", companyId: "company", integrationId: "integration" };
const change = { ...read, action: "SET", materializationEnabled: true, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" };
const scope = "synthetic-scope" as Parameters<typeof service.setMaterializationConfiguration>[1]["providerScope"];
const state = { ok: true as const, companyId: "company", integrationId: "integration", enabled: false, paused: false,
  passiveInboundEnabled: true, materializationEnabled: false, interlockReady: false, bindingReserved: false, updatedAt: change.expectedUpdatedAt,
  queue: { claimableNow: 0, counts: { PENDING: 0, RETRY: 0, NEEDS_REVIEW: 0 }, complete: true } };
function req(body = JSON.stringify(read), headers: Record<string, string> = {}, url = "https://crm.example.invalid/api/admin/integrations/opencredit/materialization/configuration") {
  return new NextRequest(url, { method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json", ...headers }, body });
}
function handler(overrides: Partial<Parameters<typeof boundary.createMaterializationConfigurationHandler>[0]> = {}) {
  let writes = 0, reads = 0;
  const run = boundary.createMaterializationConfigurationHandler({ db: {} as never, getSession: async () => actor, requirePlatformAdmin: a => requireAdmin(a),
    enforceLimits: async () => null, resolveScope: () => scope, read: async () => { reads++; return state; }, write: async () => {
      writes++; return { ok: true, changed: true, companyId: "company", integrationId: "integration", materializationEnabled: true, interlockReady: true, updatedAt: change.expectedUpdatedAt };
    }, ...overrides });
  return { run, counts: () => [reads, writes] };
}
test("closed parser requires explicit boolean and optimistic version, rejects scope/secret/unexpected fields", () => {
  assert(service.parseMaterializationConfiguration(read)); assert(service.parseMaterializationConfiguration(change));
  for (const value of [{ ...change, materializationEnabled: "true" }, { ...change, expectedUpdatedAt: "bad" }, { ...change, expectedUpdatedAt: "2026-02-30T00:00:00.000Z" },
    { ...read, providerScope: "private" }, { ...change, webhookSecret: "private" }, { ...read, companyId: "x\n" }, { ...change, expectedUpdatedAt: undefined }]) assert.equal(service.parseMaterializationConfiguration(value), null);
});
test("Platform Admin is required for read and write", async () => {
  for (const action of [read, change]) for (const session of [null, { ...actor, role: "SUPERVISOR" as const }, { ...actor, companyId: "tenant" }]) {
    const f = handler({ getSession: async () => session }); const r = await f.run(req(JSON.stringify(action)));
    assert.equal(r.status, session ? 403 : 401); assert.equal(r.headers.get("cache-control"), "no-store"); assert.deepEqual(f.counts(), [0, 0]);
  }
});
for (const headers of [{ origin: "https://evil.invalid" }, { "sec-fetch-site": "cross-site" }, { authorization: "Bearer private" }, { "content-type": "text/plain" }] as Record<string, string>[])
  test("rejects origin/bearer/content type before dispatch: " + Object.keys(headers)[0], async () => {
    const f = handler(); assert([400, 403].includes((await f.run(req(undefined, headers))).status)); assert.deepEqual(f.counts(), [0, 0]);
  });
for (const body of ['{"action":"READ","action":"SET","companyId":"company","integrationId":"integration"}', '{"__proto__":{},"action":"READ","companyId":"company","integrationId":"integration"}', '{', '[]', ' '.repeat(1025)])
  test("strict JSON rejects malformed/duplicate/prototype/oversized input " + body.length, async () => {
    const f = handler(); assert.equal((await f.run(req(body))).status, 400); assert.deepEqual(f.counts(), [0, 0]);
  });
test("rate limits are scoped and preserve only safe Retry-After", async () => {
  const f = handler({ enforceLimits: async rules => { assert.deepEqual(rules.map(r => r.identifiers), [["platform", "actor"], ["company", "integration"]]); return new Response("private", { status: 429, headers: { "Retry-After": "12" } }); } });
  const r = await f.run(req()); assert.equal(r.status, 429); assert.equal(r.headers.get("retry-after"), "12"); assert.deepEqual(await r.json(), { error: "RATE_LIMITED" }); assert.deepEqual(f.counts(), [0, 0]);
});
test("complete JSON in an unclosed stream still fails the body deadline without dispatch", async () => {
  const f = handler();
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(change))); } });
  const request = new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/materialization/configuration", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: stream, duplex: "half",
  } as NonNullable<ConstructorParameters<typeof NextRequest>[1]>);
  assert.equal((await f.run(request)).status, 400); assert.deepEqual(f.counts(), [0, 0]);
});
test("unavailable limits/scope fail closed and never expose free exceptions", async () => {
  for (const deps of [{ enforceLimits: async () => { throw Error("PRIVATE_SQL_SECRET"); } }, { resolveScope: () => { throw Error("PRIVATE_SQL_SECRET"); } }]) {
    const f = handler(deps); const r = await f.run(req(JSON.stringify(change))); assert.equal(r.status, 503); assert(!JSON.stringify(await r.json()).includes("PRIVATE")); assert.deepEqual(f.counts(), [0, 0]);
  }
});
test("read and set dispatch without exposing scope, secret or candidates", async () => {
  const f = handler(); for (const value of [read, change]) { const r = await f.run(req(JSON.stringify(value))); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store"); }
  assert.deepEqual(f.counts(), [1, 1]);
});
test("safe domain conflict codes stay closed and no-store", async () => {
  for (const code of ["ROLLOUT_RESERVED", "GATES_INVALID", "CONFLICT", "NOT_FOUND", "NOT_AUTHORIZED"] as const) {
    const f = handler({ write: async () => { throw new service.MaterializationConfigurationError(code); } });
    const r = await f.run(req(JSON.stringify(change))); assert.equal(r.status, code === "NOT_FOUND" ? 404 : code === "NOT_AUTHORIZED" ? 403 : 409); assert.deepEqual(await r.json(), { error: code });
  }
});
test("an unrecognized typed error cannot disclose private text", async () => {
  const f = handler({ write: async () => { throw new service.MaterializationConfigurationError("PRIVATE_SENTINEL" as never); } });
  const r = await f.run(req(JSON.stringify(change))); assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: "UNAVAILABLE" });
});
test("configuration writer never creates jobs, claims, releases rollouts or reads secret columns", () => {
  const source = readFileSync("src/lib/opencredit-materialization-configuration.service.ts", "utf8");
  for (const forbidden of ["webhookSecret", "protectedEnvelope", "createClient(", "openCreditLeadMaterialization.create", "claim("]) {
    assert(!source.includes(forbidden));
  }
  assert(!source.includes("openCreditMaterializationRolloutBudget.update"));
  assert(source.includes("getOpenCreditMaterializationPreflight"));
});
