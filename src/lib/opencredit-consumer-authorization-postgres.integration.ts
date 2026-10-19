import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import Module from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditConsumerAuthorizationGrantInput, OpenCreditConsumerAuthorizationCode } from "./opencredit-consumer-authorization.service";
import { assertOpenCreditConsumerAuthorizationTestDatabase } from "./opencredit-consumer-authorization-postgres.guard";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditConsumerAuthorizationTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    service = await import("./opencredit-consumer-authorization.service");
    provenance = await import("./meta-inbound-provenance");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
type Db = Parameters<typeof service.grantOpenCreditConsumerAuthorizationFromInboundEvidence>[0];
type Options = { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number };
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic authorization" } });
  const other = await db.company.create({ data: { name: "Synthetic other" } });
  const platform = await db.company.create({ data: { name: "Synthetic platform" } });
  const user = await db.user.create({ data: { companyId: platform.id, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "NOT_A_REAL_HASH", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: platform.id, role: "ADMIN", email: user.email, name: user.name };
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5547999999999", normalizedPhone: classifyPhoneNormalization("5547999999999").normalizedPhone, cpf: "00000000000" } });
  const otherContact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic alternative", phone: "5547888888888", cpf: null } });
  const scope = ("synthetic-" + randomUUID().replace(/\d/g, d => String.fromCharCode(103 + Number(d)))) as OpenCreditConsumerAuthorizationGrantInput["providerScope"];
  const access = await db.openCreditCommercialAccess.create({ data: { companyId: company.id, providerScope: scope, enabled: true, changedByUserId: user.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: company.id, contactId: contact.id, providerScope: scope, normalizedCpf: "00000000000", enabled: true, createdByUserId: user.id } });
  const secret = "synthetic-authorization-hmac-secret";
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: secret, phoneNumberId: randomUUID() } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
  async function authenticatedEvidence() {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId },
      messages: [{ id: randomUUID(), from: contact.phone, type: "text", text: { body: "Synthetic human-reviewed text" }, timestamp: "1792238400" }]
    } }] }] });
    const [item] = await provenance.authenticateMetaInboundBatch({ db, rawBody: raw, signature: "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") });
    const message = await persistInboundMessage(db, { conversationId: conversation.id, direction: "inbound", senderType: "customer",
      body: item.input.body.trim(), type: "text", providerMessageId: item.input.providerMessageId }, {
      companyId: company.id, contactId: contact.id, channelId: channel.id, senderPhone: item.input.phone, metadata: item.input.replyMetadata
    }, company.id, item.capability);
    return db.conversationInboundEvent.findUniqueOrThrow({ where: { messageId: message.id } });
  }
  const evidence = await authenticatedEvidence();
  const input: OpenCreditConsumerAuthorizationGrantInput = { actor, companyId: company.id, contactId: contact.id, providerScope: scope, inboundEventId: evidence.id };
  const revokeInput = { actor, companyId: company.id, contactId: contact.id, providerScope: scope };
  const where = { companyId: company.id, providerScope: scope };
  return { company, other, platform, actor, contact, otherContact, identity, access, channel, conversation, evidence, input, revokeInput,
    authenticatedEvidence, current: () => db.openCreditConsumerAuthorization.findFirst({ where }),
    events: () => db.openCreditConsumerAuthorizationEvent.findMany({ where, orderBy: [{ revision: "asc" }, { id: "asc" }] }) };
}
type F = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: F) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID; const emails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform.id; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      await run(f);
    } catch (e) {
      const code = e instanceof service.OpenCreditConsumerAuthorizationServiceError ? e.code
        : e instanceof Prisma.PrismaClientKnownRequestError ? e.code
        : e instanceof Error && /^MATERIAL_PROBE_[A-Z0-9_]+$/.test(e.message) ? e.message : "ASSERTION_OR_OTHER";
      throw new Error("CONSUMER_AUTHORIZATION_MATERIAL_FAILED:" + code);
    } finally {
      if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company;
      if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails;
    }
    // Append-only synthetic fixtures are removed by destroying the disposable DB.
  });
}
const grant = (f: F, client: Db = db, inboundEventId = f.evidence.id) => service.grantOpenCreditConsumerAuthorizationFromInboundEvidence(client, { ...f.input, inboundEventId });
const revoke = (f: F, client: Db = db) => service.revokeOpenCreditConsumerAuthorization(client, f.revokeInput);
async function denied(run: () => Promise<unknown>, code: OpenCreditConsumerAuthorizationCode) {
  await assert.rejects(run, e => e instanceof service.OpenCreditConsumerAuthorizationServiceError && e.code === code && !("cause" in e));
}
async function prismaRejected(run: () => Promise<unknown>, code: string) {
  await assert.rejects(run, e => e instanceof Prisma.PrismaClientKnownRequestError && e.code === code);
}
function authData(f: F) {
  return { companyId: f.company.id, contactId: f.contact.id, remoteIdentityId: f.identity.id, providerScope: f.input.providerScope,
    purpose: "CLIENT_PROFILE_UPSERT", evidenceInboundEventId: f.evidence.id, active: true, revision: 0, changedByUserId: f.actor.id };
}
material("migration chain applied on empty PostgreSQL; no historical backfill/automatic grant", async f => {
  const migrations = await db.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name = '20261019150000_add_opencredit_consumer_authorization_evidence'`;
  assert.equal(migrations.length, 1); assert.ok(migrations[0].finished_at);
  assert.equal(await f.current(), null); assert.deepEqual(await f.events(), []);
  const tables = await db.$queryRaw<{ table_name: string }[]>`SELECT table_name FROM information_schema.tables WHERE table_name IN ('OpenCreditConsumerAuthorization','OpenCreditConsumerAuthorizationEvent')`;
  assert.equal(tables.length, 2);
});
material("real HMAC inbound grant persists rev0 and one GRANTED without PII", async f => {
  const r = await grant(f); const a = (await f.current())!; const [e] = await f.events();
  assert.deepEqual(r, { changed: true, authorizationId: a.id, active: true, revision: 0 });
  assert.equal(a.evidenceInboundEventId, f.evidence.id); assert.equal(e.action, "GRANTED"); assert.equal(e.previousActive, null);
  assert.equal(e.nextActive, true); assert.equal(e.revision, 0); assert.equal(e.actorUserId, f.actor.id);
  assert.deepEqual(Object.keys(a).sort(), ["id", "companyId", "contactId", "remoteIdentityId", "providerScope", "purpose", "evidenceInboundEventId", "active", "revision", "changedByUserId", "createdAt", "updatedAt"].sort());
  assert.deepEqual(Object.keys(e).sort(), ["id", "authorizationId", "companyId", "providerScope", "actorUserId", "action", "previousActive", "nextActive", "revision", "evidenceInboundEventId", "createdAt"].sort());
});
material("real revoke and regrant preserve transition evidence history", async f => {
  await grant(f); assert.equal((await revoke(f)).revision, 1); const next = await f.authenticatedEvidence();
  assert.equal((await grant(f, db, next.id)).revision, 2);
  const events = await f.events();
  assert.deepEqual(events.map(e => [e.action, e.previousActive, e.nextActive, e.revision, e.evidenceInboundEventId]),
    [["GRANTED", null, true, 0, f.evidence.id], ["REVOKED", true, false, 1, f.evidence.id], ["GRANTED", false, true, 2, next.id]]);
});
material("active same evidence preserves timestamp and event count", async f => {
  await grant(f); const before = await f.current(); assert.equal((await grant(f)).changed, false);
  assert.deepEqual(await f.current(), before); assert.equal((await f.events()).length, 1);
});
material("active different evidence is conflict", async f => {
  await grant(f); const next = await f.authenticatedEvidence();
  await denied(() => grant(f, db, next.id), "AUTHORIZATION_CONFLICT"); assert.equal((await f.events()).length, 1);
});
material("repeated revoke and absent revoke are no-op", async f => {
  assert.deepEqual(await revoke(f), { changed: false, authorizationId: null, active: false, revision: null });
  await grant(f); await revoke(f); const before = await f.current();
  assert.equal((await revoke(f)).changed, false); assert.deepEqual(await f.current(), before); assert.equal((await f.events()).length, 2);
});
material("composite evidence FK rejects other contact even with matching identity", async f => {
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: f.company.id, contactId: f.otherContact.id, providerScope: f.input.providerScope, normalizedCpf: "11111111111", enabled: true, createdByUserId: f.actor.id } });
  await prismaRejected(() => db.openCreditConsumerAuthorization.create({ data: { ...authData(f), contactId: f.otherContact.id, remoteIdentityId: identity.id } }), "P2003");
  assert.equal(await f.current(), null);
});
material("composite evidence FK rejects other company with otherwise coherent contact/identity", async f => {
  const contact = await db.contact.create({ data: { companyId: f.other.id, name: "Synthetic", phone: "synthetic" } });
  await db.openCreditCommercialAccess.create({ data: { companyId: f.other.id, providerScope: f.input.providerScope, enabled: true, changedByUserId: f.actor.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId: f.other.id, contactId: contact.id, providerScope: f.input.providerScope, normalizedCpf: "11111111111", enabled: true, createdByUserId: f.actor.id } });
  await prismaRejected(() => db.openCreditConsumerAuthorization.create({ data: { ...authData(f), companyId: f.other.id, contactId: contact.id, remoteIdentityId: identity.id } }), "P2003");
});
material("identity FK rejects another provider scope", async f => {
  await prismaRejected(() => db.openCreditConsumerAuthorization.create({ data: { ...authData(f), providerScope: "different" } }), "P2003");
});
for (const data of [{ purpose: "OTHER" }, { revision: -1 }]) material("authorization CHECK " + Object.keys(data)[0], async f => {
  await assert.rejects(db.openCreditConsumerAuthorization.create({ data: { ...authData(f), ...data } })); assert.equal(await f.current(), null);
});
for (const data of [{ action: "OTHER" }, { revision: -1 }, { action: "GRANTED", nextActive: false }, { action: "REVOKED", previousActive: null }, { action: "REVOKED", previousActive: false }, { action: "REVOKED", previousActive: true, nextActive: true }]) {
  material("event CHECK " + JSON.stringify(data), async f => {
    const a = await grant(f);
    await assert.rejects(db.openCreditConsumerAuthorizationEvent.create({ data: { authorizationId: a.authorizationId!, companyId: f.company.id,
      providerScope: f.input.providerScope, actorUserId: f.actor.id, action: "GRANTED", previousActive: null, nextActive: true, revision: 1, evidenceInboundEventId: f.evidence.id, ...data } }));
    assert.equal((await f.events()).length, 1);
  });
}
material("authorization composite unique is real", async f => {
  await grant(f); await prismaRejected(() => db.openCreditConsumerAuthorization.create({ data: authData(f) }), "P2002");
});
// Test-only barrier: both transactions read the same committed authorization before writes.
function barrierDb(): Db {
  let arrived = 0; let release!: () => void; const barrier = new Promise<void>(r => { release = r; });
  return { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, opts?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditConsumerAuthorization, { get(target, key) {
      if (key === "findUnique") return async (...args: Parameters<typeof target.findUnique>) => {
        const result = await target.findUnique(...args);
        if (arrived < 2) { arrived++; if (arrived === 2) release(); await barrier; }
        return result;
      };
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get(target, key) { return key === "openCreditConsumerAuthorization" ? delegate : Reflect.get(target, key); } }));
  }, opts) } as Db;
}
material("concurrent first grants converge one authorization/event", async f => {
  const client = barrierDb(); const results = await Promise.all([grant(f, client), grant(f, client)]);
  assert.deepEqual(results.map(r => r.changed).sort(), [false, true]);
  assert.equal(await db.openCreditConsumerAuthorization.count({ where: { companyId: f.company.id } }), 1); assert.equal((await f.events()).length, 1);
});
material("concurrent different-evidence first grants cannot replace winner", async f => {
  const next = await f.authenticatedEvidence(); const client = barrierDb();
  const results = await Promise.allSettled([grant(f, client), grant(f, client, next.id)]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const rejection = results.find(r => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejection.reason.code, "AUTHORIZATION_CONFLICT"); assert.equal((await f.events()).length, 1);
});
material("concurrent regrant vs revoke produces coherent revisions without duplicated events", async f => {
  await grant(f); await revoke(f); const client = barrierDb();
  await Promise.all([grant(f, client), revoke(f, client)]);
  const events = await f.events(); const a = (await f.current())!;
  assert.equal(new Set(events.map(e => e.revision)).size, events.length);
  assert.equal(events.at(-1)!.nextActive, a.active); assert.equal(events.at(-1)!.revision, a.revision);
  assert.ok(a.revision === 2 || a.revision === 3);
});
// A test-only transaction proxy causes a REAL Event->User FK violation, no production failpoint.
function eventFkFailureDb(): Db {
  return { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, opts?: Options) => db.$transaction(tx => {
    const delegate = new Proxy(tx.openCreditConsumerAuthorizationEvent, { get(target, key) {
      if (key === "create") return (args: Prisma.OpenCreditConsumerAuthorizationEventCreateArgs) =>
        target.create({ ...args, data: { ...args.data, actorUserId: "missing-synthetic-user" } } as Prisma.OpenCreditConsumerAuthorizationEventCreateArgs);
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get(target, key) { return key === "openCreditConsumerAuthorizationEvent" ? delegate : Reflect.get(target, key); } }));
  }, opts) } as Db;
}
for (const phase of ["grant", "revoke", "regrant"]) material("real FK failure rolls back " + phase + " state and event", async f => {
  if (phase !== "grant") await grant(f);
  if (phase === "regrant") await revoke(f);
  const before = await f.current(); const events = await f.events(); const client = eventFkFailureDb();
  await denied(() => phase === "revoke" ? revoke(f, client) : grant(f, client), "STORAGE_ERROR");
  assert.deepEqual(await f.current(), before); assert.deepEqual(await f.events(), events);
});
material("verified evidence/content immutable and deletion restricted after grant", async f => {
  await grant(f);
  async function blocked(name: string, run: () => Promise<unknown>, sqlState?: string) {
    try { await run(); } catch (e) {
      if (!sqlState) return;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.meta?.code === sqlState) return;
      const state = e instanceof Prisma.PrismaClientKnownRequestError && typeof e.meta?.code === "string" && /^[A-Z0-9]{5}$/.test(e.meta.code) ? e.meta.code : "UNKNOWN";
      throw new Error("MATERIAL_PROBE_" + name + "_" + (e instanceof Prisma.PrismaClientKnownRequestError ? e.code : "OTHER") + "_" + state);
    }
    throw new Error("MATERIAL_PROBE_" + name + "_NOT_REJECTED");
  }
  await blocked("BODY", () => db.message.update({ where: { id: f.evidence.messageId }, data: { body: "attempted change" } }));
  await blocked("PROVENANCE", () => db.conversationInboundEvent.update({ where: { id: f.evidence.id }, data: { provenanceKind: null, provenanceVersion: null } }));
  await blocked("DELETE", () => db.$executeRaw`DELETE FROM "ConversationInboundEvent" WHERE id = ${f.evidence.id}`, "23001");
  assert.equal((await f.current())!.evidenceInboundEventId, f.evidence.id);
});
for (const change of ["archived", "cpf", "access", "identity", "ambiguous"]) material("revoke independent of current " + change, async f => {
  await grant(f);
  if (change === "archived") await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } });
  if (change === "cpf") await db.contact.update({ where: { id: f.contact.id }, data: { cpf: "99999999999" } });
  if (change === "access") await db.openCreditCommercialAccess.update({ where: { id: f.access.id }, data: { enabled: false } });
  if (change === "identity") await db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { enabled: false } });
  if (change === "ambiguous") await db.contact.update({ where: { id: f.otherContact.id }, data: { cpf: "000.000.000-00", archivedAt: new Date() } });
  assert.equal((await revoke(f)).active, false);
  await denied(() => grant(f), ({ archived: "CONTACT_ARCHIVED", cpf: "IDENTITY_SNAPSHOT_MISMATCH", access: "COMMERCIAL_ACCESS_DISABLED", identity: "IDENTITY_DISABLED", ambiguous: "CONTACT_AMBIGUOUS" } as const)[change as "archived"]);
});
