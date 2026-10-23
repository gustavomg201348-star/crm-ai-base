import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditRemoteIdentityInput, OpenCreditRemoteIdentityResult, OpenCreditRemoteIdentityServiceCode } from "./opencredit-remote-identity.service";
import { assertOpenCreditRemoteIdentityServiceTestDatabase } from "./opencredit-remote-identity-service-postgres.guard";

assertOpenCreditRemoteIdentityServiceTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-remote-identity.service");
let handler: typeof import("./opencredit-remote-identity-admin-handler");
let resolver: typeof import("./opencredit-provider-scope-resolver");
let contextHandler: typeof import("./opencredit-remote-identity-context-admin-handler");
const originalFetch = globalThis.fetch;
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  globalThis.fetch = async () => { throw Error("LIVE_HTTP_FORBIDDEN"); };
  try {
    const originalService = await import("./opencredit-remote-identity.service");
    handler = await import("./opencredit-remote-identity-admin-handler");
    resolver = await import("./opencredit-provider-scope-resolver");
    contextHandler = await import("./opencredit-remote-identity-context-admin-handler");
    service = { ...originalService,
      claimOpenCreditRemoteIdentity: (db, input) => httpCommand("claim", db, input, originalService),
      enableOpenCreditRemoteIdentity: (db, input) => httpCommand("enable", db, input, originalService),
      disableOpenCreditRemoteIdentity: (db, input) => httpCommand("disable", db, input, originalService),
    };
  } finally { loader._load = original; }
});
after(async () => { await db.$disconnect(); globalThis.fetch = originalFetch; });
type ServiceDb = Parameters<typeof service.claimOpenCreditRemoteIdentity>[0];
type Work = (tx: Prisma.TransactionClient) => Promise<OpenCreditRemoteIdentityResult>;
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const [companyId, otherCompany, platform] = ["target", "other", "platform"].map(p => "remote-service-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [companyId, otherCompany, platform].map(id => ({ id, name: "Synthetic identity service fixture" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic platform admin", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: "ADMIN" };
  process.env.OPENCREDIT_TENANT_ID = "Synthetic-" + randomUUID(); process.env.OPENCREDIT_PARTNER_ID = "Synthetic-Partner";
  const scope = resolver.resolveConfiguredOpenCreditProviderScope();
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic contact", phone: "SYNTHETIC_NOT_A_PHONE", cpf: "00000000000" } });
  const input: OpenCreditRemoteIdentityInput = { actor, companyId, contactId: contact.id, providerScope: scope as OpenCreditRemoteIdentityInput["providerScope"] };
  const binding = { companyId, providerScope: input.providerScope, contactId: contact.id };
  const where = { companyId_providerScope_contactId: binding };
  const access = (enabled = true, target = companyId) => db.openCreditCommercialAccess.create({ data: { companyId: target, providerScope: scope, enabled, changedByUserId: actor.id } });
  const current = () => db.openCreditRemoteIdentity.findUnique({ where });
  const events = () => db.openCreditRemoteIdentityEvent.findMany({ where: { companyId, providerScope: scope }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { companyId, otherCompany, platform, actor, input, contact, binding, where, access, current, events };
}
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
    const tenant = process.env.OPENCREDIT_TENANT_ID, partner = process.env.OPENCREDIT_PARTNER_ID;
    try {
      const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      await run(f);
    } catch (error) {
      const code = error instanceof service.OpenCreditRemoteIdentityServiceError ? error.code
        : error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_REMOTE_IDENTITY_SERVICE_MATERIAL_FAILED:" + code);
    } finally {
      if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
      if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
      if (tenant === undefined) delete process.env.OPENCREDIT_TENANT_ID; else process.env.OPENCREDIT_TENANT_ID = tenant;
      if (partner === undefined) delete process.env.OPENCREDIT_PARTNER_ID; else process.env.OPENCREDIT_PARTNER_ID = partner;
    }
    // No audit cleanup/delete bypass. Only synthetic fixtures in a disposable database.
  });
}
const operations = () => [service.claimOpenCreditRemoteIdentity, service.enableOpenCreditRemoteIdentity, service.disableOpenCreditRemoteIdentity];
async function denied(run: () => Promise<unknown>, code: OpenCreditRemoteIdentityServiceCode) {
  await assert.rejects(run, e => e instanceof service.OpenCreditRemoteIdentityServiceError && e.code === code && e.message === "OPENCREDIT_REMOTE_IDENTITY_" + code && !("cause" in e));
}
async function claimed(f: Fixture, enabled = false) {
  await f.access(); const result = await service.claimOpenCreditRemoteIdentity(db, f.input);
  if (enabled) await service.enableOpenCreditRemoteIdentity(db, f.input);
  return result;
}
async function lastEvent(f: Fixture, action: string, previous: boolean | null, next: boolean, count: number) {
  const events = await f.events(); assert.equal(events.length, count); const e = events[events.length - 1];
  assert.equal(e.action, action); assert.equal(e.previousEnabled, previous); assert.equal(e.nextEnabled, next);
  assert.equal(e.actorUserId, f.actor.id); assert.equal(e.companyId, f.companyId); assert.equal(e.providerScope, f.input.providerScope);
  const current = await f.current(); assert.ok(current); assert.equal(current.id, e.remoteIdentityId); assert.equal(current.enabled, next);
  assert.deepEqual(Object.keys(e).sort(), ["id", "remoteIdentityId", "companyId", "providerScope", "actorUserId", "action", "previousEnabled", "nextEnabled", "createdAt"].sort());
}
material("01 first CLAIM is disabled with effective actor and CLAIMED null to false", async f => {
  const result = await claimed(f); assert.equal(result.changed, true); assert.equal(result.enabled, false);
  assert.deepEqual(Object.keys(result).sort(), ["changed", "enabled", "identityId"]);
  assert.equal((await f.current())?.createdByUserId, f.actor.id); await lastEvent(f, "CLAIMED", null, false, 1);
});
for (const enabled of [false, true]) material("repeated CLAIM " + enabled + " is a true no-op", async f => {
  await claimed(f, enabled); const before = await f.current(); const events = await f.events();
  assert.deepEqual(await service.claimOpenCreditRemoteIdentity(db, f.input), { changed: false, enabled, identityId: before!.id });
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("04 ENABLE disabled atomically records false to true", async f => { await claimed(f); assert.equal((await service.enableOpenCreditRemoteIdentity(db, f.input)).changed, true); await lastEvent(f, "ENABLED", false, true, 2); });
material("05 ENABLE enabled no-op preserves all state and events", async f => {
  await claimed(f, true); const before = await f.current(); const events = await f.events();
  assert.equal((await service.enableOpenCreditRemoteIdentity(db, f.input)).changed, false); assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("06 DISABLE enabled atomically records true to false without ownership mutation", async f => {
  await claimed(f, true); const before = await f.current(); assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, true);
  const after = await f.current(); assert.equal(after!.normalizedCpf, before!.normalizedCpf); assert.equal(after!.contactId, before!.contactId);
  assert.equal(after!.providerScope, before!.providerScope); assert.equal(after!.createdByUserId, before!.createdByUserId); await lastEvent(f, "DISABLED", true, false, 3);
});
material("07 DISABLE disabled no-op", async f => {
  await claimed(f); const before = await f.current(); assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, false); assert.deepEqual(await f.current(), before); assert.equal((await f.events()).length, 1);
});
material("08 DISABLE absent no-op even with no CommercialAccess", async f => {
  assert.deepEqual(await service.disableOpenCreditRemoteIdentity(db, f.input), { changed: false, enabled: false, identityId: null }); assert.equal(await f.current(), null); assert.equal((await f.events()).length, 0);
});
for (const role of ["ADMIN", "SUPERVISOR", "AGENT"] as const) material("Company " + role + " cannot perform any transition", async f => {
  const u = await db.user.create({ data: { companyId: f.companyId, role, name: "Synthetic Company actor", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH" } });
  const actor: SessionUser = { id: u.id, companyId: u.companyId, name: u.name, email: u.email, role };
  for (const op of operations()) await denied(() => op(db, { ...f.input, actor }), "NOT_AUTHORIZED");
  assert.equal(await f.current(), null); assert.equal((await f.events()).length, 0);
});
for (const stale of ["removed", "company", "role", "email"] as const) material("stale platform actor " + stale + " denied in all operations", async f => {
  if (stale === "removed") await db.user.delete({ where: { id: f.actor.id } });
  else await db.user.update({ where: { id: f.actor.id }, data: stale === "company" ? { companyId: f.otherCompany } : stale === "role" ? { role: "AGENT" } : { email: randomUUID() + "@example.invalid" } });
  for (const op of operations()) await denied(() => op(db, f.input), "NOT_AUTHORIZED");
});
material("13 missing Company denied in all operations", async f => { for (const op of operations()) await denied(() => op(db, { ...f.input, companyId: "missing-" + randomUUID() }), "COMPANY_NOT_FOUND"); });
material("14 missing or cross-company Contact denied in CLAIM and ENABLE", async f => {
  for (const op of operations().slice(0, 2)) {
    await denied(() => op(db, { ...f.input, contactId: "missing-" + randomUUID() }), "CONTACT_NOT_FOUND");
    await denied(() => op(db, { ...f.input, companyId: f.otherCompany }), "CONTACT_NOT_FOUND");
  }
});
for (const mode of ["claim", "enable"] as const) material("archived Contact blocks " + mode, async f => {
  if (mode === "enable") await claimed(f); await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } });
  await denied(() => (mode === "claim" ? service.claimOpenCreditRemoteIdentity : service.enableOpenCreditRemoteIdentity)(db, f.input), "CONTACT_ARCHIVED");
});
material("17 archived Contact does not block DISABLE", async f => { await claimed(f, true); await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } }); assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, true); });
for (const cpf of [null, "", "bad", " 00000000000", "000 000 000 00", "000.000.000-00\n"]) material("missing/invalid CPF shape " + String(cpf).length + ":" + (cpf === null ? "null" : cpf === "" ? "empty" : "invalid"), async f => {
  await claimed(f); await db.contact.update({ where: { id: f.contact.id }, data: { cpf } });
  for (const op of operations().slice(0, 2)) await denied(() => op(db, f.input), cpf === null || cpf === "" ? "CONTACT_CPF_MISSING" : "CONTACT_CPF_INVALID");
});
material("20 formatted and digit CPF converge to same snapshot", async f => {
  await claimed(f); await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "000.000.000-00" } });
  assert.equal((await service.claimOpenCreditRemoteIdentity(db, f.input)).changed, false); assert.equal((await service.enableOpenCreditRemoteIdentity(db, f.input)).changed, true);
  assert.equal((await f.current())!.normalizedCpf, "00000000000");
});
for (const archived of [false, true]) material("duplicate " + (archived ? "archived" : "active") + " Contact blocks CLAIM", async f => {
  await f.access(); await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic duplicate", phone: "SYNTHETIC", cpf: "000.000.000-00", archivedAt: archived ? new Date() : null } });
  await denied(() => service.claimOpenCreditRemoteIdentity(db, f.input), "CONTACT_AMBIGUOUS"); assert.equal(await f.current(), null);
});
material("23 same CPF and scope in another Company is sanitized OWNERSHIP_CONFLICT", async f => {
  await claimed(f); await f.access(true, f.otherCompany);
  const contact = await db.contact.create({ data: { companyId: f.otherCompany, name: "Synthetic competitor", phone: "SYNTHETIC", cpf: "00000000000" } });
  await denied(() => service.claimOpenCreditRemoteIdentity(db, { ...f.input, companyId: f.otherCompany, contactId: contact.id }), "OWNERSHIP_CONFLICT");
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { providerScope: f.input.providerScope } }), 1); assert.equal((await f.events()).length, 1);
});
material("24 existing contact binding with changed snapshot cannot be reclaimed", async f => {
  await claimed(f); await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "11111111111" } });
  await denied(() => service.claimOpenCreditRemoteIdentity(db, f.input), "IDENTITY_SNAPSHOT_MISMATCH"); assert.equal((await f.events()).length, 1);
});
material("25 missing CommercialAccess blocks CLAIM", async f => { await denied(() => service.claimOpenCreditRemoteIdentity(db, f.input), "COMMERCIAL_ACCESS_MISSING"); });
material("26 disabled CommercialAccess blocks CLAIM", async f => { await f.access(false); await denied(() => service.claimOpenCreditRemoteIdentity(db, f.input), "COMMERCIAL_ACCESS_DISABLED"); });
material("27 revoked CommercialAccess blocks ENABLE", async f => { await claimed(f); await db.openCreditCommercialAccess.update({ where: { companyId_providerScope: { companyId: f.companyId, providerScope: f.input.providerScope } }, data: { enabled: false } }); await denied(() => service.enableOpenCreditRemoteIdentity(db, f.input), "COMMERCIAL_ACCESS_DISABLED"); });
material("28 revoked CommercialAccess does not block DISABLE", async f => { await claimed(f, true); await db.openCreditCommercialAccess.update({ where: { companyId_providerScope: { companyId: f.companyId, providerScope: f.input.providerScope } }, data: { enabled: false } }); assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, true); });
material("29 CPF changed after CLAIM blocks ENABLE without snapshot update", async f => { await claimed(f); const before = await f.current(); await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "11111111111" } }); await denied(() => service.enableOpenCreditRemoteIdentity(db, f.input), "IDENTITY_SNAPSHOT_MISMATCH"); assert.deepEqual(await f.current(), before); });
material("30 CPF changed after ENABLE does not block DISABLE", async f => { await claimed(f, true); await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "11111111111" } }); assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, true); });
for (const disable of [false, true]) material("later ambiguity " + (disable ? "allows DISABLE" : "blocks ENABLE"), async f => {
  await claimed(f, disable); await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic later duplicate", phone: "SYNTHETIC", cpf: "000.000.000-00", archivedAt: new Date() } });
  if (disable) assert.equal((await service.disableOpenCreditRemoteIdentity(db, f.input)).changed, true);
  else await denied(() => service.enableOpenCreditRemoteIdentity(db, f.input), "CONTACT_AMBIGUOUS");
});
function wrapped(wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): ServiceDb {
  return { $transaction: (run: Work, options: Options) => db.$transaction(tx => run(wrap(tx)), options) } as ServiceDb;
}
function simultaneousReads() {
  let arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const client = wrapped(tx => new Proxy(tx, { get(target, key) {
    if (key !== "openCreditRemoteIdentity") return Reflect.get(target, key);
    return new Proxy(target.openCreditRemoteIdentity, { get(delegate, method) {
      if (method !== "findUnique") return Reflect.get(delegate, method);
      return async (args: Prisma.OpenCreditRemoteIdentityFindUniqueArgs) => {
        const result = await delegate.findUnique(args);
        // Only the first binding read of each first attempt waits; retries run normally.
        if (args.where.companyId_providerScope_contactId && arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; }
        return result;
      };
    } });
  } }));
  return { client, arrivals: () => arrivals };
}
material("33 concurrent same-owner first CLAIM creates one identity and one CLAIMED", async f => {
  await f.access(); const race = simultaneousReads();
  const results = await Promise.all([service.claimOpenCreditRemoteIdentity(race.client, f.input), service.claimOpenCreditRemoteIdentity(race.client, f.input)]);
  assert.equal(race.arrivals(), 2); assert.equal(results.filter(r => r.changed).length, 1); assert.equal(results.filter(r => !r.changed).length, 1);
  assert.equal(results[0].identityId, results[1].identityId); assert.equal(await db.openCreditRemoteIdentity.count({ where: f.binding }), 1); await lastEvent(f, "CLAIMED", null, false, 1);
});
material("34 concurrent cross-company first CLAIM has one owner and one sanitized conflict", async f => {
  await f.access(); await f.access(true, f.otherCompany); const contact = await db.contact.create({ data: { companyId: f.otherCompany, name: "Synthetic contender", phone: "SYNTHETIC", cpf: "00000000000" } });
  const race = simultaneousReads(); const results = await Promise.allSettled([service.claimOpenCreditRemoteIdentity(race.client, f.input), service.claimOpenCreditRemoteIdentity(race.client, { ...f.input, companyId: f.otherCompany, contactId: contact.id })]);
  assert.equal(race.arrivals(), 2); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejected = results.find(r => r.status === "rejected"); assert.ok(rejected && rejected.status === "rejected");
  const error: unknown = rejected.reason; assert.ok(error instanceof service.OpenCreditRemoteIdentityServiceError); assert.equal(error.code, "OWNERSHIP_CONFLICT"); assert.equal(error.message, "OPENCREDIT_REMOTE_IDENTITY_OWNERSHIP_CONFLICT"); assert.equal("cause" in error, false);
  assert.equal(await db.openCreditRemoteIdentity.count({ where: { providerScope: f.input.providerScope } }), 1);
  assert.equal(await db.openCreditRemoteIdentityEvent.count({ where: { providerScope: f.input.providerScope, action: "CLAIMED" } }), 1);
});
for (const enabling of [true, false]) material("concurrent " + (enabling ? "ENABLE" : "DISABLE") + " records one real transition", async f => {
  await claimed(f, !enabling); const before = (await f.events()).length; const race = simultaneousReads(); const op = enabling ? service.enableOpenCreditRemoteIdentity : service.disableOpenCreditRemoteIdentity;
  const results = await Promise.all([op(race.client, f.input), op(race.client, f.input)]);
  assert.equal(race.arrivals(), 2); assert.equal(results.filter(r => r.changed).length, 1); assert.equal(results.filter(r => !r.changed).length, 1);
  assert.equal((await f.current())!.enabled, enabling); await lastEvent(f, enabling ? "ENABLED" : "DISABLED", !enabling, enabling, before + 1);
});
material("37 concurrent ENABLE/DISABLE is equivalent to a valid serial history", async f => {
  await claimed(f); const race = simultaneousReads(); const [enable, disable] = await Promise.all([service.enableOpenCreditRemoteIdentity(race.client, f.input), service.disableOpenCreditRemoteIdentity(race.client, f.input)]);
  assert.equal(enable.changed, true); const events = await f.events(); assert.equal(events.length, disable.changed ? 3 : 2);
  assert.equal((await f.current())!.enabled, !disable.changed);
  assert.equal(events.filter(e => e.action === "ENABLED" && e.previousEnabled === false && e.nextEnabled).length, 1);
  assert.equal(events.filter(e => e.action === "DISABLED" && e.previousEnabled === true && !e.nextEnabled).length, disable.changed ? 1 : 0);
});
material("38 effective platform actor is the event actor, not target Company actor", async f => {
  await claimed(f); assert.notEqual(f.actor.companyId, f.companyId); assert.equal((await f.events())[0].actorUserId, f.actor.id);
});
for (const mode of ["claim", "enable", "disable"] as const) material("real FK failure rolls back " + mode + " state and Event", async f => {
  if (mode === "claim") await f.access(); else await claimed(f, mode === "disable");
  const before = await f.current(); const events = await f.events(); let observed = false;
  const client = wrapped(tx => new Proxy(tx, { get(target, key) {
    if (key !== "openCreditRemoteIdentityEvent") return Reflect.get(target, key);
    return new Proxy(target.openCreditRemoteIdentityEvent, { get(delegate, method) {
      if (method !== "create") return Reflect.get(delegate, method);
      return async (args: Prisma.OpenCreditRemoteIdentityEventCreateArgs) => {
        const current = await tx.openCreditRemoteIdentity.findUniqueOrThrow({ where: f.where }); observed = current.enabled === (mode === "enable");
        return delegate.create({ ...args, data: { ...args.data, actorUserId: "missing-" + randomUUID() } as Prisma.OpenCreditRemoteIdentityEventUncheckedCreateInput });
      };
    } });
  } }));
  await denied(() => (mode === "claim" ? service.claimOpenCreditRemoteIdentity : mode === "enable" ? service.enableOpenCreditRemoteIdentity : service.disableOpenCreditRemoteIdentity)(client, f.input), "STORAGE_ERROR");
  assert.equal(observed, true); assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("42 disabled identity still reserves ownership against another Contact in another Company", async f => {
  await claimed(f, true); await service.disableOpenCreditRemoteIdentity(db, f.input); await f.access(true, f.otherCompany);
  const contact = await db.contact.create({ data: { companyId: f.otherCompany, name: "Synthetic blocked contender", phone: "SYNTHETIC", cpf: "00000000000" } });
  await denied(() => service.claimOpenCreditRemoteIdentity(db, { ...f.input, companyId: f.otherCompany, contactId: contact.id }), "OWNERSHIP_CONFLICT"); assert.equal((await f.current())!.enabled, false);
});
function request(action: string, input: OpenCreditRemoteIdentityInput) {
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/remote-identity/" + action, {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" },
    body: JSON.stringify({ companyId: input.companyId, contactId: input.contactId }),
  });
}
async function adjacent() {
  return {
    contacts: await db.contact.findMany({ orderBy: { id: "asc" } }),
    // Constant, test-only SELECTs; do not compose foreign domain delegates/services.
    counts: await db.$queryRaw`SELECT
      (SELECT COUNT(*)::int FROM "Message") AS messages,
      (SELECT COUNT(*)::int FROM "OpenCreditConsumerAuthorization") AS authorizations,
      (SELECT COUNT(*)::int FROM "OpenCreditConsumerAuthorizationEvent") AS authorization_events,
      (SELECT COUNT(*)::int FROM "OpenCreditCommercialOperation") AS operations,
      (SELECT COUNT(*)::int FROM "OpenCreditCommercialOperationEvent") AS operation_events`,
    accesses: await db.openCreditCommercialAccess.findMany({ orderBy: { id: "asc" } }),
    accessEvents: await db.openCreditCommercialAccessEvent.count(),
  };
}
async function httpCommand(action: "claim" | "enable" | "disable", client: ServiceDb, input: OpenCreditRemoteIdentityInput, domain: typeof service): Promise<OpenCreditRemoteIdentityResult> {
  const untouched = await adjacent();
  const response = await handler.createOpenCreditRemoteIdentityAdminHandler(action, {
    db: client, getSession: async () => input.actor, requirePlatformAdmin, enforceLimits: async () => null,
    // Real configured resolver and existing service: no command/scope injection.
  })(request(action, input));
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.deepEqual(await adjacent(), untouched);
  if (response.status !== 200) {
    assert.deepEqual(Object.keys(body), ["error"]);
    if (body.error === "FORBIDDEN") {
      assert.equal(response.status, 403);
      throw new domain.OpenCreditRemoteIdentityServiceError("NOT_AUTHORIZED");
    }
    assert.match(body.error, /^OPENCREDIT_REMOTE_IDENTITY_[A-Z_]+$/);
    const code = body.error.slice("OPENCREDIT_REMOTE_IDENTITY_".length) as OpenCreditRemoteIdentityServiceCode;
    assert.equal(response.status, code === "NOT_AUTHORIZED" ? 403 : code.startsWith("INVALID_") ? 400 : code === "STORAGE_ERROR" ? 503 : 409);
    throw new domain.OpenCreditRemoteIdentityServiceError(code);
  }
  assert.deepEqual(Object.keys(body).sort(), ["changed", "enabled", "ok"]); assert.equal(body.ok, true);
  assert.equal(typeof body.changed, "boolean"); assert.equal(typeof body.enabled, "boolean");
  const identity = await db.openCreditRemoteIdentity.findUnique({ where: { companyId_providerScope_contactId: { companyId: input.companyId, providerScope: input.providerScope, contactId: input.contactId } } });
  return { changed: body.changed, enabled: body.enabled, identityId: identity?.id ?? null };
}
async function readContext(f: Fixture, expected: { exists: boolean; enabled: boolean }, override: Partial<OpenCreditRemoteIdentityInput> = {}) {
  const input = { ...f.input, ...override }, before = await adjacent();
  const identities = await db.openCreditRemoteIdentity.findMany({ orderBy: { id: "asc" } });
  const events = await db.openCreditRemoteIdentityEvent.findMany({ orderBy: { id: "asc" } });
  const response = await contextHandler.createOpenCreditRemoteIdentityContextHandler({
    db, getSession: async () => f.actor, requirePlatformAdmin, enforceLimits: async () => null,
  })(request("context", input));
  if (response.status === 200) assert.deepEqual(await response.json(), { ok: true, ...expected });
  assert.deepEqual(await adjacent(), before);
  assert.deepEqual(await db.openCreditRemoteIdentity.findMany({ orderBy: { id: "asc" } }), identities);
  assert.deepEqual(await db.openCreditRemoteIdentityEvent.findMany({ orderBy: { id: "asc" } }), events);
  return response.status;
}
material("context absent/disabled/enabled is read-only and never claims", async f => {
  assert.equal(await readContext(f, { exists: false, enabled: false }), 200);
  await claimed(f); assert.equal(await readContext(f, { exists: true, enabled: false }), 200);
  await service.enableOpenCreditRemoteIdentity(db, f.input); assert.equal(await readContext(f, { exists: true, enabled: true }), 200);
});
material("context Company and contact must match exact scope", async f => {
  await claimed(f);
  assert.equal(await readContext(f, { exists: false, enabled: false }, { companyId: f.otherCompany }), 409);
  assert.equal(await readContext(f, { exists: false, enabled: false }, { contactId: "missing-contact" }), 409);
  assert.equal(await readContext(f, { exists: false, enabled: false }, { companyId: "missing-company" }), 409);
  const other = await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic other", phone: "SYNTHETIC", cpf: null } });
  assert.equal(await readContext(f, { exists: false, enabled: false }, { contactId: other.id }), 200);
  process.env.OPENCREDIT_PARTNER_ID = "Another-Partner";
  assert.equal(await readContext(f, { exists: false, enabled: false }), 200);
});
material("context denies stale platform actor and remains protective after Contact change", async f => {
  await claimed(f, true); await db.contact.update({ where: { id: f.contact.id }, data: { cpf: null, archivedAt: new Date() } });
  assert.equal(await readContext(f, { exists: true, enabled: true }), 200);
  await db.user.update({ where: { id: f.actor.id }, data: { role: "AGENT" } });
  assert.equal(await readContext(f, { exists: false, enabled: false }), 403);
});
material("HTTP ENABLE without CLAIM is an explicit identity-not-found", async f => {
  await f.access(); await denied(() => service.enableOpenCreditRemoteIdentity(db, f.input), "IDENTITY_NOT_FOUND");
});
