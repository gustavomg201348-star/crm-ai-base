import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import { assertOpenCreditAccessServiceTestDatabase } from "./opencredit-commercial-access-service-postgres.guard";

// Reuse the strict local/CI guard BEFORE constructing any database client.
assertOpenCreditAccessServiceTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let handler: typeof import("./opencredit-commercial-access-admin-handler");
let resolver: typeof import("./opencredit-provider-scope-resolver");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("LIVE_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { handler = await import("./opencredit-commercial-access-admin-handler"); resolver = await import("./opencredit-provider-scope-resolver"); }
  finally { loader._load = original; }
});
after(async () => { await db.$disconnect(); globalThis.fetch = originalFetch; });
type ServiceDb = Parameters<typeof handler.createOpenCreditCommercialAccessAdminHandler>[1]["db"];
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const platform = await db.company.create({ data: { name: "Synthetic platform" } });
  const company = await db.company.create({ data: { name: "Synthetic commercial access target" } });
  const other = await db.company.create({ data: { name: "Synthetic other target" } });
  const user = await db.user.create({ data: { companyId: platform.id, name: "Synthetic admin", email: randomUUID() + "@example.invalid", role: "ADMIN", passwordHash: "NOT_A_REAL_PASSWORD" } });
  const actor: SessionUser = { id: user.id, companyId: platform.id, name: user.name, email: user.email, role: "ADMIN" };
  process.env.PLATFORM_COMPANY_ID = platform.id;
  process.env.OPENCREDIT_TENANT_ID = "Synthetic-Tenant-" + randomUUID();
  process.env.OPENCREDIT_PARTNER_ID = "Synthetic-Partner";
  const scope = resolver.resolveConfiguredOpenCreditProviderScope();
  const where = { companyId: company.id, providerScope: scope };
  const events = () => db.openCreditCommercialAccessEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const access = () => db.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: where } });
  const request = (companyId = company.id) => new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/commercial-access/grant", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ companyId }),
  });
  const invoke = (action: "grant" | "revoke", client: ServiceDb = db, session = actor, target = company.id) => handler.createOpenCreditCommercialAccessAdminHandler(action, {
    db: client, getSession: async () => session, requirePlatformAdmin, enforceLimits: async () => null,
    // No scope or domain injection: exercise the real configured resolver/service.
  })(request(target));
  return { platform, company, other, actor, scope, where, events, access, invoke };
}
async function otherState() {
  // Test-only, constant SELECTs: no foreign domain delegate/service composition.
  return db.$queryRaw`SELECT
    (SELECT COUNT(*)::int FROM "OpenCreditRemoteIdentity") AS identities,
    (SELECT COUNT(*)::int FROM "OpenCreditRemoteIdentityEvent") AS identity_events,
    (SELECT COUNT(*)::int FROM "OpenCreditConsumerAuthorization") AS authorizations,
    (SELECT COUNT(*)::int FROM "OpenCreditConsumerAuthorizationEvent") AS authorization_events,
    (SELECT COUNT(*)::int FROM "OpenCreditCommercialOperation") AS operations,
    (SELECT COUNT(*)::int FROM "OpenCreditCommercialOperationEvent") AS operation_events,
    (SELECT COUNT(*)::int FROM "Contact") AS contacts,
    (SELECT COUNT(*)::int FROM "Message") AS messages`;
}
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"];
    const old = keys.map(k => process.env[k]);
    try {
      const f = await fixture(), untouched = await otherState();
      await run(f);
      assert.deepEqual(await otherState(), untouched);
    } finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
  });
}
async function success(response: Response, changed: boolean, enabled: boolean) {
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, changed, enabled });
}
material("real HTTP grant persists trusted scope and exactly one atomic GRANTED", async f => {
  await success(await f.invoke("grant"), true, true);
  const a = await f.access(), events = await f.events(); assert(a); assert.equal(events.length, 1);
  assert.equal(a.providerScope, f.scope); assert.equal(a.companyId, f.company.id); assert.equal(a.changedByUserId, f.actor.id);
  assert.equal(events[0].commercialAccessId, a.id); assert.equal(events[0].providerScope, f.scope);
  assert.equal(events[0].action, "GRANTED"); assert.equal(events[0].previousEnabled, null); assert.equal(events[0].nextEnabled, true);
  assert.equal(events[0].actorUserId, f.actor.id);
});
material("duplicate grant is no-op with stable row and no second Event", async f => {
  await success(await f.invoke("grant"), true, true); const before = await f.access();
  await success(await f.invoke("grant"), false, true); assert.deepEqual(await f.access(), before); assert.equal((await f.events()).length, 1);
});
material("revoke, duplicate revoke and regrant preserve exact audit chain", async f => {
  await success(await f.invoke("grant"), true, true);
  await success(await f.invoke("revoke"), true, false); const before = await f.access();
  await success(await f.invoke("revoke"), false, false); assert.deepEqual(await f.access(), before);
  await success(await f.invoke("grant"), true, true);
  assert.deepEqual((await f.events()).map(e => [e.action, e.previousEnabled, e.nextEnabled]), [["GRANTED", null, true], ["REVOKED", true, false], ["GRANTED", false, true]]);
});
material("revoke absent creates no disabled row or Event", async f => {
  await success(await f.invoke("revoke"), false, false); assert.equal(await f.access(), null); assert.equal((await f.events()).length, 0);
});
type Work = (tx: Prisma.TransactionClient) => Promise<unknown>;
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
function wrapped(wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): ServiceDb {
  return { $transaction: (run: Work, options: Options) => db.$transaction(tx => run(wrap(tx)), options) } as unknown as ServiceDb;
}
for (const initial of ["absent", "disabled", "enabled"] as const) material("real Event FK failure rolls back HTTP command from " + initial, async f => {
  if (initial !== "absent") {
    await f.invoke("grant"); if (initial === "disabled") await f.invoke("revoke");
  }
  const before = await f.access(), oldEvents = await f.events(); let observed = false;
  const client = wrapped(tx => new Proxy(tx, { get(target, key) {
    if (key !== "openCreditCommercialAccessEvent") return Reflect.get(target, key);
    return new Proxy(target.openCreditCommercialAccessEvent, { get(delegate, method) {
      if (method !== "create") return Reflect.get(delegate, method);
      return async (args: Prisma.OpenCreditCommercialAccessEventCreateArgs) => {
        const row = await tx.openCreditCommercialAccess.findUniqueOrThrow({ where: { companyId_providerScope: f.where } });
        observed = row.enabled === (initial !== "enabled");
        return delegate.create({ ...args, data: { ...args.data, actorUserId: "synthetic-missing" } as Prisma.OpenCreditCommercialAccessEventUncheckedCreateInput });
      };
    } });
  } }));
  const response = await f.invoke(initial === "enabled" ? "revoke" : "grant", client);
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "OPENCREDIT_COMMERCIAL_ACCESS_STORAGE_ERROR" });
  assert(observed); assert.deepEqual(await f.access(), before); assert.deepEqual(await f.events(), oldEvents);
});
for (const initial of ["absent", "disabled", "enabled"] as const) material("concurrent HTTP commands remain coherent from " + initial, async f => {
  if (initial !== "absent") { await f.invoke("grant"); if (initial === "disabled") await f.invoke("revoke"); }
  let arrivals = 0, release!: () => void; const barrier = new Promise<void>(r => { release = r; });
  const client = wrapped(tx => new Proxy(tx, { get(target, key) {
    if (key !== "openCreditCommercialAccess") return Reflect.get(target, key);
    return new Proxy(target.openCreditCommercialAccess, { get(delegate, method) {
      if (method !== "findUnique") return Reflect.get(delegate, method);
      return async (args: Prisma.OpenCreditCommercialAccessFindUniqueArgs) => {
        const result = await delegate.findUnique(args);
        if (arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; }
        return result;
      };
    } });
  } }));
  const action = initial === "enabled" ? "revoke" : "grant", before = (await f.events()).length;
  const responses = await Promise.all([f.invoke(action, client), f.invoke(action, client)]);
  const bodies = await Promise.all(responses.map(async r => { assert.equal(r.status, 200); return r.json(); }));
  assert.equal(arrivals, 2); assert.equal(bodies.filter(b => b.changed).length, 1); assert.equal(bodies.filter(b => !b.changed).length, 1);
  assert.equal((await f.events()).length, before + 1); assert.equal((await f.access())?.enabled, action === "grant");
});
material("cross-company admin command stays scoped; stale persisted actor denied", async f => {
  await f.invoke("grant"); await success(await f.invoke("revoke", db, f.actor, f.other.id), false, false);
  assert.equal(await db.openCreditCommercialAccess.count({ where: { companyId: f.other.id } }), 0);
  await db.user.update({ where: { id: f.actor.id }, data: { role: "AGENT" } });
  const response = await f.invoke("revoke"); assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "OPENCREDIT_COMMERCIAL_ACCESS_NOT_AUTHORIZED" });
  assert.equal((await f.access())?.enabled, true); assert.equal((await f.events()).length, 1);
});
