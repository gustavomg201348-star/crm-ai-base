import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditCommercialAccessInput, OpenCreditCommercialAccessResult, OpenCreditCommercialAccessServiceCode } from "./opencredit-commercial-access.service";
import { assertOpenCreditAccessServiceTestDatabase } from "./opencredit-commercial-access-service-postgres.guard";

assertOpenCreditAccessServiceTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-access.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { service = await import("./opencredit-commercial-access.service"); } finally { loader._load = original; }
});
after(async () => { await db.$disconnect(); });
type Fixture = Awaited<ReturnType<typeof fixture>>;
type ServiceDb = Parameters<typeof service.grantOpenCreditCommercialAccess>[0];
type Work = (tx: Prisma.TransactionClient) => Promise<OpenCreditCommercialAccessResult>;
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
async function fixture() {
  const [companyId, otherCompany, platform] = ["target", "other", "platform"].map(p => "oc-service-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [companyId, otherCompany, platform].map(id => ({ id, name: "Synthetic access service fixture" })) });
  const createActor = () => db.user.create({ data: { companyId: platform, name: "Synthetic platform admin",
    email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const user = await createActor(); const previous = await createActor();
  const actor: SessionUser = { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: "ADMIN" };
  // Bijective digit-to-letter mapping retains UUID entropy without a forbidden digit run.
  const scope = "synthetic-" + randomUUID().replace(/\d/g, digit => String.fromCharCode(103 + Number(digit)));
  const input: OpenCreditCommercialAccessInput = { actor, companyId,
    providerScope: scope as OpenCreditCommercialAccessInput["providerScope"] };
  const createAccess = (enabled: boolean) => db.openCreditCommercialAccess.create({
    data: { companyId, providerScope: input.providerScope, enabled, changedByUserId: previous.id, updatedAt: new Date("2026-01-01T00:00:00Z") }
  });
  const where = { companyId, providerScope: input.providerScope };
  const events = () => db.openCreditCommercialAccessEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { companyId, otherCompany, platform, user, actor, previous, input, createAccess, where, events };
}
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      const f = await fixture();
      process.env.PLATFORM_COMPANY_ID = f.platform; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      await run(f);
    } catch (error) {
      const code = error instanceof service.OpenCreditCommercialAccessServiceError ? error.code
        : error instanceof Prisma.PrismaClientKnownRequestError && /^P\d{4}$/.test(error.code) ? error.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_ACCESS_SERVICE_MATERIAL_FAILED:" + code);
    } finally {
      if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
      if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
    }
    // No history deletion/cleanup bypass: only synthetic rows in a disposable database.
  });
}
async function denied(run: () => Promise<unknown>, code: OpenCreditCommercialAccessServiceCode) {
  await assert.rejects(run, error => error instanceof service.OpenCreditCommercialAccessServiceError
    && error.code === code && error.message === "OPENCREDIT_COMMERCIAL_ACCESS_" + code && !("cause" in error));
}
async function empty(f: Fixture) {
  assert.equal(await db.openCreditCommercialAccess.count({ where: f.where }), 0);
  assert.equal((await f.events()).length, 0);
}
async function transitionEvent(f: Fixture, action: string, previous: boolean | null, next: boolean) {
  const events = await f.events(); assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.action, action); assert.equal(event.previousEnabled, previous); assert.equal(event.nextEnabled, next);
  assert.equal(event.actorUserId, f.actor.id); assert.equal(event.companyId, f.companyId);
  assert.equal(event.providerScope, f.input.providerScope); assert.notEqual(f.actor.companyId, event.companyId);
  const access = await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: event.commercialAccessId } });
  assert.equal(access.enabled, next); assert.equal(access.changedByUserId, f.actor.id);
}
material("first grant atomically creates access and GRANTED null -> true with the effective platform actor", async f => {
  const result = await service.grantOpenCreditCommercialAccess(db, f.input);
  assert.equal(result.changed, true); assert.equal(result.enabled, true); assert.ok(result.accessId);
  assert.deepEqual(Object.keys(result).sort(), ["accessId","changed","enabled"]); await transitionEvent(f, "GRANTED", null, true);
});
material("grant disabled records false -> true", async f => {
  const before = await f.createAccess(false); const result = await service.grantOpenCreditCommercialAccess(db, f.input);
  assert.deepEqual(result, { changed: true, enabled: true, accessId: before.id }); await transitionEvent(f, "GRANTED", false, true);
});
material("grant enabled is a true no-op preserving the previous actor and timestamp", async f => {
  const before = await f.createAccess(true); const result = await service.grantOpenCreditCommercialAccess(db, f.input);
  assert.deepEqual(result, { changed: false, enabled: true, accessId: before.id });
  assert.deepEqual(await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: before.id } }), before);
  assert.equal((await f.events()).length, 0);
});
material("revoke enabled records true -> false", async f => {
  const before = await f.createAccess(true); const result = await service.revokeOpenCreditCommercialAccess(db, f.input);
  assert.deepEqual(result, { changed: true, enabled: false, accessId: before.id }); await transitionEvent(f, "REVOKED", true, false);
});
material("revoke disabled is a true no-op preserving actor and timestamp", async f => {
  const before = await f.createAccess(false); const result = await service.revokeOpenCreditCommercialAccess(db, f.input);
  assert.deepEqual(result, { changed: false, enabled: false, accessId: before.id });
  assert.deepEqual(await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: before.id } }), before);
  assert.equal((await f.events()).length, 0);
});
material("revoke absent creates neither Access nor Event", async f => {
  assert.deepEqual(await service.revokeOpenCreditCommercialAccess(db, f.input), { changed: false, enabled: false, accessId: null }); await empty(f);
});
for (const role of ["ADMIN","SUPERVISOR","AGENT"] as const) material("Company " + role + " cannot grant or revoke", async f => {
  const user = await db.user.create({ data: { companyId: f.companyId, name: "Synthetic Company user",
    email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role } });
  const actor: SessionUser = { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role };
  for (const operation of [service.grantOpenCreditCommercialAccess, service.revokeOpenCreditCommercialAccess]) {
    await denied(() => operation(db, { ...f.input, actor }), "NOT_AUTHORIZED");
  }
  await empty(f);
});
for (const stale of ["role","company","email","removed"] as const) material("stale actor fails closed after " + stale + " change", async f => {
  if (stale === "removed") await db.user.delete({ where: { id: f.actor.id } });
  else await db.user.update({ where: { id: f.actor.id }, data: stale === "role" ? { role: "AGENT" }
    : stale === "company" ? { companyId: f.otherCompany } : { email: "changed-" + randomUUID() + "@example.invalid" } });
  for (const operation of [service.grantOpenCreditCommercialAccess, service.revokeOpenCreditCommercialAccess]) {
    await denied(() => operation(db, f.input), "NOT_AUTHORIZED");
  }
  await empty(f);
});
material("missing Company is a sanitized explicit failure", async f => {
  const missing = "missing-" + randomUUID();
  await denied(() => service.grantOpenCreditCommercialAccess(db, { ...f.input, companyId: missing }), "COMPANY_NOT_FOUND");
  assert.equal(await db.openCreditCommercialAccess.count({ where: { companyId: missing } }), 0); await empty(f);
});
material("invalid scope rejects before persisting any state", async f => {
  await denied(() => service.grantOpenCreditCommercialAccess(db, { ...f.input, providerScope: " INVALID" as OpenCreditCommercialAccessInput["providerScope"] }), "INVALID_PROVIDER_SCOPE");
  await empty(f);
});
material("existing email allowlist fallback accepts only the current allowed platform actor", async f => {
  delete process.env.PLATFORM_COMPANY_ID; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
  await service.grantOpenCreditCommercialAccess(db, f.input); await transitionEvent(f, "GRANTED", null, true);
});
material("Company and scope isolate independent transitions", async f => {
  await service.grantOpenCreditCommercialAccess(db, f.input);
  await service.revokeOpenCreditCommercialAccess(db, { ...f.input, companyId: f.otherCompany });
  assert.equal(await db.openCreditCommercialAccess.count({ where: { companyId: f.otherCompany, providerScope: f.input.providerScope } }), 0);
  assert.equal((await f.events()).length, 1);
});

