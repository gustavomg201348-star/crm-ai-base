import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import Module from "node:module";
import { randomUUID, createHmac } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "./permissions";
import { resolveCreateClientCommandId } from "./opencredit-create-client-ui";
import type { SessionUser } from "./auth";
import { assertOpenCreditCommercialOperationServiceTestDatabase } from "./opencredit-commercial-operation-service-postgres.guard";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditCommercialOperationServiceTestDatabase(process.env);
if (process.env.OPENCREDIT_CREATE_CLIENT_CONTEXT_POSTGRES_TEST !== "1") throw Error("CONTEXT_MATERIAL_REQUIRES_EXPLICIT_OPT_IN");
const db = new PrismaClient({ log: [] });
let service: typeof import("./opencredit-commercial-operation.service");
let authorization: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
let dispatcher: typeof import("./opencredit-create-client-dispatcher");
let api: typeof import("./opencredit-api-client");
let resolver: typeof import("./opencredit-provider-scope-resolver");
let boundary: typeof import("./opencredit-create-client-dispatch-admin-handler");
let context: typeof import("./opencredit-create-client-context.service");
let contextBoundary: typeof import("./opencredit-create-client-context-admin-handler");
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
    context = await import("./opencredit-create-client-context.service"); contextBoundary = await import("./opencredit-create-client-context-admin-handler");
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
  return { command, authInput, identity, contact, operations, events, client, handler, request, posts: () => posts, dispatches: () => dispatches };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
