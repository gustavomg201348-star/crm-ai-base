import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import Module from "node:module";
import { mkdtempSync, cpSync, readdirSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditConsumerAuthorizationGrantInput } from "./opencredit-consumer-authorization.service";
import { assertOpenCreditConsumerAuthorizationTestDatabase } from "./opencredit-consumer-authorization-postgres.guard";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditConsumerAuthorizationTestDatabase(process.env);
const db = new PrismaClient({ log: [] });
let correction: typeof import("./opencredit-client-correction.service");
let operation: typeof import("./opencredit-commercial-operation.service");
let api: typeof import("./opencredit-api-client");
let service: typeof import("./opencredit-consumer-authorization.service");
let provenance: typeof import("./meta-inbound-provenance");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw new Error("EXTERNAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(specifier: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (specifier, ...args) => specifier === "server-only" ? {} : original.call(loader, specifier, ...args);
  try {
    service = await import("./opencredit-consumer-authorization.service");
    correction = await import("./opencredit-client-correction.service");
    operation = await import("./opencredit-commercial-operation.service");
    api = await import("./opencredit-api-client");
    provenance = await import("./meta-inbound-provenance");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });
const mainDb = db;
async function fixture(client: PrismaClient = mainDb) {
  const db = client;
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
const fields = { dataNascimento: "29/02/2000", nomeMae: "Synthetic Mother", email: "synthetic@example.invalid" };
test("upgrade 22 to 24 migrations preserves historical UPSERT state, events and revision", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "qevora-correction-upgrade-"));
  const schema = "correction_upgrade_" + randomUUID().replace(/-/g, "");
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set("schema", schema);
  const client = new PrismaClient({ datasources: { db: { url: url.href } }, log: [] });
  const oldCompany = process.env.PLATFORM_COMPANY_ID, oldEmails = process.env.PLATFORM_ADMIN_EMAILS;
  const added = ["20261028120000_add_opencredit_correction_authorization", "20261028120100_scope_opencredit_correction_intents"];
  try {
    copyFileSync("prisma/schema.postgres.prisma", join(temporary, "schema.prisma"));
    mkdirSync(join(temporary, "migrations"));
    for (const name of readdirSync("prisma/migrations")) if (!added.includes(name)) cpSync(join("prisma/migrations", name), join(temporary, "migrations", name), { recursive: true });
    const deploy = () => execFileSync(process.execPath, [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy", "--schema", join(temporary, "schema.prisma")], { env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe", timeout: 120000 });
    deploy();
    const f = await fixture(client); process.env.PLATFORM_COMPANY_ID = f.platform.id; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
    await service.grantOpenCreditConsumerAuthorizationFromInboundEvidence(client, f.input);
    await operation.prepareOpenCreditClientProfileOperation(client, { ...f.revokeInput, intentKey: randomUUID() });
    const where = { companyId: f.company.id };
    const previous = { auth: await client.openCreditConsumerAuthorization.findMany({ where }), events: await client.openCreditConsumerAuthorizationEvent.findMany({ where }),
      operations: await client.openCreditCommercialOperation.findMany({ where }), operationEvents: await client.openCreditCommercialOperationEvent.findMany({ where }) };
    for (const name of added) cpSync(join("prisma/migrations", name), join(temporary, "migrations", name), { recursive: true });
    deploy();
    assert.deepEqual(await client.openCreditConsumerAuthorization.findMany({ where }), previous.auth);
    assert.deepEqual(await client.openCreditConsumerAuthorizationEvent.findMany({ where }), previous.events);
    assert.deepEqual(await client.openCreditCommercialOperation.findMany({ where }), previous.operations);
    assert.deepEqual(await client.openCreditCommercialOperationEvent.findMany({ where }), previous.operationEvents);
    assert.equal((await service.grantOpenCreditCorrectionAuthorization(client, f.input)).revision, 0);
    await assert.rejects(() => client.openCreditConsumerAuthorization.create({ data: { ...previous.auth[0], id: randomUUID(), purpose: "INVALID_PURPOSE" } }),
      e => e instanceof Error && e.message.includes("23514") && e.message.includes("OCConsumerAuth_purpose_check"));
  } finally {
    await client.$disconnect();
    if (!/^correction_upgrade_[a-f0-9]{32}$/.test(schema)) throw Error("UNSAFE_LOCAL_SCHEMA");
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    const absolute = resolve(temporary), parent = resolve(tmpdir()) + sep;
    if (!absolute.startsWith(parent) || !absolute.slice(parent.length).startsWith("qevora-correction-upgrade-")) throw Error("UNSAFE_TEMP_PATH");
    rmSync(absolute, { recursive: true, force: true });
    if (oldCompany === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = oldCompany;
    if (oldEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = oldEmails;
  }
});
function material(name: string, run: (f: F) => Promise<void>) {
  test(name, async () => {
    const beforeCompany = process.env.PLATFORM_COMPANY_ID, beforeEmails = process.env.PLATFORM_ADMIN_EMAILS;
    try {
      const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform.id; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      await run(f);
    } finally {
      if (beforeCompany === undefined) delete process.env.PLATFORM_COMPANY_ID; else process.env.PLATFORM_COMPANY_ID = beforeCompany;
      if (beforeEmails === undefined) delete process.env.PLATFORM_ADMIN_EMAILS; else process.env.PLATFORM_ADMIN_EMAILS = beforeEmails;
    }
  });
}
const grant = (f: F) => service.grantOpenCreditCorrectionAuthorization(db, f.input);
const revoke = (f: F) => service.revokeOpenCreditCorrectionAuthorization(db, f.revokeInput);
const input = (f: F) => ({ actor: f.actor, companyId: f.company.id, contactId: f.contact.id, ...fields });
const scopeOptions = (f: F) => ({ resolve: () => ({ tenantId: "synthetic", providerScope: f.input.providerScope }) });
const opWhere = (f: F) => ({ companyId: f.company.id, providerScope: f.input.providerScope, operationKind: "CLIENT_PROFILE_CORRECTION" });
function transport(f: F, status = 200, success: unknown = true) {
  let count = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = {
    async patchJsonAfterCommit(path, commit) {
      assert.equal(path, "/api/tenants/synthetic/integration/clients/00000000000");
      const execution = await commit();
      const committed = await db.openCreditCommercialOperation.findFirst({ where: { ...opWhere(f), state: "IN_FLIGHT" } });
      assert.ok(committed); assert.equal(committed.revision, 1);
      assert.deepEqual(JSON.parse(execution.body), { data_nascimento: "29/02/2000", nome_mae: "Synthetic Mother", email: "synthetic@example.invalid", celular: "47999999999" });
      count++;
      return { response: Response.json({ data: { success }, raw: "PRIVATE_SENTINEL" }, { status }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null };
    }
  };
  return { client, count: () => count };
}
material("purpose isolation preserves UPSERT grant rows/revisions/events", async f => {
  await service.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.input);
  // Explicitly inspect authorization, never treat a CORRECTION as UPSERT.
  const upsert = await db.openCreditConsumerAuthorization.findUniqueOrThrow({ where: { companyId_providerScope_contactId_purpose: { companyId: f.company.id, providerScope: f.input.providerScope, contactId: f.contact.id, purpose: "CLIENT_PROFILE_UPSERT" } } });
  const events = await db.openCreditConsumerAuthorizationEvent.findMany({ where: { authorizationId: upsert.id } });
  await assert.rejects(() => correction.readClientCorrectionContext(db, input(f), scopeOptions(f)));
  await grant(f);
  assert.deepEqual(await db.openCreditConsumerAuthorization.findUnique({ where: { id: upsert.id } }), upsert);
  assert.deepEqual(await db.openCreditConsumerAuthorizationEvent.findMany({ where: { authorizationId: upsert.id } }), events);
  assert.equal(await db.openCreditConsumerAuthorization.count({ where: { companyId: f.company.id } }), 2);
});
material("CORRECTION alone does not authorize UPSERT reservation", async f => {
  await grant(f);
  const prepared = await operation.prepareOpenCreditClientProfileOperation(db, { ...f.revokeInput, intentKey: randomUUID() });
  await assert.rejects(() => operation.reserveOpenCreditClientProfileOperationForDispatch(db, { actor: f.actor, companyId: f.company.id, providerScope: f.input.providerScope, operationId: prepared.operationId, expectedRevision: 0 }),
    e => e instanceof operation.OpenCreditCommercialOperationServiceError && e.code === "CONSUMER_AUTHORIZATION_MISSING");
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: prepared.operationId } })).state, "PREPARED");
});
material("same GRANTED repeated requests preserve exact operation and only one PATCH", async f => {
  await grant(f); const t = transport(f);
  const first = await correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client });
  const second = await correction.dispatchClientCorrection(db, { ...input(f), email: "changed@example.invalid" }, { ...scopeOptions(f), client: t.client });
  assert.deepEqual(second, first); assert.equal(t.count(), 1); assert.equal(await db.openCreditCommercialOperation.count({ where: opWhere(f) }), 1);
  const events = await db.openCreditCommercialOperationEvent.findMany({ where: { operationId: first.operationId }, orderBy: { revision: "asc" } });
  assert.deepEqual(events.map(e => [e.action, e.revision]), [["PREPARED", 0], ["RESERVED_FOR_DISPATCH", 1], ["MARKED_SUCCEEDED_CORRECTED", 2]]);
  const grantEvent = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { id: events[1].dispatchAuthorizationEventId! } });
  assert.equal(grantEvent.action, "GRANTED"); assert.equal(grantEvent.revision, 0);
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: first.operationId } })).intentKey, "correction-" + grantEvent.id);
});
material("concurrent same GRANTED yields one durable intention and one PATCH", async f => {
  await grant(f); const t = transport(f);
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client })));
  assert(results.some(r => r.status === "fulfilled")); assert.equal(t.count(), 1);
  assert.equal(await db.openCreditCommercialOperation.count({ where: opWhere(f) }), 1);
  const rows = await db.openCreditCommercialOperationEvent.findMany({ where: { companyId: f.company.id }, orderBy: { revision: "asc" } });
  assert.deepEqual(rows.map(e => e.revision), [0, 1, 2]);
});
material("revoke/regrant permits a new audit-distinct intention after SUCCEEDED", async f => {
  await grant(f); const t = transport(f);
  const first = await correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client });
  await revoke(f); await grant(f);
  const second = await correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client });
  assert.notEqual(second.operationId, first.operationId); assert.equal(t.count(), 2);
  const rows = await db.openCreditCommercialOperation.findMany({ where: opWhere(f) }); assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(r => r.intentKey)).size, 2); assert(rows.every(r => r.state === "SUCCEEDED"));
  const reserved = await db.openCreditCommercialOperationEvent.findMany({ where: { companyId: f.company.id, action: "RESERVED_FOR_DISPATCH" } });
  assert.equal(new Set(reserved.map(r => r.dispatchAuthorizationEventId)).size, 2);
});
for (const state of ["IN_FLIGHT", "UNKNOWN"]) material(state + " blocks another GRANTED and DB unresolved unique", async f => {
  await grant(f);
  const current = await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: { companyId: f.company.id, purpose: "CLIENT_PROFILE_CORRECTION" } });
  const event = await db.openCreditConsumerAuthorizationEvent.findUniqueOrThrow({ where: { authorizationId_revision: { authorizationId: current.id, revision: 0 } } });
  const data = { companyId: f.company.id, providerScope: f.input.providerScope, remoteIdentityId: f.identity.id, operationKind: "CLIENT_PROFILE_CORRECTION", intentKey: "correction-" + event.id, state, revision: state === "UNKNOWN" ? 2 : 1, createdByUserId: f.actor.id };
  await db.openCreditCommercialOperation.create({ data });
  await revoke(f); await grant(f); const t = transport(f);
  await assert.rejects(() => correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client }),
    e => e instanceof correction.ClientCorrectionError && e.code === "UNRESOLVED_CORRECTION");
  assert.equal(t.count(), 0);
  await assert.rejects(() => db.openCreditCommercialOperation.create({ data: { ...data, intentKey: "other-intent" } }), e => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
});
material("UPSERT singleton cannot be bypassed by another grant or intent", async f => {
  const data = { companyId: f.company.id, providerScope: f.input.providerScope, remoteIdentityId: f.identity.id, operationKind: "CLIENT_PROFILE_UPSERT", intentKey: randomUUID(), state: "SUCCEEDED", revision: 2, createdByUserId: f.actor.id };
  const first = await db.openCreditCommercialOperation.create({ data });
  await grant(f); await revoke(f); await grant(f);
  await assert.rejects(() => db.openCreditCommercialOperation.create({ data: { ...data, intentKey: randomUUID() } }), e => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002");
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: first.id } })).state, "SUCCEEDED");
});
for (const [status, success] of [[200, false], [201, true], [401, true], [500, true]] as const) material("non-conclusive " + status + "/" + success + " becomes UNKNOWN without replay", async f => {
  await grant(f); const t = transport(f, status, success);
  const r = await correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client: t.client });
  assert.equal(r.state, "UNKNOWN"); assert.equal(t.count(), 1);
  const record = await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: r.operationId } });
  const diagnostic = JSON.parse(record.diagnostic!);
  assert.equal(diagnostic.httpStatus, status); assert.equal(diagnostic.providerSuccess, success); assert.equal(diagnostic.settlement, "CONFIRMED");
  for (const sentinel of ["00000000000", "5547999999999", "synthetic@example.invalid", "Synthetic Mother", "29/02/2000", "PRIVATE_SENTINEL"]) assert.equal(record.diagnostic!.includes(sentinel), false);
});
material("revocation after commit does not undo IN_FLIGHT settlement", async f => {
  await grant(f); const t = transport(f);
  const client: typeof t.client = { async patchJsonAfterCommit(path, commit) {
    return t.client.patchJsonAfterCommit(path, async () => { const reservation = await commit(); await revoke(f); return reservation; });
  } };
  const r = await correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client });
  assert.equal(r.state, "SUCCEEDED"); assert.equal(t.count(), 1);
  assert.equal((await db.openCreditConsumerAuthorization.findFirstOrThrow({ where: { companyId: f.company.id } })).active, false);
});
material("pre-commit revocation creates neither operation nor PATCH", async f => {
  await grant(f); const t = transport(f);
  const client: typeof t.client = { async patchJsonAfterCommit(path, commit) { await revoke(f); return t.client.patchJsonAfterCommit(path, commit); } };
  await assert.rejects(() => correction.dispatchClientCorrection(db, input(f), { ...scopeOptions(f), client }));
  assert.equal(t.count(), 0); assert.equal(await db.openCreditCommercialOperation.count({ where: opWhere(f) }), 0);
});
