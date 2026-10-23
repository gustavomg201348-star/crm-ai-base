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
let handler: typeof import("./opencredit-commercial-access-context-admin-handler");
let resolver: typeof import("./opencredit-provider-scope-resolver");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("LIVE_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }, original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { handler = await import("./opencredit-commercial-access-context-admin-handler"); resolver = await import("./opencredit-provider-scope-resolver"); }
  finally { loader._load = original; }
});
after(async () => { await db.$disconnect(); globalThis.fetch = originalFetch; });
type ServiceDb = Parameters<typeof handler.createOpenCreditCommercialAccessContextHandler>[0]["db"];
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
  const request = (companyId = company.id) => new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/commercial-access/context", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ companyId }),
  });
  const invoke = (target = company.id, client: ServiceDb = db, session = actor) => handler.createOpenCreditCommercialAccessContextHandler({
    db: client, getSession: async () => session, requirePlatformAdmin, enforceLimits: async () => null,
    // No scope or domain injection: exercise the real configured resolver/read-only service.
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
async function check(f: Fixture, exists: boolean, enabled: boolean, target = f.company.id) {
  const accessBefore = await db.openCreditCommercialAccess.findMany({ orderBy: { id: "asc" } });
  const eventsBefore = await db.openCreditCommercialAccessEvent.findMany({ orderBy: { id: "asc" } });
  const response = await f.invoke(target);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, exists, enabled });
  assert.deepEqual(await db.openCreditCommercialAccess.findMany({ orderBy: { id: "asc" } }), accessBefore);
  assert.deepEqual(await db.openCreditCommercialAccessEvent.findMany({ orderBy: { id: "asc" } }), eventsBefore);
}
material("absent access stays absent and read creates no Event or foreign domain", async f => { await check(f, false, false); });
for (const enabled of [false, true]) material("real access state " + enabled + " is read without mutation", async f => {
  await db.openCreditCommercialAccess.create({ data: { ...f.where, enabled, changedByUserId: f.actor.id } });
  await check(f, true, enabled);
});
material("another scope never leaks into configured scope", async f => {
  await db.openCreditCommercialAccess.create({ data: { companyId: f.company.id, providerScope: "other-scope", enabled: true, changedByUserId: f.actor.id } });
  await check(f, false, false);
});
material("another Company never leaks into target Company", async f => {
  await db.openCreditCommercialAccess.create({ data: { companyId: f.other.id, providerScope: f.scope, enabled: true, changedByUserId: f.actor.id } });
  await check(f, false, false); await check(f, true, true, f.other.id);
});
material("nonexistent Company is not an unconfigured Company", async f => {
  const response = await f.invoke("missing-" + randomUUID()); assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "OPENCREDIT_COMMERCIAL_ACCESS_CONTEXT_COMPANY_NOT_FOUND" });
  assert.equal((await f.events()).length, 0); assert.equal(await f.access(), null);
});
material("persisted stale admin is denied before disclosure", async f => {
  await db.user.update({ where: { id: f.actor.id }, data: { role: "AGENT" } });
  assert.equal((await f.invoke()).status, 403);
});
