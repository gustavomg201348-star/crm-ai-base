import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import type { SessionUser } from "./auth";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
if (process.env.OPENCREDIT_CREATE_CLIENT_ADMIN_POSTGRES_TEST !== "1") throw Error("ADMIN_COMMAND_MATERIAL_REQUIRES_EXPLICIT_OPT_IN");
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
let authorization: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
let dispatcher: typeof import("./opencredit-create-client-dispatcher");
let api: typeof import("./opencredit-api-client");
let resolver: typeof import("./opencredit-provider-scope-resolver");
let boundary: typeof import("./opencredit-create-client-dispatch-admin-handler");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("LIVE_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...a: unknown[]): unknown }, original = loader._load;
  loader._load = (s, ...a) => s === "server-only" ? {} : original.call(loader, s, ...a);
  try {
    service = await import("./opencredit-commercial-operation.service"); authorization = await import("./opencredit-consumer-authorization.service");
    provenance = await import("./meta-inbound-provenance"); dispatcher = await import("./opencredit-create-client-dispatcher");
    api = await import("./opencredit-api-client"); resolver = await import("./opencredit-provider-scope-resolver");
    boundary = await import("./opencredit-create-client-dispatch-admin-handler");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
type Db = Parameters<typeof service.prepareOpenCreditClientProfileOperation>[0];
async function fixture() {
  const companyId = "admin-dispatch-" + randomUUID(), platform = "platform-" + randomUUID();
  await db.company.createMany({ data: [companyId, platform].map(id => ({ id, name: "Synthetic command material" })) });
  const user = await db.user.create({ data: { companyId: platform, name: "Synthetic admin", email: randomUUID() + "@example.invalid", passwordHash: "SYNTHETIC", role: "ADMIN" } });
  const actor: SessionUser = { id: user.id, companyId: platform, name: user.name, email: user.email, role: "ADMIN" };
  process.env.PLATFORM_COMPANY_ID = platform; process.env.PLATFORM_ADMIN_EMAILS = user.email;
  process.env.OPENCREDIT_TENANT_ID = "Synthetic-" + randomUUID(); process.env.OPENCREDIT_PARTNER_ID = "Synthetic-partner";
  const { tenantId, providerScope } = resolver.resolveConfiguredOpenCreditProviderContext();
  const contact = await db.contact.create({ data: { companyId, name: "Synthetic", phone: "11900000000", cpf: "00000000000" } });
  await db.openCreditCommercialAccess.create({ data: { companyId, providerScope, enabled: true, changedByUserId: actor.id } });
  await db.openCreditRemoteIdentity.create({ data: { companyId, providerScope, contactId: contact.id, normalizedCpf: "00000000000", enabled: true, createdByUserId: actor.id } });
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
  const commandId = randomUUID(), command = { companyId, contactId: contact.id, commandId };
  const operations = () => db.openCreditCommercialOperation.findMany({ where: { companyId, providerScope } });
  const events = () => db.openCreditCommercialOperationEvent.findMany({ where: { companyId, providerScope }, orderBy: { revision: "asc" } });
  let posts = 0, dispatches = 0;
  const client = (response: () => Response | Promise<Response>, authFailure = false) => api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic" }), fetch: (async (url, init) => {
    if (String(url).endsWith("/api/auth/login")) return authFailure ? new Response(null, { status: 401 }) : Response.json({ data: { accessToken: "synthetic", refreshToken: "synthetic", expiresIn: 28800 } });
    assert.equal(String(url), `https://core.api.opencredit.tech/api/tenants/${tenantId}/integration/clients`); assert.equal(init?.method, "POST");
    assert.equal((await operations())[0].state, "IN_FLIGHT"); assert.equal((await events()).filter(e => e.action === "RESERVED_FOR_DISPATCH").length, 1);
    posts++; return response();
  }) as typeof fetch });
  const handler = (client: Pick<typeof api.openCreditApiClient, "postJsonAfterCommit">, database: Db = db) => boundary.createOpenCreditCreateClientDispatchAdminHandler({
    db: database, getSession: async () => actor, requirePlatformAdmin, enforceLimits: async () => null,
    dispatch: async (db, input) => { dispatches++; return dispatcher.dispatchOpenCreditCreateClient(db, input, { client }); },
  });
  const request = () => new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/create-client/dispatch", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify(command),
  });
  return { command, authInput, operations, events, client, handler, request, posts: () => posts, dispatches: () => dispatches };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS", "OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"], old = keys.map(k => process.env[k]);
    try { await run(await fixture()); }
    finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
    // Immutable audit fixtures are removed only with the disposable container/volume.
  });
}
const positive = () => Response.json({ data: { success: true, created: true } }, { status: 201 });
for (const ambiguous of [false, true]) material("real human command fake POST once then " + (ambiguous ? "UNKNOWN" : "SUCCEEDED"), async f => {
  assert.equal((await f.operations()).length, 0);
  const client = f.client(ambiguous ? () => Response.json({ data: { success: false, created: false } }, { status: 201 }) : positive);
  try {
    const response = await f.handler(client)(f.request()); assert.equal(response.status, 200);
    const result = await response.json(); assert.deepEqual(result, { ok: true, operationId: (await f.operations())[0].id, state: ambiguous ? "UNKNOWN" : "SUCCEEDED", revision: 2, dispatched: true });
    assert.equal(f.posts(), 1); assert.deepEqual((await f.events()).map(e => e.action), ["PREPARED", "RESERVED_FOR_DISPATCH", ambiguous ? "MARKED_UNKNOWN" : "MARKED_SUCCEEDED_CREATED"]);
  } finally { client.dispose(); }
});
for (const ambiguous of [false, true]) material("same command sequential duplicate has zero second POST " + ambiguous, async f => {
  const client = f.client(ambiguous ? () => { throw Error("synthetic network ambiguity"); } : positive);
  try {
    const handler = f.handler(client), first = await (await handler(f.request())).json(); assert.equal(f.posts(), 1);
    const second = await (await handler(f.request())).json(); assert.deepEqual(second, { ...first, dispatched: false });
    assert.equal(f.posts(), 1); assert.equal(f.dispatches(), 1); assert.equal((await f.operations()).length, 1); assert.equal((await f.events()).length, 3);
  } finally { client.dispose(); }
});
material("same command concurrent duplicate has one operation, one PREPARED and exactly one fake POST", async f => {
  const client = f.client(positive);
  try {
    const handler = f.handler(client), responses = await Promise.all([handler(f.request()), handler(f.request())]);
    assert(responses.every(r => [200, 409].includes(r.status))); assert(responses.some(r => r.status === 200));
    assert.equal((await f.operations()).length, 1); const events = await f.events();
    assert.equal(events.filter(e => e.action === "PREPARED").length, 1); assert.equal(events.filter(e => e.action === "RESERVED_FOR_DISPATCH").length, 1); assert.equal(f.posts(), 1);
    assert(!events.some(e => e.nextState === "FAILED"));
  } finally { client.dispose(); }
});
material("distinct commandIds are only distinct local preparations, no dispatch", async f => {
  const first = await service.prepareOpenCreditClientProfileOperation(db, { ...f.authInput, intentKey: f.command.commandId });
  const second = await service.prepareOpenCreditClientProfileOperation(db, { ...f.authInput, intentKey: randomUUID() });
  assert.notEqual(first.operationId, second.operationId); assert.equal((await f.operations()).length, 2);
  assert((await f.events()).every(e => e.action === "PREPARED")); assert.equal(f.posts(), 0); assert.equal(f.dispatches(), 0);
});
material("revoked before reservation leaves PREPARED, zero reservation and zero POST", async f => {
  await authorization.revokeOpenCreditConsumerAuthorization(db, f.authInput);
  const client = f.client(positive);
  try {
    const response = await f.handler(client)(f.request()); assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "OPENCREDIT_COMMERCIAL_OPERATION_CONSUMER_AUTHORIZATION_INACTIVE" });
    assert.equal((await f.operations())[0].state, "PREPARED"); assert.deepEqual((await f.events()).map(e => e.action), ["PREPARED"]); assert.equal(f.posts(), 0);
  } finally { client.dispose(); }
});
material("revoked after commit does not undo fake POST or settlement", async f => {
  const client = f.client(async () => { await authorization.revokeOpenCreditConsumerAuthorization(db, f.authInput); return positive(); });
  try {
    const response = await f.handler(client)(f.request()); assert.equal(response.status, 200); assert.equal((await response.json()).state, "SUCCEEDED"); assert.equal(f.posts(), 1);
    assert.equal((await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: { companyId: f.command.companyId } })).active, false);
  } finally { client.dispose(); }
});
material("auth failure is AUTHENTICATION, PREPARED and zero POST/reservation", async f => {
  const client = f.client(positive, true);
  try {
    const response = await f.handler(client)(f.request()); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "OPENCREDIT_CREATE_CLIENT_DISPATCH_AUTHENTICATION" });
    assert.equal((await f.operations())[0].state, "PREPARED"); assert.equal((await f.events()).length, 1); assert.equal(f.posts(), 0);
  } finally { client.dispose(); }
});
material("settlement failure after one fake POST is not success and duplicate never replays", async f => {
  const wrapped: Db = { $transaction: <T>(run: (tx: Prisma.TransactionClient) => Promise<T>, options?: { isolationLevel?: Prisma.TransactionIsolationLevel; maxWait?: number; timeout?: number }) => db.$transaction(tx => {
    const event = new Proxy(tx.openCreditCommercialOperationEvent, { get(target, key) {
      if (key === "create") return (args: Parameters<typeof target.create>[0]) => { if (args.data.previousState === "IN_FLIGHT") throw Error("synthetic settlement fault"); return target.create(args); };
      return Reflect.get(target, key);
    } });
    return run(new Proxy(tx, { get(target, key) { return key === "openCreditCommercialOperationEvent" ? event : Reflect.get(target, key); } }));
  }, options) } as Db;
  const client = f.client(positive);
  try {
    const handler = f.handler(client, wrapped), response = await handler(f.request()); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED" });
    assert.equal(f.posts(), 1); assert.equal((await f.operations())[0].state, "IN_FLIGHT"); assert.equal((await f.events()).length, 2);
    const repeat = await handler(f.request()); assert.equal(repeat.status, 200); assert.equal((await repeat.json()).dispatched, false); assert.equal(f.posts(), 1); assert.equal(f.dispatches(), 1);
  } finally { client.dispose(); }
});
