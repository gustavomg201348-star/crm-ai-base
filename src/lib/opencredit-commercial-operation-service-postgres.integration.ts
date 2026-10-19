import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditPrepareClientProfileInput, OpenCreditOperationTransitionInput, OpenCreditCommercialOperationServiceCode } from "./opencredit-commercial-operation.service";
import type { OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";

assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
before(async () => {
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try { service = await import("./opencredit-commercial-operation.service"); } finally { loader._load = original; }
});
after(async () => { await db.$disconnect(); });
type Db = Parameters<typeof service.prepareOpenCreditClientProfileOperation>[0];
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const [companyId, otherCompany, platform] = ["target", "other", "platform"].map(p => "operation-service-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [companyId, otherCompany, platform].map(id => ({ id, name: "Synthetic operation fixture" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: "ADMIN" };
  const scope = "synthetic-" + randomUUID().replace(/\d/g, d => String.fromCharCode(103 + Number(d)));
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic person", phone: "11900000000", email: "synthetic@example.invalid", cpf: "00000000000" } });
  const access = await db.openCreditCommercialAccess.create({ data: { companyId, providerScope: scope, enabled: true, changedByUserId: actor.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId, contactId: contact.id, providerScope: scope, normalizedCpf: "00000000000", enabled: true, createdByUserId: actor.id } });
  const input: OpenCreditPrepareClientProfileInput = { actor, companyId, contactId: contact.id, providerScope: scope as OpenCreditPrepareClientProfileInput["providerScope"], intentKey: randomUUID() };
  const where = { companyId, providerScope: scope };
  const current = () => db.openCreditCommercialOperation.findFirst({ where });
  const events = () => db.openCreditCommercialOperationEvent.findMany({ where, orderBy: [{ revision: "asc" }, { id: "asc" }] });
  return { companyId, otherCompany, platform, actor, contact, access, identity, input, where, current, events };
}
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      await run(f);
    } catch (e) {
      const code = e instanceof service.OpenCreditCommercialOperationServiceError ? e.code : e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "ASSERTION_OR_OTHER_FAILURE";
      throw new Error("OPENCREDIT_OPERATION_SERVICE_MATERIAL_FAILED:" + code);
    } finally {
      if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
      if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
    }
    // Append-only audit fixtures remain until the disposable database is destroyed.
  });
}
async function denied(run: () => Promise<unknown>, code: OpenCreditCommercialOperationServiceCode) {
  await assert.rejects(run, e => e instanceof service.OpenCreditCommercialOperationServiceError && e.code === code && e.message === "OPENCREDIT_COMMERCIAL_OPERATION_" + code && !("cause" in e) && !("profile" in e));
}
async function prepared(f: Fixture): Promise<OpenCreditOperationTransitionInput> {
  const r = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  return { actor: f.actor, companyId: f.companyId, providerScope: f.input.providerScope, operationId: r.operationId, expectedRevision: 0 };
}
async function event(f: Fixture, count: number, action: string, previous: string | null, next: string, revision: number, actor = f.actor.id) {
  const events = await f.events(); assert.equal(events.length, count); const e = events[events.length - 1];
  assert.equal(e.action, action); assert.equal(e.previousState, previous); assert.equal(e.nextState, next); assert.equal(e.revision, revision); assert.equal(e.actorUserId, actor);
  assert.deepEqual(Object.keys(e).sort(), ["id", "operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", "createdAt"].sort());
  assert.deepEqual(Object.keys((await f.current())!).sort(), ["id", "companyId", "remoteIdentityId", "providerScope", "operationKind", "intentKey", "state", "revision", "createdByUserId", "createdAt", "updatedAt"].sort());
}
material("PREPARE creates only PREPARED revision zero and one atomic event without PII", async f => {
  const r = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  assert.deepEqual(r, { changed: true, operationId: (await f.current())!.id, state: "PREPARED", revision: 0 });
  assert.equal((await f.current())!.operationKind, "CLIENT_PROFILE_UPSERT"); assert.equal((await f.current())!.createdByUserId, f.actor.id);
  await event(f, 1, "PREPARED", null, "PREPARED", 0);
});
for (const state of ["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"]) material("same intent remains a strict no-op after revocation and contact changes in " + state, async f => {
  const i = await prepared(f);
  // Historical states are synthetic test setup, not service completion APIs.
  await db.openCreditCommercialOperation.update({ where: { id: i.operationId }, data: { state } });
  await db.openCreditCommercialAccess.update({ where: { id: f.access.id }, data: { enabled: false } });
  await db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { enabled: false } });
  await db.contact.update({ where: { id: f.contact.id }, data: { cpf: null, archivedAt: new Date() } });
  const before = await f.current(); const events = await f.events();
  assert.deepEqual(await service.prepareOpenCreditClientProfileOperation(db, f.input), { changed: false, operationId: i.operationId, state, revision: 0 });
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("same intent with a different Contact or kind is INTENT_CONFLICT", async f => {
  const i = await prepared(f); const before = await f.current();
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, { ...f.input, contactId: "synthetic-other-contact" }), "INTENT_CONFLICT");
  assert.deepEqual(await f.current(), before);
  await db.openCreditCommercialOperation.update({ where: { id: i.operationId }, data: { operationKind: "UNKNOWN_KIND" } });
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, f.input), "INTENT_CONFLICT"); assert.equal((await f.events()).length, 1);
});
material("unknown historical state fails closed", async f => {
  const i = await prepared(f); await db.openCreditCommercialOperation.update({ where: { id: i.operationId }, data: { state: "UNRECOGNIZED" } });
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, f.input), "OPERATION_STATE_INVALID");
});
// Both first attempts read the same committed snapshot before either writer proceeds.
function barrierDb(kind: "prepare" | "reserve" | "settle"): Db {
  let arrivals = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  return { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditCommercialOperation, { get(target, key) {
      if (key === "findUnique") return async (args: Parameters<typeof target.findUnique>[0]) => {
        const result = await target.findUnique(args);
        const matches = kind === "prepare" ? "companyId_providerScope_intentKey" in args.where : "id_companyId_providerScope" in args.where;
        if (matches && arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; }
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    return run(new Proxy(tx, { get: (target, key) => key === "openCreditCommercialOperation" ? delegate : Reflect.get(target, key) }));
  }, options) } as Db;
}
material("concurrent PREPARE converges to exactly one operation and PREPARED event", async f => {
  const concurrent = barrierDb("prepare"); const results = await Promise.all([service.prepareOpenCreditClientProfileOperation(concurrent, f.input), service.prepareOpenCreditClientProfileOperation(concurrent, f.input)]);
  assert.equal(results[0].operationId, results[1].operationId); assert.equal(results.filter(r => r.changed).length, 1);
  assert.equal(await db.openCreditCommercialOperation.count({ where: f.where }), 1); await event(f, 1, "PREPARED", null, "PREPARED", 0);
});
const freshness = ["access-missing", "access-disabled", "identity-missing", "identity-disabled", "archived", "cpf-mismatch", "ambiguous", "invalid-profile"] as const;
async function invalidate(f: Fixture, mode: typeof freshness[number]) {
  if (mode === "access-missing") { await db.openCreditRemoteIdentity.delete({ where: { id: f.identity.id } }); await db.openCreditCommercialAccess.delete({ where: { id: f.access.id } }); }
  if (mode === "access-disabled") await db.openCreditCommercialAccess.update({ where: { id: f.access.id }, data: { enabled: false } });
  if (mode === "identity-missing") await db.openCreditRemoteIdentity.delete({ where: { id: f.identity.id } });
  if (mode === "identity-disabled") await db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { enabled: false } });
  if (mode === "archived") await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } });
  if (mode === "cpf-mismatch") await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "11111111111" } });
  if (mode === "ambiguous") await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic archived duplicate", phone: "SYNTHETIC", cpf: "000.000.000-00", archivedAt: new Date() } });
  if (mode === "invalid-profile") await db.contact.update({ where: { id: f.contact.id }, data: { name: "" } });
}
const freshnessCode = { "access-missing": "COMMERCIAL_ACCESS_MISSING", "access-disabled": "COMMERCIAL_ACCESS_DISABLED", "identity-missing": "IDENTITY_NOT_FOUND", "identity-disabled": "IDENTITY_DISABLED", archived: "CONTACT_ARCHIVED", "cpf-mismatch": "IDENTITY_SNAPSHOT_MISMATCH", ambiguous: "CONTACT_AMBIGUOUS", "invalid-profile": "PROFILE_INVALID" } as const;
for (const mode of freshness) material("new PREPARE rejects " + mode + " without operation or event", async f => {
  await invalidate(f, mode); await denied(() => service.prepareOpenCreditClientProfileOperation(db, f.input), freshnessCode[mode]);
  assert.equal(await f.current(), null); assert.equal((await f.events()).length, 0);
});
material("RESERVE rebuilds fresh profile and commits IN_FLIGHT revision one with no payload persistence", async f => {
  const i = await prepared(f); await db.contact.update({ where: { id: f.contact.id }, data: { name: "Fresh synthetic person", phone: "21900000000", email: "fresh@example.invalid" } });
  const r = await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  assert.equal(r.state, "IN_FLIGHT"); assert.equal(r.revision, 1); assert.deepEqual(Object.keys(r).sort(), ["operationId", "profile", "revision", "state"]);
  assert.equal(r.profile.nome, "Fresh synthetic person"); assert.equal(r.profile.email, "fresh@example.invalid");
  assert.ok(JSON.stringify(r.profile).includes("21900000000")); await event(f, 2, "RESERVED_FOR_DISPATCH", "PREPARED", "IN_FLIGHT", 1);
});
for (const mode of freshness.filter(m => m !== "access-missing" && m !== "identity-missing")) material("RESERVE rejects stale " + mode + " before CAS", async f => {
  const i = await prepared(f); const before = await f.current(); const events = await f.events(); await invalidate(f, mode);
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, i), freshnessCode[mode]);
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("concurrent RESERVE releases a profile only to the committed winner; loser cannot replay", async f => {
  const i = await prepared(f); const concurrent = barrierDb("reserve");
  const results = await Promise.allSettled([service.reserveOpenCreditClientProfileOperationForDispatch(concurrent, i), service.reserveOpenCreditClientProfileOperationForDispatch(concurrent, i)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "fulfilled") { assert.ok(result.value.profile); assert.equal(result.value.revision, 1); }
    else { assert.ok(result.reason instanceof service.OpenCreditCommercialOperationServiceError); assert.ok(["OPERATION_STATE_CONFLICT", "OPERATION_REVISION_CONFLICT"].includes(result.reason.code)); assert.equal("profile" in result.reason, false); }
  }
  await event(f, 2, "RESERVED_FOR_DISPATCH", "PREPARED", "IN_FLIGHT", 1);
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, i), "OPERATION_STATE_CONFLICT"); assert.equal((await f.events()).length, 2);
});
material("wrong revision is semantic conflict with no write", async f => {
  const i = await prepared(f); const before = await f.current();
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, { ...i, expectedRevision: 1 }), "OPERATION_REVISION_CONFLICT"); assert.deepEqual(await f.current(), before);
});
material("UNKNOWN remains available after all post-dispatch revocations and is repeatable without replay", async f => {
  const i = await prepared(f); await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  await invalidate(f, "access-disabled"); await invalidate(f, "identity-disabled"); await invalidate(f, "archived"); await invalidate(f, "cpf-mismatch"); await invalidate(f, "ambiguous");
  assert.deepEqual(await service.markOpenCreditCommercialOperationUnknown(db, { ...i, expectedRevision: 1 }), { changed: true, operationId: i.operationId, state: "UNKNOWN", revision: 2 });
  await event(f, 3, "MARKED_UNKNOWN", "IN_FLIGHT", "UNKNOWN", 2);
  const before = await f.current(); const events = await f.events();
  assert.deepEqual(await service.markOpenCreditCommercialOperationUnknown(db, i), { changed: false, operationId: i.operationId, state: "UNKNOWN", revision: 2 });
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, { ...i, expectedRevision: 2 }), "OPERATION_STATE_CONFLICT");
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("PREPARED cannot be marked UNKNOWN", async f => {
  const i = await prepared(f); await denied(() => service.markOpenCreditCommercialOperationUnknown(db, i), "OPERATION_STATE_CONFLICT"); assert.equal((await f.events()).length, 1);
});
for (const mode of ["prepare", "reserve", "unknown", "settle"] as const) material("real event FK failure rolls back observed operation mutation in " + mode, async f => {
  let i: OpenCreditOperationTransitionInput | undefined;
  if (mode !== "prepare") i = await prepared(f);
  if (mode === "unknown" || mode === "settle") { await service.reserveOpenCreditClientProfileOperationForDispatch(db, i!); i = { ...i!, expectedRevision: 1 }; }
  const before = await f.current(); const events = await f.events(); let observed = false; let fkRejected = false;
  const failpoint = { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditCommercialOperationEvent, { get(target, key) {
      if (key === "create") return async (args: Prisma.OpenCreditCommercialOperationEventCreateArgs) => {
        const changed = await tx.openCreditCommercialOperation.findFirst({ where: f.where });
        assert.ok(changed); assert.equal(changed.state, mode === "prepare" ? "PREPARED" : mode === "reserve" ? "IN_FLIGHT" : mode === "settle" ? "SUCCEEDED" : "UNKNOWN"); observed = true;
        try { return await target.create({ ...args, data: { ...args.data as Prisma.OpenCreditCommercialOperationEventUncheckedCreateInput, actorUserId: "missing-synthetic-actor-" + randomUUID() } }); }
        catch (e) { fkRejected = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003"; throw e; }
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    return run(new Proxy(tx, { get: (target, key) => key === "openCreditCommercialOperationEvent" ? delegate : Reflect.get(target, key) }));
  }, options) } as Db;
  await denied(() => mode === "prepare" ? service.prepareOpenCreditClientProfileOperation(failpoint, f.input) : mode === "reserve" ? service.reserveOpenCreditClientProfileOperationForDispatch(failpoint, i!)
    : mode === "settle" ? service.applyOpenCreditCreateClientObservation(failpoint, i!, observation()) : service.markOpenCreditCommercialOperationUnknown(failpoint, i!), "STORAGE_ERROR");
  assert.equal(observed, true); assert.equal(fkRejected, true); assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("effective transition actor differs from creator and is audited atomically", async f => {
  const i = await prepared(f);
  const user = await db.user.create({ data: { companyId: f.platform, role: "ADMIN", name: "Synthetic second admin", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH" } });
  const actor: SessionUser = { id: user.id, companyId: user.companyId, role: "ADMIN", email: user.email, name: user.name };
  process.env.PLATFORM_ADMIN_EMAILS = f.actor.email + "," + actor.email;
  await service.reserveOpenCreditClientProfileOperationForDispatch(db, { ...i, actor });
  await event(f, 2, "RESERVED_FOR_DISPATCH", "PREPARED", "IN_FLIGHT", 1, actor.id); assert.equal((await f.current())!.createdByUserId, f.actor.id);
  await service.applyOpenCreditCreateClientObservation(db, { ...i, actor, expectedRevision: 1 }, observation());
  await event(f, 3, "MARKED_SUCCEEDED_CREATED", "IN_FLIGHT", "SUCCEEDED", 2, actor.id);
  assert.equal((await f.current())!.createdByUserId, f.actor.id);
});
material("cross-company and cross-scope operation reads fail closed without profile", async f => {
  const i = await prepared(f);
  for (const fn of [service.reserveOpenCreditClientProfileOperationForDispatch, service.markOpenCreditCommercialOperationUnknown]) {
    await denied(() => fn(db, { ...i, companyId: f.otherCompany }), "OPERATION_NOT_FOUND");
    await denied(() => fn(db, { ...i, providerScope: "synthetic-other-scope" as typeof i.providerScope }), "OPERATION_NOT_FOUND");
  }
  await denied(() => service.applyOpenCreditCreateClientObservation(db, { ...i, companyId: f.otherCompany }, observation()), "OPERATION_NOT_FOUND");
  await denied(() => service.applyOpenCreditCreateClientObservation(db, { ...i, providerScope: "synthetic-other-scope" as typeof i.providerScope }, observation()), "OPERATION_NOT_FOUND");
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, { ...f.input, companyId: f.otherCompany }), "CONTACT_NOT_FOUND"); assert.equal((await f.events()).length, 1);
});
material("stale platform actor cannot prepare, reserve or mark UNKNOWN", async f => {
  const i = await prepared(f); await db.user.update({ where: { id: f.actor.id }, data: { role: "AGENT" } });
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, f.input), "NOT_AUTHORIZED");
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, i), "NOT_AUTHORIZED");
  await denied(() => service.markOpenCreditCommercialOperationUnknown(db, i), "NOT_AUTHORIZED"); assert.equal((await f.events()).length, 1);
  await denied(() => service.applyOpenCreditCreateClientObservation(db, i, observation()), "NOT_AUTHORIZED"); assert.equal((await f.events()).length, 1);
});

function observation(success = true, created = true): OpenCreditCreateClientObservation {
  return { kind: "PARSED_RESPONSE", status: 201, result: { success, created } };
}
async function inFlight(f: Fixture): Promise<OpenCreditOperationTransitionInput> {
  const i = await prepared(f); await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  return { ...i, expectedRevision: 1 };
}
for (const created of [true, false]) material("material SUCCEEDED " + (created ? "CREATED" : "UPDATED") + " preserves post-dispatch fact and first terminal history", async f => {
  const i = await inFlight(f);
  for (const mode of ["access-disabled", "identity-disabled", "archived", "cpf-mismatch", "ambiguous"] as const) await invalidate(f, mode);
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(db, i, observation(true, created)),
    { changed: true, operationId: i.operationId, state: "SUCCEEDED", revision: 2 });
  await event(f, 3, created ? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED", "IN_FLIGHT", "SUCCEEDED", 2);
  assert.deepEqual((await f.events()).map(e => [e.action, e.revision]), [["PREPARED", 0], ["RESERVED_FOR_DISPATCH", 1],
    [created ? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED", 2]]);
  const before = await f.current(), events = await f.events();
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(db, { ...i, expectedRevision: 0 }, observation(true, !created)),
    { changed: false, operationId: i.operationId, state: "SUCCEEDED", revision: 2 });
  await denied(() => service.applyOpenCreditCreateClientObservation(db, i, observation(false, false)), "OPERATION_STATE_CONFLICT");
  await denied(() => service.markOpenCreditCommercialOperationUnknown(db, i), "OPERATION_STATE_CONFLICT");
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, { ...i, expectedRevision: 2 }), "OPERATION_STATE_CONFLICT");
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("material observation UNKNOWN is terminal with no promotion, reset or duplicate event", async f => {
  const i = await inFlight(f);
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(db, i, observation(false, false)),
    { changed: true, operationId: i.operationId, state: "UNKNOWN", revision: 2 });
  await event(f, 3, "MARKED_UNKNOWN", "IN_FLIGHT", "UNKNOWN", 2);
  const before = await f.current(), events = await f.events();
  assert.deepEqual(await service.applyOpenCreditCreateClientObservation(db, i, { kind: "NO_RESPONSE", reason: "TIMEOUT" }),
    { changed: false, operationId: i.operationId, state: "UNKNOWN", revision: 2 });
  await denied(() => service.applyOpenCreditCreateClientObservation(db, i, observation()), "OPERATION_STATE_CONFLICT");
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("material concurrent SUCCEEDED observations converge to one terminal CAS and one event", async f => {
  const i = await inFlight(f), concurrent = barrierDb("settle");
  const results = await Promise.all([service.applyOpenCreditCreateClientObservation(concurrent, i, observation()),
    service.applyOpenCreditCreateClientObservation(concurrent, i, observation(true, false))]);
  assert.equal(results.filter(r => r.changed).length, 1);
  for (const result of results) { assert.equal(result.state, "SUCCEEDED"); assert.equal(result.revision, 2); }
  const events = await f.events(); assert.equal(events.length, 3);
  assert(["MARKED_SUCCEEDED_CREATED", "MARKED_SUCCEEDED_UPDATED"].includes(events[2].action));
  assert.equal(events[2].previousState, "IN_FLIGHT"); assert.equal(events[2].nextState, "SUCCEEDED"); assert.equal(events[2].revision, 2);
  assert.equal((await f.current())!.state, "SUCCEEDED"); assert.equal((await f.current())!.revision, 2);
});
material("material competing SUCCEEDED and UNKNOWN preserve only the first terminal winner", async f => {
  const i = await inFlight(f), concurrent = barrierDb("settle");
  const results = await Promise.allSettled([service.applyOpenCreditCreateClientObservation(concurrent, i, observation()),
    service.applyOpenCreditCreateClientObservation(concurrent, i, observation(false, false))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(results.filter(r => r.status === "rejected").length, 1);
  const current = (await f.current())!, events = await f.events();
  assert(["SUCCEEDED", "UNKNOWN"].includes(current.state)); assert.equal(current.revision, 2); assert.equal(events.length, 3);
  assert.equal(events[2].revision, 2); assert.equal(events[2].previousState, "IN_FLIGHT"); assert.equal(events[2].nextState, current.state);
  for (const result of results) {
    if (result.status === "fulfilled") { assert.equal(result.value.changed, true); assert.equal(result.value.state, current.state); }
    else { assert(result.reason instanceof service.OpenCreditCommercialOperationServiceError); assert(["OPERATION_STATE_CONFLICT", "OPERATION_REVISION_CONFLICT"].includes(result.reason.code)); }
  }
  const opposite = current.state === "SUCCEEDED" ? observation(false, false) : observation();
  await denied(() => service.applyOpenCreditCreateClientObservation(db, i, opposite), "OPERATION_STATE_CONFLICT");
  assert.deepEqual(await f.current(), current); assert.deepEqual(await f.events(), events);
});
