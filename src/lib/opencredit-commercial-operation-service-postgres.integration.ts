import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditPrepareClientProfileInput, OpenCreditOperationTransitionInput, OpenCreditCommercialOperationServiceCode } from "./opencredit-commercial-operation.service";
import type { OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
let authorizationService: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
let diagnosticStorage: typeof import("./opencredit-create-client-diagnostic.service");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw new Error("EXTERNAL_HTTP_FORBIDDEN_IN_RESERVATION_TEST"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    service = await import("./opencredit-commercial-operation.service");
    authorizationService = await import("./opencredit-consumer-authorization.service");
    provenance = await import("./meta-inbound-provenance");
    diagnosticStorage = await import("./opencredit-create-client-diagnostic.service");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
type Db = Parameters<typeof service.prepareOpenCreditClientProfileOperation>[0];
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture() {
  const [companyId, otherCompany, platform] = ["target", "other", "platform"].map(p => "operation-service-ci-" + p + "-" + randomUUID());
  await db.company.createMany({ data: [companyId, otherCompany, platform].map(id => ({ id, name: "Synthetic operation fixture" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_PASSWORD_HASH", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: "ADMIN" };
  const scope = "synthetic-" + randomUUID().replace(/\d/g, d => String.fromCharCode(103 + Number(d)));
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic person", phone: "11900000000", normalizedPhone: classifyPhoneNormalization("11900000000").normalizedPhone, email: "synthetic@example.invalid", cpf: "00000000000" } });
  const access = await db.openCreditCommercialAccess.create({ data: { companyId, providerScope: scope, enabled: true, changedByUserId: actor.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId, contactId: contact.id, providerScope: scope, normalizedCpf: "00000000000", enabled: true, createdByUserId: actor.id } });
  const input: OpenCreditPrepareClientProfileInput = { actor, companyId, contactId: contact.id, providerScope: scope as OpenCreditPrepareClientProfileInput["providerScope"], intentKey: randomUUID() };
  const where = { companyId, providerScope: scope };
  const current = () => db.openCreditCommercialOperation.findFirst({ where });
  const events = () => db.openCreditCommercialOperationEvent.findMany({ where, orderBy: [{ revision: "asc" }, { id: "asc" }] });
  let evidenceId: string | undefined;
  async function attest() {
    if (!evidenceId) {
      const secret = "synthetic-reservation-hmac";
      const channel = await db.channel.create({ data: { companyId, name: "Synthetic", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: secret, phoneNumberId: randomUUID() } });
      const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
      const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId },
        messages: [{ id: randomUUID(), from: contact.phone, type: "text", text: { body: "Synthetic reviewed evidence" }, timestamp: "1792238400" }]
      } }] }] });
      const [item] = await provenance.authenticateMetaInboundBatch({ db, rawBody: raw, signature: "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") });
      const message = await persistInboundMessage(db, { conversationId: conversation.id, direction: "inbound", senderType: "customer",
        body: item.input.body.trim(), type: "text", providerMessageId: item.input.providerMessageId }, {
        companyId, contactId: contact.id, channelId: channel.id, senderPhone: item.input.phone, metadata: item.input.replyMetadata
      }, companyId, item.capability);
      evidenceId = (await db.conversationInboundEvent.findUniqueOrThrow({ where: { messageId: message.id } })).id;
    }
    return authorizationService.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db,
      { actor, companyId, contactId: contact.id, providerScope: input.providerScope, inboundEventId: evidenceId });
  }
  const revokeInput = { actor, companyId, contactId: contact.id, providerScope: input.providerScope };
  return { companyId, otherCompany, platform, actor, contact, access, identity, input, where, current, events, attest, revokeInput };
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
async function prepared(f: Fixture, authorized = true): Promise<OpenCreditOperationTransitionInput> {
  const r = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  if (authorized) await f.attest();
  return { actor: f.actor, companyId: f.companyId, providerScope: f.input.providerScope, operationId: r.operationId, expectedRevision: 0 };
}
async function event(f: Fixture, count: number, action: string, previous: string | null, next: string, revision: number, actor = f.actor.id) {
  const events = await f.events(); assert.equal(events.length, count); const e = events[events.length - 1];
  assert.equal(e.action, action); assert.equal(e.previousState, previous); assert.equal(e.nextState, next); assert.equal(e.revision, revision); assert.equal(e.actorUserId, actor);
  assert.deepEqual(Object.keys(e).sort(), ["id", "operationId", "companyId", "providerScope", "actorUserId", "action", "previousState", "nextState", "revision", "createdAt", "dispatchAuthorizationEventId"].sort());
  if (action === "RESERVED_FOR_DISPATCH") {
    assert.ok(e.dispatchAuthorizationEventId);
    const grant = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { id: e.dispatchAuthorizationEventId } });
    assert.equal(grant.companyId, f.companyId); assert.equal(grant.providerScope, f.input.providerScope);
    assert.equal(grant.action, "GRANTED"); assert.equal(grant.nextActive, true);
  } else assert.equal(e.dispatchAuthorizationEventId, null);
  assert.deepEqual(Object.keys((await f.current())!).sort(), ["id", "companyId", "remoteIdentityId", "providerScope", "operationKind", "intentKey", "state", "revision", "createdByUserId", "createdAt", "updatedAt", "diagnostic"].sort());
}
material("diagnostic independent commit survives terminal rollback without ledger mutation or replay", async f => {
  const i = await prepared(f); await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  const transition = { ...i, expectedRevision: 1 };
  const diagnostic = { version: 1 as const, category: "INVALID_JSON" as const, stage: "RESPONSE" as const,
    providerHttpStatus: 201, providerRequestId: "req_abcdefabcdef", providerCorrelationId: null, providerSuccess: null,
    providerCreated: null, providerErrorCode: null, responseReadable: false, responseParsed: false,
    observedAt: "2026-10-26T00:00:02.000Z", dispatchCommittedAt: "2026-10-26T00:00:00.000Z",
    respondedAt: "2026-10-26T00:00:01.000Z", settlement: "NOT_CONFIRMED" as const };
  const results = await Promise.all([diagnosticStorage.persistCreateClientDiagnostic(db, transition, diagnostic),
    diagnosticStorage.persistCreateClientDiagnostic(db, transition, diagnostic)]);
  assert.equal(results.filter(Boolean).length, 1);
  const before = (await f.current())!, events = await f.events();
  assert.equal(before.state, "IN_FLIGHT"); assert.equal(before.revision, 1);
  const rollbackDb = { $transaction: (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async tx => {
    await run(tx); throw Error("SYNTHETIC_TERMINAL_ROLLBACK");
  }) } as unknown as Db;
  await denied(() => service.applyOpenCreditCreateClientObservation(rollbackDb, transition,
    { kind: "NO_RESPONSE", reason: "NETWORK" }), "STORAGE_ERROR");
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
  assert.equal(await diagnosticStorage.persistCreateClientDiagnostic(db, { ...transition, companyId: f.otherCompany },
    { ...diagnostic, settlement: "ERROR" }, diagnostic), false);
  assert.equal(await diagnosticStorage.persistCreateClientDiagnostic(db, transition, { ...diagnostic, settlement: "ERROR" }, diagnostic), true);
  assert.equal(JSON.parse((await f.current())!.diagnostic!).settlement, "ERROR");
  assert.equal((await f.current())!.state, "IN_FLIGHT"); assert.equal((await f.events()).length, 2);
});
material("historical diagnostic is null; confirmed diagnostic update leaves terminal state and events intact", async f => {
  const i = await prepared(f); assert.equal((await f.current())!.diagnostic, null);
  await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  const d = { version: 1 as const, category: "NONE" as const, stage: "RESPONSE" as const, providerHttpStatus: 201,
    providerRequestId: null, providerCorrelationId: null, providerSuccess: true, providerCreated: false, providerErrorCode: null,
    responseReadable: true, responseParsed: true, observedAt: "2026-10-26T00:00:02.000Z", dispatchCommittedAt: "2026-10-26T00:00:00.000Z",
    respondedAt: "2026-10-26T00:00:01.000Z", settlement: "NOT_CONFIRMED" as const };
  assert.equal(await diagnosticStorage.persistCreateClientDiagnostic(db, { ...i, expectedRevision: 1 }, d), true);
  await service.applyOpenCreditCreateClientObservation(db, { ...i, expectedRevision: 1 },
    { kind: "PARSED_RESPONSE", status: 201, result: { success: true, created: false } });
  const events = await f.events();
  assert.equal(await diagnosticStorage.persistCreateClientDiagnostic(db, { ...i, expectedRevision: 2 }, { ...d, settlement: "CONFIRMED" }, d), true);
  assert.equal((await f.current())!.state, "SUCCEEDED"); assert.equal((await f.current())!.revision, 2);
  assert.deepEqual(await f.events(), events);
});
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
material("single intention is idempotent and a sequential distinct command is blocked", async f => {
  const first = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  const where = { ...f.where, remoteIdentityId: f.identity.id }, before = await db.openCreditCommercialOperation.findMany({ where, orderBy: { id: "asc" } }), events = await f.events();
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, { ...f.input, intentKey: randomUUID() }), "INTENT_CONFLICT");
  assert.deepEqual(await service.prepareOpenCreditClientProfileOperation(db, f.input), { ...first, changed: false });
  assert.equal(before.length, 1); assert.deepEqual(await db.openCreditCommercialOperation.findMany({ where, orderBy: { id: "asc" } }), before);
  assert.deepEqual(await f.events(), events); assert.equal(events.filter(e => e.action === "PREPARED").length, 1);
});
material("single intention is scoped: another identity and another providerScope can prepare independently", async f => {
  const first = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  const other = await db.contact.create({ data: { companyId: f.companyId, name: "Synthetic other", phone: "11900000001", cpf: "11111111111" } });
  await db.openCreditRemoteIdentity.create({ data: { companyId: f.companyId, providerScope: f.input.providerScope, contactId: other.id,
    normalizedCpf: "11111111111", enabled: true, createdByUserId: f.actor.id } });
  const second = await service.prepareOpenCreditClientProfileOperation(db, { ...f.input, contactId: other.id, intentKey: randomUUID() });
  const providerScope = (f.input.providerScope + "-other") as typeof f.input.providerScope;
  await db.openCreditCommercialAccess.create({ data: { companyId: f.companyId, providerScope, enabled: true, changedByUserId: f.actor.id } });
  await db.openCreditRemoteIdentity.create({ data: { companyId: f.companyId, providerScope, contactId: f.contact.id,
    normalizedCpf: "00000000000", enabled: true, createdByUserId: f.actor.id } });
  const third = await service.prepareOpenCreditClientProfileOperation(db, { ...f.input, providerScope, intentKey: randomUUID() });
  assert.equal(new Set([first.operationId, second.operationId, third.operationId]).size, 3);
  assert.equal(await db.openCreditCommercialOperation.count({ where: { companyId: f.companyId } }), 3);
  assert.equal(await db.openCreditCommercialOperationEvent.count({ where: { companyId: f.companyId, action: "PREPARED" } }), 3);
});
// Both first attempts read the same committed snapshot before either writer proceeds.
function barrierDb(kind: "prepare" | "distinct" | "reserve" | "settle", stats?: { p2034: number; identityP2002: number; arrivals: number }): Db {
  let arrivals = 0; let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  return { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditCommercialOperation, { get(target, key) {
      if (key === (kind === "distinct" ? "findFirst" : "findUnique")) return async (args: Parameters<typeof target.findUnique>[0]) => {
        const result = kind === "distinct" ? await target.findFirst(args) : await target.findUnique(args);
        const matches = kind === "distinct" ? args.where.operationKind === "CLIENT_PROFILE_UPSERT"
          : kind === "prepare" ? "companyId_providerScope_intentKey" in args.where : "id_companyId_providerScope" in args.where;
        if (matches && arrivals < 2) {
          if (kind === "distinct") assert.equal(result, null);
          arrivals++; if (stats) stats.arrivals = arrivals; if (arrivals === 2) release(); await barrier;
        }
        return result;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    return run(new Proxy(tx, { get: (target, key) => key === "openCreditCommercialOperation" ? delegate : Reflect.get(target, key) }));
  }, options).catch(error => {
    if (stats && error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2034") stats.p2034++;
      const target = error.meta?.target;
      if (error.code === "P2002" && (target === "OCOperation_company_scope_identity_kind_key"
        || Array.isArray(target) && target.length === 4 && ["companyId", "providerScope", "remoteIdentityId", "operationKind"].every(k => target.includes(k)))) stats.identityP2002++;
    }
    throw error;
  }) } as Db;
}
material("50 forced distinct commands converge to one intention with identity-kind constraint", async initial => {
  let identityP2002 = 0, p2034 = 0;
  for (let round = 1; round <= 50; round++) {
    const f = round === 1 ? initial : await fixture();
    process.env.PLATFORM_COMPANY_ID = f.platform; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
    const stats = { p2034: 0, identityP2002: 0, arrivals: 0 }, concurrent = barrierDb("distinct", stats);
    const inputs = [f.input, { ...f.input, intentKey: randomUUID() }]; assert.notEqual(inputs[0].intentKey, inputs[1].intentKey);
    const results = await Promise.allSettled(inputs.map(input => service.prepareOpenCreditClientProfileOperation(concurrent, input)));
    const winner = results.filter(r => r.status === "fulfilled"), loser = results.filter(r => r.status === "rejected");
    const loserCode = loser[0]?.reason instanceof service.OpenCreditCommercialOperationServiceError ? loser[0].reason.code : "OTHER";
    console.log("SINGLE_INTENT_ROUND", JSON.stringify({ round, ...stats, winners: winner.length, losers: loser.length, loserCode }));
    assert.equal(winner.length, 1); assert.equal(loser.length, 1); assert.equal(loserCode, "INTENT_CONFLICT");
    assert.equal(stats.arrivals, 2); assert.equal(await db.openCreditCommercialOperation.count({ where: f.where }), 1);
    await event(f, 1, "PREPARED", null, "PREPARED", 0); identityP2002 += stats.identityP2002; p2034 += stats.p2034;
  }
  console.log("SINGLE_INTENT_DIAGNOSTICS", JSON.stringify({ p2034, identityP2002 }));
});
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
  assert.equal(r.state, "IN_FLIGHT"); assert.equal(r.revision, 1); assert.deepEqual(Object.keys(r).sort(), ["operationId", "profile", "profileJson", "revision", "state", "dispatchAuthorization"].sort());
  assert.deepEqual(JSON.parse(r.profileJson), r.profile);
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
material("checkout migrations applied exactly; nullable legacy RESERVED_FOR_DISPATCH remains unbound", async f => {
  const directory = new URL("../../prisma/migrations/", import.meta.url);
  const expectedMigrationNames = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(new URL(entry.name + "/migration.sql", directory))
      && statSync(new URL(entry.name + "/migration.sql", directory)).isFile()).map(entry => entry.name).sort();
  const rows = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name
  `;
  const actualAppliedMigrationNames = rows.filter(row => row.finished_at !== null && row.rolled_back_at === null).map(row => row.migration_name).sort();
  console.log("MIGRATION_CHECK", JSON.stringify({ expected: expectedMigrationNames.length, applied: actualAppliedMigrationNames.length,
    missing: expectedMigrationNames.filter(name => !actualAppliedMigrationNames.includes(name)).length,
    extra: rows.filter(row => !expectedMigrationNames.includes(row.migration_name)).length,
    unfinished: rows.filter(row => row.finished_at === null).length, rolledBack: rows.filter(row => row.rolled_back_at !== null).length }));
  assert(rows.every(row => row.finished_at !== null && row.rolled_back_at === null), "MIGRATION_HISTORY_UNFINISHED_OR_ROLLED_BACK");
  assert.deepEqual(actualAppliedMigrationNames, expectedMigrationNames, "APPLIED_MIGRATION_NAMES_NOT_EXACT_CHECKOUT");
  const op = await service.prepareOpenCreditClientProfileOperation(db, f.input);
  assert.equal(await db.openCreditConsumerAuthorization.count({ where: { companyId: f.companyId } }), 0);
  // Synthetic representation of a pre-enforcement event using only historical columns.
  const legacy = await db.openCreditCommercialOperationEvent.create({ data: {
    operationId: op.operationId, companyId: f.companyId, providerScope: f.input.providerScope, actorUserId: f.actor.id,
    action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision: 1
  } });
  assert.equal(legacy.dispatchAuthorizationEventId, null);
  await f.attest();
  assert.deepEqual(await db.openCreditCommercialOperationEvent.findUnique({ where: { id: legacy.id } }), legacy);
});
material("missing authorization blocks reservation and releases no profile", async f => {
  const i = await prepared(f, false); const before = await f.current();
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, i), "CONSUMER_AUTHORIZATION_MISSING");
  assert.deepEqual(await f.current(), before); assert.equal((await f.events()).length, 1);
});
material("revoke before reserve blocks without CAS or RESERVED event", async f => {
  const i = await prepared(f); await authorizationService.revokeOpenCreditConsumerAuthorization(db, f.revokeInput);
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, i), "CONSUMER_AUTHORIZATION_INACTIVE");
  assert.equal((await f.current())!.state, "PREPARED"); assert.equal((await f.events()).length, 1);
});
material("reservation preserves exact current GRANTED binding and closed result", async f => {
  const i = await prepared(f);
  const authorization = await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: f.where });
  const granted = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { authorizationId_revision: { authorizationId: authorization.id, revision: 0 } } });
  const r = await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  assert.deepEqual(r.dispatchAuthorization, { authorizationId: authorization.id, authorizationRevision: 0, authorizationEventId: granted.id });
  assert.deepEqual(Object.keys(r.dispatchAuthorization).sort(), ["authorizationId", "authorizationRevision", "authorizationEventId"].sort());
  assert.equal((await f.events())[1].dispatchAuthorizationEventId, granted.id);
});
material("regrant revision2 is bound, never historical GRANTED revision0", async f => {
  const i = await prepared(f); const first = await db.openCreditConsumerAuthorizationEvent.findFirstOrThrow({ where: f.where });
  await authorizationService.revokeOpenCreditConsumerAuthorization(db, f.revokeInput); await f.attest();
  const a = await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: f.where });
  const current = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { authorizationId_revision: { authorizationId: a.id, revision: 2 } } });
  const r = await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  assert.equal(r.dispatchAuthorization.authorizationRevision, 2);
  assert.equal(r.dispatchAuthorization.authorizationEventId, current.id); assert.notEqual(current.id, first.id);
});
material("AuthorizationEvent revision unique rejects duplicate current audit fact", async f => {
  await f.attest();
  const original = await db.openCreditConsumerAuthorizationEvent.findFirstOrThrow({ where: f.where });
  const { id: _id, createdAt: _at, ...data } = original;
  await assert.rejects(db.openCreditConsumerAuthorizationEvent.create({ data }), e =>
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
    && (e.meta?.target === "OCConsumerAuthEvent_authorization_revision_key"
      || Array.isArray(e.meta?.target) && JSON.stringify(e.meta.target) === JSON.stringify(["authorizationId", "revision"])));
});
for (const foreign of ["company", "scope"]) material("dispatch FK rejects authorization event from other " + foreign, async f => {
  await f.attest();
  const granted = await db.openCreditConsumerAuthorizationEvent.findFirstOrThrow({ where: f.where });
  const companyId = foreign === "company" ? f.otherCompany : f.companyId;
  const providerScope = foreign === "scope" ? "synthetic-other-" + randomUUID().replace(/\d/g, "x") : f.input.providerScope;
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic", phone: "synthetic" } });
  await db.openCreditCommercialAccess.create({ data: { companyId, providerScope, enabled: true, changedByUserId: f.actor.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId, providerScope, contactId: contact.id, normalizedCpf: "11111111111", createdByUserId: f.actor.id } });
  const operation = await db.openCreditCommercialOperation.create({ data: { companyId, providerScope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT", intentKey: randomUUID(), createdByUserId: f.actor.id } });
  await assert.rejects(db.openCreditCommercialOperationEvent.create({ data: { operationId: operation.id, companyId, providerScope,
    actorUserId: f.actor.id, action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision: 1, dispatchAuthorizationEventId: granted.id } }),
    e => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003" && String(e.meta?.field_name).includes("OCOperationEvent_dispatch_auth_fkey"));
});
material("dispatch binding CHECK rejects non-reservation action, without requiring historical binding", async f => {
  const i = await prepared(f); const granted = await db.openCreditConsumerAuthorizationEvent.findFirstOrThrow({ where: f.where });
  await assert.rejects(db.openCreditCommercialOperationEvent.create({ data: { operationId: i.operationId, companyId: f.companyId,
    providerScope: f.input.providerScope, actorUserId: f.actor.id, action: "MARKED_UNKNOWN", previousState: "IN_FLIGHT", nextState: "UNKNOWN", revision: 2, dispatchAuthorizationEventId: granted.id } }));
  assert.equal((await f.events()).length, 1);
});
// Both transactions observe the same active authorization before either may mutate.
function reserveRevokeBarrier(): Db {
  let arrivals = 0; let release!: () => void; const barrier = new Promise<void>(r => { release = r; });
  return { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditConsumerAuthorization, { get(target, key) {
      if (key === "findUnique") return async (args: Parameters<typeof target.findUnique>[0]) => {
        const result = await target.findUnique(args);
        if (arrivals < 2) { arrivals++; if (arrivals === 2) release(); await barrier; }
        return result;
      };
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get: (target, key) => key === "openCreditConsumerAuthorization" ? delegate : Reflect.get(target, key) }));
  }, options) } as Db;
}
material("concurrent reserve vs revoke has only a coherent serial history", async f => {
  const i = await prepared(f); const client = reserveRevokeBarrier();
  const results = await Promise.allSettled([service.reserveOpenCreditClientProfileOperationForDispatch(client, i),
    authorizationService.revokeOpenCreditConsumerAuthorization(client, f.revokeInput)]);
  assert.equal(results[1].status, "fulfilled");
  const a = await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: f.where });
  assert.equal(a.active, false); assert.equal(a.revision, 1);
  const events = await f.events(); const reserved = events.filter(e => e.action === "RESERVED_FOR_DISPATCH");
  const result = results[0]; const op = (await f.current())!;
  if (result.status === "fulfilled") {
    assert.equal(op.state, "IN_FLIGHT"); assert.equal(op.revision, 1); assert.equal(reserved.length, 1);
    assert.equal(reserved[0].dispatchAuthorizationEventId, (result.value as Awaited<ReturnType<typeof service.reserveOpenCreditClientProfileOperationForDispatch>>).dispatchAuthorization.authorizationEventId);
  } else {
    assert.equal(result.reason.code, "CONSUMER_AUTHORIZATION_INACTIVE");
    assert.equal(op.state, "PREPARED"); assert.equal(op.revision, 0); assert.equal(reserved.length, 0);
  }
  assert.equal(new Set(events.map(e => e.revision)).size, events.length);
});
for (const terminal of ["SUCCEEDED", "UNKNOWN"] as const) material("revoke after commit-to-dispatch preserves history and permits " + terminal, async f => {
  const i = await prepared(f); const reservation = await service.reserveOpenCreditClientProfileOperationForDispatch(db, i);
  await authorizationService.revokeOpenCreditConsumerAuthorization(db, f.revokeInput);
  assert.equal((await f.current())!.state, "IN_FLIGHT");
  assert.equal((await f.events())[1].dispatchAuthorizationEventId, reservation.dispatchAuthorization.authorizationEventId);
  const next = { ...i, expectedRevision: 1 };
  const r = terminal === "SUCCEEDED" ? await service.applyOpenCreditCreateClientObservation(db, next, observation())
    : await service.markOpenCreditCommercialOperationUnknown(db, next);
  assert.equal(r.state, terminal); assert.equal((await f.events())[1].dispatchAuthorizationEventId, reservation.dispatchAuthorization.authorizationEventId);
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(db, { ...i, expectedRevision: 2 }), "OPERATION_STATE_CONFLICT");
  // A new command cannot create a second intention, regardless of terminal state or revocation.
  await denied(() => service.prepareOpenCreditClientProfileOperation(db, { ...f.input, intentKey: randomUUID() }), "INTENT_CONFLICT");
  assert.equal(await db.openCreditCommercialOperation.count({ where: f.where }), 1);
});
material("real dispatch binding FK failure rolls back IN_FLIGHT mutation and event", async f => {
  const i = await prepared(f); let observed = false; let realFk = false;
  const client = { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditCommercialOperationEvent, { get(target, key) {
      if (key === "create") return async (args: Prisma.OpenCreditCommercialOperationEventCreateArgs) => {
        assert.equal((await tx.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: i.operationId } })).state, "IN_FLIGHT"); observed = true;
        try { return await target.create({ ...args, data: { ...args.data as Prisma.OpenCreditCommercialOperationEventUncheckedCreateInput, dispatchAuthorizationEventId: "missing-synthetic-grant" } }); }
        catch (e) { realFk = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003" && String(e.meta?.field_name).includes("OCOperationEvent_dispatch_auth_fkey"); throw e; }
      };
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get: (target, key) => key === "openCreditCommercialOperationEvent" ? delegate : Reflect.get(target, key) }));
  }, options) } as Db;
  await denied(() => service.reserveOpenCreditClientProfileOperationForDispatch(client, i), "STORAGE_ERROR");
  assert.equal(observed, true); assert.equal(realFk, true);
  assert.equal((await f.current())!.state, "PREPARED"); assert.equal((await f.current())!.revision, 0);
  assert.equal((await f.events()).length, 1);
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
