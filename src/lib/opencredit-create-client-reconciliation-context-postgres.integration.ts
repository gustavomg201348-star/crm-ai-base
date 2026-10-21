import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";
import { persistInboundMessage } from "./meta-reply-ingestion";
assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
if (process.env.OPENCREDIT_CREATE_CLIENT_RECONCILIATION_POSTGRES_TEST !== "1") throw Error("RECONCILIATION_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
let authorization: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
let resolver: typeof import("./opencredit-provider-scope-resolver");
let context: typeof import("./opencredit-create-client-reconciliation-context.service");
const originalFetch = globalThis.fetch; let httpCalls = 0;
before(async () => {
  globalThis.fetch = async () => { httpCalls++; throw Error("ALL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try {
    service = await import("./opencredit-commercial-operation.service"); authorization = await import("./opencredit-consumer-authorization.service");
    provenance = await import("./meta-inbound-provenance"); resolver = await import("./opencredit-provider-scope-resolver");
    context = await import("./opencredit-create-client-reconciliation-context.service");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); assert.equal(httpCalls, 0); });
async function fixture() {
  const companyId = "admin-dispatch-" + randomUUID(), platform = "platform-" + randomUUID();
  await db.company.createMany({ data: [companyId, platform].map(id => ({ id, name: "Synthetic command material" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "SYNTHETIC", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: platform, name: user.name, email: user.email, role: "ADMIN" };
  process.env.PLATFORM_COMPANY_ID = platform; process.env.PLATFORM_ADMIN_EMAILS = user.email;
  process.env.OPENCREDIT_TENANT_ID = "Synthetic-" + randomUUID(); process.env.OPENCREDIT_PARTNER_ID = "Synthetic-partner";
  const { providerScope } = resolver.resolveConfiguredOpenCreditProviderContext();
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic", phone: "11900000000", cpf: "00000000000" } });
  await db.openCreditCommercialAccess.create({ data: { companyId, providerScope, enabled: true, changedByUserId: actor.id } });
  const identity = await db.openCreditRemoteIdentity.create({ data: { companyId, providerScope, contactId: contact.id, normalizedCpf: "00000000000", enabled: true, createdByUserId: actor.id } });
  const secret = "synthetic-hmac";
  const channel = await db.channel.create({ data: { companyId, name: "Synthetic", provider: "meta", type: "whatsapp", status: "ACTIVE", phoneNumberId: randomUUID(), appSecret: secret } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId }, messages: [{ id: randomUUID(), from: contact.phone, type: "text", text: { body: "Synthetic human-reviewed evidence" }, timestamp: "1792238400" }] } }] }] });
  const [item] = await provenance.authenticateMetaInboundBatch({ db, rawBody: raw, signature: "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") });
  const message = await persistInboundMessage(db, { conversationId: conversation.id, direction: "inbound", senderType: "customer", body: item.input.body.trim(), type: "text", providerMessageId: item.input.providerMessageId },
    { companyId, contactId: contact.id, channelId: channel.id, senderPhone: item.input.phone, metadata: item.input.replyMetadata }, companyId, item.capability);
  const inbound = await db.conversationInboundEvent.findUniqueOrThrow({ where: { messageId: message.id } });
  const authInput = { actor, companyId, contactId: contact.id, providerScope };
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, { ...authInput, inboundEventId: inbound.id });
  const prepared = await service.prepareOpenCreditClientProfileOperation(db, { ...authInput, intentKey: randomUUID() });
  const transition = { actor, companyId, providerScope, operationId: prepared.operationId, expectedRevision: 0 };
  return { authInput, prepared, transition, identity, contact };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS", "OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"], old = keys.map(k => process.env[k]);
    try { await run(await fixture()); assert.equal(httpCalls, 0); }
    finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
  });
}
async function snapshot(f: Fixture) {
  const where = { companyId: f.authInput.companyId }, orderBy = { id: "asc" as const };
  // Material snapshot queries are intentionally sequential to avoid introducing unrelated
  // connection-pool/network concurrency into a read-only assertion harness.
  return [
    await db.company.findUnique({ where: { id: f.authInput.companyId } }), await db.contact.findMany({ where, orderBy }),
    await db.openCreditCommercialAccess.findMany({ where, orderBy }), await db.openCreditRemoteIdentity.findMany({ where, orderBy }),
    await db.openCreditRemoteIdentityEvent.findMany({ where, orderBy }), await db.openCreditCommercialOperation.findMany({ where, orderBy }),
    await db.openCreditCommercialOperationEvent.findMany({ where, orderBy }), await db.openCreditConsumerAuthorization.findMany({ where, orderBy }),
    await db.openCreditConsumerAuthorizationEvent.findMany({ where, orderBy }),
  ];
}
async function read(f: Fixture, changes: Partial<Fixture["authInput"]> = {}) {
  const before = await snapshot(f);
  try { return await context.getOpenCreditCreateClientReconciliationContext(db, { ...f.authInput, ...changes }); }
  finally { assert.deepEqual(await snapshot(f), before); assert.equal(httpCalls, 0); }
}
const reserve = (f: Fixture) => service.reserveOpenCreditClientProfileOperationForDispatch(db, f.transition);
const ledger = (f: Fixture) => db.openCreditCommercialOperationEvent.findMany({ where: { operationId: f.prepared.operationId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
material("PREPARED has no review and no writes", async f => assert.deepEqual(await read(f), { ok: true, review: null }));
material("real local reservation yields IN_FLIGHT with validated timeline, binding, zero writes/HTTP", async f => {
  await reserve(f); const result = await read(f), events = await ledger(f);
  assert.deepEqual(result, { ok: true, review: { operationId: f.prepared.operationId, state: "IN_FLIGHT", revision: 1,
    reason: "DISPATCH_COMMITTED_RESULT_UNCONFIRMED", preparedAt: events[0].createdAt.toISOString(), dispatchCommittedAt: events[1].createdAt.toISOString(),
    settledAt: null, dispatchAuthorizationBound: true } });
});
material("local ambiguous observation yields UNKNOWN with exact timeline and zero read writes/HTTP", async f => {
  await reserve(f);
  await service.applyOpenCreditCreateClientObservation(db, { ...f.transition, expectedRevision: 1 }, { kind: "NO_RESPONSE", reason: "NETWORK" });
  const result = await read(f), events = await ledger(f);
  assert.deepEqual(result, { ok: true, review: { operationId: f.prepared.operationId, state: "UNKNOWN", revision: 2,
    reason: "REMOTE_RESULT_AMBIGUOUS", preparedAt: events[0].createdAt.toISOString(), dispatchCommittedAt: events[1].createdAt.toISOString(),
    settledAt: events[2].createdAt.toISOString(), dispatchAuthorizationBound: true } });
});
for (const stale of ["revoked", "archived", "identity-disabled", "access-disabled"]) material("historical review survives " + stale, async f => {
  await reserve(f);
  if (stale === "revoked") await authorization.revokeOpenCreditConsumerAuthorization(db, f.authInput);
  if (stale === "archived") await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } });
  if (stale === "identity-disabled") await db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { enabled: false } });
  if (stale === "access-disabled") await db.openCreditCommercialAccess.updateMany({ where: { companyId: f.authInput.companyId }, data: { enabled: false } });
  assert.equal((await read(f)).review?.state, "IN_FLIGHT");
});
for (const corrupt of ["action", "binding", "extra", "revision", "chronology"]) material("real corrupt persisted ledger fails closed without repair: " + corrupt, async f => {
  await reserve(f); const events = await ledger(f), reserved = events[1];
  if (corrupt === "action") await db.openCreditCommercialOperationEvent.update({ where: { id: reserved.id }, data: { action: "SYNTHETIC_INVALID", dispatchAuthorizationEventId: null } });
  if (corrupt === "binding") await db.openCreditCommercialOperationEvent.update({ where: { id: reserved.id }, data: { dispatchAuthorizationEventId: null } });
  if (corrupt === "revision") await db.openCreditCommercialOperation.update({ where: { id: f.prepared.operationId }, data: { revision: 7 } });
  if (corrupt === "chronology") await db.openCreditCommercialOperationEvent.update({ where: { id: reserved.id }, data: { createdAt: new Date(events[0].createdAt.getTime() - 1000) } });
  if (corrupt === "extra") await db.openCreditCommercialOperationEvent.create({ data: { companyId: f.authInput.companyId, providerScope: f.authInput.providerScope,
    operationId: f.prepared.operationId, actorUserId: f.authInput.actor.id, action: "SYNTHETIC_EXTRA", previousState: "IN_FLIGHT", nextState: "IN_FLIGHT", revision: 2 } });
  await assert.rejects(read(f), { code: "CORRUPT_LEDGER" });
});
material("another providerScope sees no operation", async f => {
  await reserve(f); assert.deepEqual(await read(f, { providerScope: "synthetic-other-scope" as typeof f.authInput.providerScope }), { ok: true, review: null });
});
material("cross-company Contact is rejected", async f => {
  const company = await db.company.create({ data: { name: "Synthetic other" } });
  await assert.rejects(read(f, { companyId: company.id }), { code: "CONTACT_NOT_FOUND" });
});
material("no identity means no review", async f => {
  const contact = await db.contact.create({ data: { companyId: f.authInput.companyId, name: "Synthetic no identity", phone: "synthetic" } });
  assert.deepEqual(await read(f, { contactId: contact.id }), { ok: true, review: null });
});