// Test-only proxies preserve the actual Prisma transaction and database errors.
function wrapped(wrap: (tx: Prisma.TransactionClient) => Prisma.TransactionClient): ServiceDb {
  return { $transaction: (run: Work, options: Options) => db.$transaction(tx => run(wrap(tx)), options) } as unknown as ServiceDb;
}
function simultaneousReads() {
  let arrivals = 0; let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
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
  return { client, arrivals: () => arrivals };
}
for (const mode of ["absent-grants","disabled-grants","enabled-revokes"] as const) material("two real concurrent " + mode + " produce one transition/event", async f => {
  if (mode !== "absent-grants") await f.createAccess(mode === "enabled-revokes");
  const race = simultaneousReads(); const granting = mode !== "enabled-revokes";
  const operation = granting ? service.grantOpenCreditCommercialAccess : service.revokeOpenCreditCommercialAccess;
  const results = await Promise.all([operation(race.client, f.input), operation(race.client, f.input)]);
  assert.equal(race.arrivals(), 2); assert.equal(results.filter(r => r.changed).length, 1);
  assert.equal(results.filter(r => !r.changed).length, 1); assert.ok(results.every(r => r.enabled === granting));
  assert.equal(await db.openCreditCommercialAccess.count({ where: f.where }), 1);
  await transitionEvent(f, granting ? "GRANTED" : "REVOKED", mode === "absent-grants" ? null : !granting, granting);
});
for (const initial of [undefined, false] as const) material("real Event FK failure rolls back Access " + (initial === undefined ? "create" : "update"), async f => {
  const before = initial === undefined ? null : await f.createAccess(initial); let observedTransition = false;
  const client = wrapped(tx => new Proxy(tx, { get(target, key) {
    if (key !== "openCreditCommercialAccessEvent") return Reflect.get(target, key);
    return new Proxy(target.openCreditCommercialAccessEvent, { get(delegate, method) {
      if (method !== "create") return Reflect.get(delegate, method);
      return async (args: Prisma.OpenCreditCommercialAccessEventCreateArgs) => {
        const inTransaction = await tx.openCreditCommercialAccess.findUniqueOrThrow({
          where: { companyId_providerScope: f.where } });
        observedTransition = inTransaction.enabled && inTransaction.changedByUserId === f.actor.id;
        return delegate.create({ ...args, data: { ...args.data, actorUserId: "missing-" + randomUUID() } as Prisma.OpenCreditCommercialAccessEventUncheckedCreateInput });
      };
    } });
  } }));
  await denied(() => service.grantOpenCreditCommercialAccess(client, f.input), "STORAGE_ERROR");
  assert.equal(observedTransition, true); assert.equal((await f.events()).length, 0);
  assert.deepEqual(await db.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: f.where } }), before);
});
material("grant/revoke race yields a valid serial history without assuming which operation wins", async f => {
  const initial = await f.createAccess(false); const race = simultaneousReads();
  const [grant, revoke] = await Promise.all([service.grantOpenCreditCommercialAccess(race.client, f.input),
    service.revokeOpenCreditCommercialAccess(race.client, f.input)]);
  assert.equal(grant.changed, true); assert.equal(grant.enabled, true);
  const events = await f.events(); const final = await db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: initial.id } });
  assert.equal(events.length, revoke.changed ? 2 : 1); assert.equal(final.enabled, !revoke.changed);
  assert.equal(events.filter(e => e.action === "GRANTED" && e.previousEnabled === false && e.nextEnabled).length, 1);
  assert.equal(events.filter(e => e.action === "REVOKED" && e.previousEnabled === true && !e.nextEnabled).length, revoke.changed ? 1 : 0);
});
