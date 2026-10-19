import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Module from "node:module";
import { createHmac, randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { assertOpenCreditConsumerAuthorizationTestDatabase } from "./opencredit-consumer-authorization-postgres.guard";
import { persistInboundMessage } from "./meta-reply-ingestion";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import type { SessionUser } from "./auth";

assertOpenCreditConsumerAuthorizationTestDatabase(process.env);
if (process.env.OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_POSTGRES_TEST !== "1") throw new Error("CONTEXT_TEST_REQUIRES_DISPOSABLE_CI");
const db = new PrismaClient({ log: [] });
let context: typeof import("./opencredit-consumer-authorization-context.service");
let authorization: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (name, ...args) => name === "server-only" ? {} : original.call(loader, name, ...args);
  try { context = await import("./opencredit-consumer-authorization-context.service"); authorization = await import("./opencredit-consumer-authorization.service"); provenance = await import("./meta-inbound-provenance"); }
  finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
async function fixture() {
  const company = await db.company.create({ data: { name: "Synthetic context" } });
  const platform = await db.company.create({ data: { name: "Synthetic platform" } });
  const user = await db.user.create({ data: { companyId: platform.id, name: "Synthetic", email: randomUUID() + "@example.invalid", role: "ADMIN", passwordHash: "SYNTHETIC_ONLY" } });
  const actor: SessionUser = { id: user.id, companyId: platform.id, name: user.name, email: user.email, role: "ADMIN" };
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "5547999999999", normalizedPhone: classifyPhoneNormalization("5547999999999").normalizedPhone, cpf: "00000000000" } });
  const scope = ("synthetic-" + randomUUID().replace(/\d/g, d => String.fromCharCode(103 + Number(d)))) as Parameters<typeof context.getOpenCreditConsumerAuthorizationContext>[1]["providerScope"];
  await db.openCreditCommercialAccess.create({ data: { companyId: company.id, providerScope: scope, enabled: true, changedByUserId: user.id } });
  await db.openCreditRemoteIdentity.create({ data: { companyId: company.id, contactId: contact.id, providerScope: scope, normalizedCpf: "00000000000", enabled: true, createdByUserId: user.id } });
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic", provider: "meta", type: "whatsapp", status: "ACTIVE", appSecret: "synthetic-hmac", phoneNumberId: randomUUID() } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, status: "PENDING" } });
  async function inbound(verified = true, conversationId = conversation.id) {
    const providerMessageId = randomUUID(); let capability: Awaited<ReturnType<typeof provenance.authenticateMetaInboundBatch>>[number]["capability"] | undefined;
    let metadata: Awaited<ReturnType<typeof provenance.authenticateMetaInboundBatch>>[number]["input"]["replyMetadata"] | undefined;
    if (verified) {
      const rawBody = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: channel.phoneNumberId }, messages: [{ id: providerMessageId, from: contact.phone, type: "text", text: { body: "Synthetic arbitrary text" }, timestamp: "1792238400" }] } }] }] });
      const [item] = await provenance.authenticateMetaInboundBatch({ db, rawBody, signature: "sha256=" + createHmac("sha256", "synthetic-hmac").update(rawBody).digest("hex") }); capability = item.capability; metadata = item.input.replyMetadata;
    }
    const message = await persistInboundMessage(db, { conversationId, direction: "inbound", senderType: "customer", body: "Synthetic arbitrary text", type: "text", providerMessageId }, metadata ? {
      companyId: company.id, contactId: contact.id, channelId: channel.id, senderPhone: contact.phone, metadata,
    } : undefined, company.id, capability);
    return db.conversationInboundEvent.findUniqueOrThrow({ where: { messageId: message.id } });
  }
  const evidence = await inbound();
  const input = { actor, companyId: company.id, contactId: contact.id, conversationId: conversation.id, providerScope: scope };
  const grantInput = { actor, companyId: company.id, contactId: contact.id, providerScope: scope, inboundEventId: evidence.id };
  return { company, platform, contact, conversation, channel, evidence, input, grantInput, inbound };
}
type F = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: F) => Promise<void>) {
  test(name, async () => {
    const company = process.env.PLATFORM_COMPANY_ID, emails = process.env.PLATFORM_ADMIN_EMAILS;
    try { const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform.id; process.env.PLATFORM_ADMIN_EMAILS = f.input.actor.email; await run(f); }
    finally { if (company === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = company; if (emails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = emails; }
  });
}
const read = (f: F) => context.getOpenCreditConsumerAuthorizationContext(db, f.input);
material("real authenticated inbound mapping appears; no content is returned", async f => {
  const r = await read(f); assert.deepEqual(r.evidenceCandidates, [{ inboundEventId: f.evidence.id, messageId: f.evidence.messageId }]);
  assert.doesNotMatch(JSON.stringify(r), /Synthetic|"(?:body|providerMessageId|phone|cpf|providerScope|authorizationId)"\s*:/);
});
material("real unverified inbound is filtered", async f => { const event = await f.inbound(false); assert(!(await read(f)).evidenceCandidates.some(c => c.inboundEventId === event.id)); });
material("existing scope CHECK/trigger rejects event cross-company before FK", async f => {
  const other = await db.company.create({ data: { name: "Synthetic other" } });
  const message = await db.message.create({ data: { conversationId: f.conversation.id, direction: "inbound", senderType: "customer", body: "Synthetic", type: "text" } });
  await assert.rejects(db.conversationInboundEvent.create({ data: { companyId: other.id, contactId: f.contact.id, channelId: f.channel.id, conversationId: f.conversation.id, messageId: message.id, sequence: BigInt(9999) } }),
    e => e instanceof Prisma.PrismaClientUnknownRequestError && /code: "23514"/.test(e.message) && e.message.includes("INBOUND_EVENT_SCOPE_MISMATCH"));
});
material("read rejects conversation from other contact/company", async f => {
  const other = await db.company.create({ data: { name: "Synthetic other" } }); const contact = await db.contact.create({ data: { companyId: other.id, name: "Synthetic", phone: "synthetic" } });
  const conversation = await db.conversation.create({ data: { contactId: contact.id } });
  await assert.rejects(context.getOpenCreditConsumerAuthorizationContext(db, { ...f.input, conversationId: conversation.id }), e => e instanceof Error && e.message === "OPENCREDIT_CONSUMER_AUTHORIZATION_CONTEXT_CONVERSATION_NOT_FOUND");
});
material("active authorization returns current evidence mapping", async f => {
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.grantInput); const r = await read(f);
  assert.deepEqual(r.authorization, { exists: true, active: true, revision: 0, evidenceInboundEventId: f.evidence.id, evidenceMessageId: f.evidence.messageId });
});
material("revoked authorization remains visible even after archived contact", async f => {
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.grantInput);
  await authorization.revokeOpenCreditConsumerAuthorization(db, { actor: f.input.actor, companyId: f.input.companyId, contactId: f.input.contactId, providerScope: f.input.providerScope });
  await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } }); const r = await read(f); assert(r.authorization.exists); assert.equal(r.authorization.active, false); assert.equal(r.authorization.revision, 1);
});
material("old current evidence resolved outside 100 recent, max50 newest candidates", async f => {
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.grantInput);
  for (let i = 0; i < 101; i++) await f.inbound();
  const r = await read(f); assert.equal(r.evidenceCandidates.length, 50); assert(!r.evidenceCandidates.some(c => c.inboundEventId === f.evidence.id)); assert.equal(r.authorization.evidenceMessageId, f.evidence.messageId);
  const expected = await db.conversationInboundEvent.findMany({ where: { conversationId: f.conversation.id }, orderBy: { sequence: "desc" }, take: 50 }); assert.deepEqual(r.evidenceCandidates.map(c => c.inboundEventId), expected.map(e => e.id));
});
material("read preserves Authorization/Event/CommercialOperation state exactly", async f => {
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.grantInput);
  const identity = await db.openCreditRemoteIdentity.findUniqueOrThrow({ where: { companyId_providerScope_contactId: { companyId: f.company.id, providerScope: f.input.providerScope, contactId: f.contact.id } } });
  const operation = await db.openCreditCommercialOperation.create({ data: { companyId: f.company.id, providerScope: f.input.providerScope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT", intentKey: "synthetic-" + randomUUID(), createdByUserId: f.input.actor.id } });
  await db.openCreditCommercialOperationEvent.create({ data: { operationId: operation.id, companyId: f.company.id, providerScope: f.input.providerScope, actorUserId: f.input.actor.id, action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 } });
  const snapshot = async () => ({ a: await db.openCreditConsumerAuthorization.findMany({ where: { companyId: f.company.id } }), e: await db.openCreditConsumerAuthorizationEvent.findMany({ where: { companyId: f.company.id } }),
    o: await db.openCreditCommercialOperation.findMany({ where: { companyId: f.company.id } }), oe: await db.openCreditCommercialOperationEvent.findMany({ where: { companyId: f.company.id } }) });
  const before = await snapshot(); await read(f); await read(f); assert.deepEqual(await snapshot(), before);
});
material("current evidence from another valid conversation has no invented messageId", async f => {
  await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.grantInput); const otherConversation = await db.conversation.create({ data: { contactId: f.contact.id } });
  const r = await context.getOpenCreditConsumerAuthorizationContext(db, { ...f.input, conversationId: otherConversation.id }); assert.equal(r.authorization.evidenceInboundEventId, f.evidence.id); assert.equal(r.authorization.evidenceMessageId, null); assert.deepEqual(r.evidenceCandidates, []);
});