function material(name: string, run: (f: Fixture) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS", "OPENCREDIT_TENANT_ID", "OPENCREDIT_PARTNER_ID"], old = keys.map(k => process.env[k]);
    try { await run(await fixture()); }
    finally { keys.forEach((k, i) => { if (old[i] === undefined) delete process.env[k]; else process.env[k] = old[i]; }); }
  });
}
const read = (f: Fixture, change: Partial<Fixture["authInput"]> = {}) => context.getOpenCreditCreateClientContext(db, { ...f.authInput, ...change });
async function snapshot(f: Fixture) {
  const where = { companyId: f.command.companyId }, orderBy = { id: "asc" as const };
  return Promise.all([
    db.company.findUnique({ where: { id: f.command.companyId } }),
    db.contact.findMany({ where, orderBy }), db.openCreditCommercialAccess.findMany({ where, orderBy }),
    db.openCreditRemoteIdentity.findMany({ where, orderBy }), db.openCreditRemoteIdentityEvent.findMany({ where, orderBy }),
    db.openCreditCommercialOperation.findMany({ where, orderBy }), db.openCreditCommercialOperationEvent.findMany({ where, orderBy }),
    db.openCreditConsumerAuthorization.findMany({ where, orderBy }), db.openCreditConsumerAuthorizationEvent.findMany({ where, orderBy }),
  ]);
}
async function readonly<T>(f: Fixture, run: () => Promise<T>) {
  const before = await snapshot(f);
  try { return await run(); } finally { assert.deepEqual(await snapshot(f), before); }
}
const operation = (f: Fixture, changes: Record<string, unknown> = {}) => db.openCreditCommercialOperation.create({ data: {
  companyId: f.command.companyId, providerScope: f.authInput.providerScope, remoteIdentityId: f.identity.id,
  operationKind: "CLIENT_PROFILE_UPSERT", intentKey: f.command.commandId, state: "PREPARED", revision: 0, createdByUserId: f.authInput.actor.id,
  ...changes,
} });
material("no RemoteIdentity yields null without domain writes", async f => {
  const contact = await db.contact.create({ data: { companyId: f.command.companyId, name: "Synthetic no identity", phone: "synthetic" } });
  assert.deepEqual(await readonly(f, () => read(f, { contactId: contact.id })), { ok: true, operation: null });
});
material("identity without operation yields null without domain writes", async f => assert.deepEqual(await readonly(f, () => read(f)), { ok: true, operation: null }));
for (const state of ["PREPARED", "IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"]) material("persisted " + state + " survives context read with zero writes", async f => {
  const row = await operation(f, { state, revision: 2 });
  assert.deepEqual(await readonly(f, () => read(f)), { ok: true, operation: { operationId: row.id, commandId: f.command.commandId, state, revision: 2 } });
});
material("single CLIENT_PROFILE_UPSERT is read through identity-kind invariant", async f => {
  const row = await operation(f, { state: "UNKNOWN", revision: 2 });
  assert.deepEqual(await readonly(f, () => read(f)), { ok: true, operation: {
    operationId: row.id, commandId: row.intentKey, state: "UNKNOWN", revision: 2,
  } });
});
material("other operationKind does not shadow client upsert", async f => {
  const winner = await operation(f, { createdAt: new Date("2026-10-19T00:00:00Z") });
  await operation(f, { intentKey: randomUUID(), operationKind: "SYNTHETIC_OTHER", createdAt: new Date("2026-10-20T00:00:00Z") });
  assert.equal((await readonly(f, () => read(f))).operation?.operationId, winner.id);
});
material("cross-company contact is blocked", async f => {
  const company = await db.company.create({ data: { name: "Synthetic other" } });
  await assert.rejects(readonly(f, () => read(f, { companyId: company.id })), { code: "CONTACT_NOT_FOUND" });
});
material("different providerScope never mixes identities or operations", async f => {
  await operation(f);
  const scope = "synthetic-other-scope" as typeof f.authInput.providerScope;
  assert.deepEqual(await readonly(f, () => read(f, { providerScope: scope })), { ok: true, operation: null });
});
material("archived contact remains readable", async f => {
  await operation(f, { state: "IN_FLIGHT" }); await db.contact.update({ where: { id: f.contact.id }, data: { archivedAt: new Date() } });
  assert.equal((await readonly(f, () => read(f))).operation?.state, "IN_FLIGHT");
});
material("disabled identity and CommercialAccess remain readable", async f => {
  await operation(f, { state: "UNKNOWN" }); await db.openCreditRemoteIdentity.update({ where: { id: f.identity.id }, data: { enabled: false } });
  await db.openCreditCommercialAccess.updateMany({ where: { companyId: f.command.companyId }, data: { enabled: false } });
  assert.equal((await readonly(f, () => read(f))).operation?.state, "UNKNOWN");
});
material("revoked authorization does not block context", async f => {
  await operation(f, { state: "SUCCEEDED" }); await authorization.revokeOpenCreditConsumerAuthorization(db, f.authInput);
  assert.equal((await readonly(f, () => read(f))).operation?.state, "SUCCEEDED");
});
material("structurally corrupt persisted intent is rejected, not null", async f => {
  await operation(f, { intentKey: "SYNTHETIC_BAD_INTENT" });
  await assert.rejects(readonly(f, () => read(f)), { code: "CORRUPT_OPERATION" });
});
function contextRequest(f: Fixture) {
  return new NextRequest("https://crm.example.invalid/api/admin/integrations/opencredit/create-client/context", {
    method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" },
    body: JSON.stringify({ companyId: f.command.companyId, contactId: f.contact.id }),
  });
}
for (const success of [true, false]) material("HTTP reload recovers " + (success ? "SUCCEEDED" : "UNKNOWN") + ", original command, zero second POST and zero read writes", async f => {
  const client = f.client(() => Response.json({ data: { success, created: success } }, { status: 201 }));
  try {
    const sent = await f.handler(client)(f.request()); assert.equal(sent.status, 200); assert.equal(f.posts(), 1);
    const reader = contextBoundary.createOpenCreditCreateClientContextHandler({ db, getSession: async () => f.authInput.actor, requirePlatformAdmin, enforceLimits: async () => null });
    const response = await readonly(f, () => reader(contextRequest(f))); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.operation.state, success ? "SUCCEEDED" : "UNKNOWN");
    assert.equal(result.operation.operationId, (await f.operations())[0].id); assert.equal(result.operation.commandId, f.command.commandId);
    assert.equal(resolveCreateClientCommandId({ operation: result.operation, pendingCommandId: randomUUID(), generatedCommandId: randomUUID() }), null);
    assert.equal(f.posts(), 1);
  } finally { client.dispose(); }
});
material("PREPARED auth failure reload reuses exact command; explicit second command succeeds once", async f => {
  const failure = f.client(() => { throw Error("FORBIDDEN_BUSINESS_POST"); }, true);
  try {
    const response = await f.handler(failure)(f.request()); assert.equal(response.status, 503); assert.equal(f.posts(), 0);
  } finally { failure.dispose(); }
  const recovered = await readonly(f, () => read(f)); assert.equal(recovered.operation?.state, "PREPARED"); assert.equal(recovered.operation?.commandId, f.command.commandId);
  assert.equal(resolveCreateClientCommandId({ operation: recovered.operation, pendingCommandId: null }), f.command.commandId);
  const id = recovered.operation!.operationId;
  const client = f.client(() => Response.json({ data: { success: true, created: true } }, { status: 201 }));
  try {
    const response = await f.handler(client)(f.request()); assert.equal(response.status, 200); assert.equal((await response.json()).operationId, id);
    assert.equal((await f.operations()).length, 1); assert.equal(f.posts(), 1);
  } finally { client.dispose(); }
});
