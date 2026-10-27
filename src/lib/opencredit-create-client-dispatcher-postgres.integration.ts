import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
if (process.env.OPENCREDIT_CREATE_CLIENT_DISPATCHER_POSTGRES_TEST !== "1") throw Error("DISPATCHER_MATERIAL_REQUIRES_EXPLICIT_OPT_IN");
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
let authorization: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
let dispatcher: typeof import("./opencredit-create-client-dispatcher");
let api: typeof import("./opencredit-api-client");
let resolver: typeof import("./opencredit-provider-scope-resolver");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("LIVE_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }; const original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try {
    service = await import("./opencredit-commercial-operation.service"); authorization = await import("./opencredit-consumer-authorization.service");
    provenance = await import("./meta-inbound-provenance"); dispatcher = await import("./opencredit-create-client-dispatcher");
    api = await import("./opencredit-api-client"); resolver = await import("./opencredit-provider-scope-resolver");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
type Db = Parameters<typeof dispatcher.dispatchOpenCreditCreateClient>[0];
async function fixture() {
  const companyId = "dispatch-" + randomUUID(), platform = "platform-" + randomUUID();
  await db.company.createMany({ data: [companyId, platform].map(id => ({ id, name: "Synthetic dispatcher material" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "SYNTHETIC", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: platform, name: user.name, email: user.email, role: "ADMIN" };
  process.env.PLATFORM_COMPANY_ID = platform; process.env.PLATFORM_ADMIN_EMAILS = user.email;
  process.env.OPENCREDIT_TENANT_ID = "Synthetic-" + randomUUID(); process.env.OPENCREDIT_PARTNER_ID = "Synthetic-partner";
  const { tenantId, providerScope } = resolver.resolveConfiguredOpenCreditProviderContext();
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic", phone: "11900000000", cpf: "00000000000" } });
  const access = await db.openCreditCommercialAccess.create({ data: { companyId, providerScope, enabled: true, changedByUserId: actor.id } });
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
  const grant = await authorization.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, { ...authInput, inboundEventId: inbound.id });
  assert(grant.authorizationId);
  const authorizationId = grant.authorizationId;
  const prepared = await service.prepareOpenCreditClientProfileOperation(db, { actor, companyId, contactId: contact.id, providerScope, intentKey: randomUUID() });
  const command = { actor, companyId, operationId: prepared.operationId, expectedRevision: prepared.revision };
  const current = () => db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: prepared.operationId } });
  const events = () => db.openCreditCommercialOperationEvent.findMany({ where: { operationId: prepared.operationId }, orderBy: { revision: "asc" } });
  const protectedRows = async () => Promise.all([
    db.contact.findUniqueOrThrow({ where: { id: contact.id } }), db.openCreditRemoteIdentity.findUniqueOrThrow({ where: { id: identity.id } }),
    db.openCreditCommercialAccess.findUniqueOrThrow({ where: { id: access.id } }), db.openCreditConsumerAuthorization.findUniqueOrThrow({ where: { id: authorizationId } })
  ]);
  let posts = 0;
  const client = (reply: () => Response | Promise<Response>, authFailure = false, phonePolicy: "include" | "omit" = "include") => api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic" }), fetch: (async (url, init) => {
    if (String(url).endsWith("/api/auth/login")) {
      assert.equal((await current()).state, "PREPARED");
      return authFailure ? new Response(null, { status: 401 }) : Response.json({ data: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 28800 } });
    }
    assert.equal(String(url), `https://core.api.opencredit.tech/api/tenants/${tenantId}/integration/clients`);
    assert.equal(init?.method, "POST"); assert.equal((await current()).state, "IN_FLIGHT");
    assert.equal((await events()).filter(e => e.action === "RESERVED_FOR_DISPATCH").length, 1);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.cpf, "00000000000");
    assert.equal(Object.hasOwn(payload, "celular"), phonePolicy !== "omit");
    if (phonePolicy === "include") assert.equal(payload.celular, contact.phone);
    posts++; return reply();
  }) as typeof fetch });
  return { command, authInput, authorizationId, current, events, protectedRows, client, posts: () => posts };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS", "OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"]; const old = keys.map(k => process.env[k]);
    try { await run(await fixture()); }
    finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
    // Immutable audit fixtures are destroyed only with the disposable container.
  });
}
material("explicit OMIT reaches fake transport after real PostgreSQL reservation and preserves Contact", async f => {
  const before = await f.protectedRows();
  const client = f.client(() => Response.json({ data: { success: true, created: true } }, { status: 201 }), false, "omit");
  try {
    const result = await dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client, phonePolicy: "omit" });
    assert.equal(result.state, "SUCCEEDED"); assert.equal(f.posts(), 1);
    assert.deepEqual(await f.protectedRows(), before);
    assert.deepEqual((await f.events()).map(e => e.action), ["PREPARED", "RESERVED_FOR_DISPATCH", "MARKED_SUCCEEDED_CREATED"]);
  } finally { client.dispose(); }
});
for (const created of [true, false]) material("real commit precedes one fake POST then SUCCEEDED " + created, async f => {
  const before = await f.protectedRows(); const client = f.client(() => Response.json({ data: { success: true, created } }, { status: 201 }));
  try {
    const result = await dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client });
    assert.deepEqual(result, { operationId: f.command.operationId, state: "SUCCEEDED", revision: 2, created });
    assert.equal(f.posts(), 1); assert.deepEqual(await f.protectedRows(), before);
    const events = await f.events(); assert.equal(events.length, 3);
    assert.equal(events[1].action, "RESERVED_FOR_DISPATCH");
    const grant = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { authorizationId_revision: { authorizationId: f.authorizationId, revision: 0 } } });
    assert.equal(events[1].dispatchAuthorizationEventId, grant.id);
    assert.equal(events[2].action, created ? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED");
  } finally { client.dispose(); }
});
for (const mode of ["ambiguous", "network"] as const) material("post-commit " + mode + " becomes UNKNOWN, never FAILED", async f => {
  const client = f.client(() => { if (mode === "network") throw Error("synthetic transport fault"); return Response.json({ data: { success: false, created: false } }, { status: 201 }); });
  try {
    assert.equal((await dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client })).state, "UNKNOWN");
    assert.equal(f.posts(), 1); const events = await f.events(); assert.equal(events.length, 3); assert.equal(events[2].action, "MARKED_UNKNOWN");
    assert(!events.some(e => e.nextState === "FAILED"));
  } finally { client.dispose(); }
});
material("pre-dispatch auth failure preserves PREPARED and zero reservation", async f => {
  const client = f.client(() => { throw Error("BUSINESS_POST_FORBIDDEN"); }, true);
  try {
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client }), { code: "AUTHENTICATION" });
    assert.equal(f.posts(), 0); assert.equal((await f.current()).state, "PREPARED"); assert.equal((await f.events()).length, 1);
  } finally { client.dispose(); }
});
material("two concurrent dispatch commands yield one reservation and one fake POST", async f => {
  const client = f.client(() => Response.json({ data: { success: true, created: true } }, { status: 201 }));
  try {
    const results = await Promise.allSettled([dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client }), dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client })]);
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1); assert.equal(f.posts(), 1);
    const events = await f.events(); assert.equal(events.filter(e => e.action === "RESERVED_FOR_DISPATCH").length, 1); assert.equal(events.length, 3);
  } finally { client.dispose(); }
});
for (const success of [true, false]) material("real revoke during HTTP preserves committed settlement " + success, async f => {
  const client = f.client(async () => {
    await authorization.revokeOpenCreditConsumerAuthorization(db, f.authInput);
    return Response.json({ data: { success, created: success } }, { status: 201 });
  });
  try {
    assert.equal((await dispatcher.dispatchOpenCreditCreateClient(db, f.command, { client })).state, success ? "SUCCEEDED" : "UNKNOWN");
    assert.equal((await f.protectedRows())[3].active, false); assert.equal(f.posts(), 1);
  } finally { client.dispose(); }
});
material("terminal Event failure rolls back terminal state without repeating fake POST", async f => {
  const wrapped: Db = { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) => db.$transaction(tx => {
    const event = new Proxy(tx.openCreditCommercialOperationEvent, { get(target, key) {
      if (key === "create") return (args: Parameters<typeof target.create>[0]) => {
        if (args.data.previousState === "IN_FLIGHT") throw Error("synthetic terminal Event fault"); return target.create(args);
      };
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get(target, key) { return key === "openCreditCommercialOperationEvent" ? event : Reflect.get(target, key); } }));
  }, options) } as Db;
  const client = f.client(() => Response.json({ data: { success: true, created: true } }, { status: 201 }));
  try {
    await assert.rejects(dispatcher.dispatchOpenCreditCreateClient(wrapped, f.command, { client }), { code: "SETTLEMENT_FAILED" });
    assert.equal(f.posts(), 1); assert.equal((await f.current()).state, "IN_FLIGHT"); assert.equal((await f.events()).length, 2);
  } finally { client.dispose(); }
});
