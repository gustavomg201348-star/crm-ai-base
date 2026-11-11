import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module, { createRequire } from "node:module";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import type { SessionUser } from "./auth";
let service: typeof import("./opencredit-materialization-configuration.service");
let boundary: typeof import("./opencredit-materialization-configuration-handler");
let pilotService: typeof import("./opencredit-materialization-single-admission.service");
let requireAdmin: typeof import("./permissions").requirePlatformAdmin;
const old = process.env.PLATFORM_COMPANY_ID;
before(() => {
  process.env.PLATFORM_COMPANY_ID = "platform";
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { const require = createRequire(import.meta.url); service = require("./opencredit-materialization-configuration.service"); boundary = require("./opencredit-materialization-configuration-handler"); requireAdmin = require("./permissions").requirePlatformAdmin; pilotService = require("./opencredit-materialization-single-admission.service"); }
  finally { loader._load = original; }
});
after(() => { if (old === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = old; });
const actor: SessionUser = { id: "actor", companyId: "platform", name: "Synthetic", email: "synthetic@example.invalid", role: "ADMIN" };
const read = { action: "READ", companyId: "company", integrationId: "integration" };
const change = { ...read, action: "SET", materializationEnabled: true, expectedUpdatedAt: "2026-01-01T00:00:00.000Z" };
const scope = "synthetic-scope" as Parameters<typeof service.setMaterializationConfiguration>[1]["providerScope"];
const state = { ok: true as const, companyId: "company", integrationId: "integration", enabled: false, paused: false,
  passiveInboundEnabled: true, materializationEnabled: false, interlockReady: false, bindingReserved: false, autoStartOperational: false, updatedAt: change.expectedUpdatedAt,
  queue: { claimableNow: 0, counts: { PENDING: 0, RETRY: 0, NEEDS_REVIEW: 0 }, complete: true }, lastAdmission: null };
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

test("single admission requires authenticated Platform Admin, same-origin and a closed JSON command", async () => {
  const command = { ...read, action: "PILOT" };
  let calls = 0;
  const pilot: NonNullable<Parameters<typeof handler>[0]>["pilot"] = async input => {
    calls++;
    assert.deepEqual(input, { actor, companyId: read.companyId, integrationId: read.integrationId, providerScope: scope });
    return { status: "NO_ELIGIBLE_JOB", outcome: null, bootstrapAttempted: false, bootstrapResult: null };
  };
  assert.equal((await handler({ pilot, getSession: async () => null }).run(req(JSON.stringify(command)))).status, 401);
  assert.equal((await handler({ pilot, getSession: async () => ({ ...actor, role: "AGENT" }) }).run(req(JSON.stringify(command)))).status, 403);
  const f = handler({ pilot });
  assert.equal((await f.run(req(JSON.stringify(command), { origin: "https://wrong.invalid" }))).status, 403);
  for (const value of [read, change, { ...command, jobId: "job" }, { ...command, rolloutId: "budget" }, { ...command, providerScope: "scope" }]) {
    assert.equal((await f.run(req(JSON.stringify(value)))).status, 400);
  }
  assert.equal((await f.run(req(JSON.stringify(command), { authorization: "Bearer private" }))).status, 400);
  assert.equal((await f.run(req(JSON.stringify(command), {}, "https://crm.example.invalid/path?x=1"))).status, 400);
  assert.equal((await handler({ pilot, enforceLimits: async rules => {
    assert.deepEqual(rules.map(r => r.category), ["opencredit-single-admission-actor", "opencredit-single-admission-binding"]);
    return new Response(null, { status: 429 });
  } }).run(req(JSON.stringify(command)))).status, 429);
  assert.equal(calls, 0);
  const response = await f.run(req(JSON.stringify(command)));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { status: "NO_ELIGIBLE_JOB", outcome: null, bootstrapAttempted: false, bootstrapResult: null });
  assert.equal(calls, 1);
  assert.deepEqual(f.counts(), [0, 0]);
});

for (const outcome of ["RETRY", "NEEDS_REVIEW", "EXPIRED", "COMPLETED", null, "throw"] as const) {
  test("one claim and one process with sanitized result: " + outcome, async () => {
    const tx = {
      async $queryRaw(strings: TemplateStringsArray) {
        const sql = strings.join("?");
        if (sql.includes('FROM "User"')) return [actor];
        if (sql.includes('FROM "OpenCreditIntegration"')) return [{ valid: true }];
        if (sql.includes('FROM "OpenCreditMaterializationRolloutBudget"')) return [{ admittedCount: 0, ledgerCount: 0 }];
        throw Error("unexpected query");
      },
      openCreditMaterializationRolloutBudget: { findMany: async () => [{ id: "private-rollout" }] },
    };
    const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } as never;
    const lease = { id: "private-job", leaseToken: "private-lease", rolloutId: "private-rollout", admissionAttempt: 1 };
    let claims = 0, processed = 0, bootstraps = 0;
    const result = await pilotService.runOpenCreditSingleAdmission(db, { actor, companyId: "company", integrationId: "integration", providerScope: scope }, {
      env: {},
      queue: ((_: unknown, _random: unknown, rolloutId: string) => ({
        async claim(count: number) { claims++; assert.equal(count, 1); assert.equal(rolloutId, lease.rolloutId); return [lease]; },
      })) as never,
      materializer: () => ({
        async process(value) {
          processed++; assert.deepEqual(value, lease);
          if (outcome === "throw") throw Error("private-error");
          return outcome ? { id: lease.id, state: outcome } : null;
        },
      }),
      async bootstrap(id) { bootstraps++; assert.equal(id, lease.id); return { status: "private-provider-detail" }; },
    });
    assert.deepEqual([claims, processed, bootstraps], [1, 1, outcome === "COMPLETED" ? 1 : 0]);
    assert.deepEqual(result, {
      status: outcome === null || outcome === "throw" ? "RESULT_UNCONFIRMED" : "PROCESSED",
      outcome: outcome === "throw" ? null : outcome, bootstrapAttempted: outcome === "COMPLETED",
      bootstrapResult: outcome === "COMPLETED" ? "UNKNOWN" : null,
    });
  });
}
test("configuration writer never creates jobs, claims, releases rollouts or reads secret columns", () => {
  const source = readFileSync("src/lib/opencredit-materialization-configuration.service.ts", "utf8");
  for (const forbidden of ["webhookSecret", "protectedEnvelope", "createClient(", "openCreditLeadMaterialization.create", "claim("]) {
    assert(!source.includes(forbidden));
  }
  assert(!source.includes("openCreditMaterializationRolloutBudget.update"));
  assert(source.includes("getOpenCreditMaterializationPreflight"));
});
