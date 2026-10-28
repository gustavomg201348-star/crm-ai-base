import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHmac, randomUUID } from "node:crypto";
import Module from "node:module";
import { Prisma, PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import type { OpenCreditConsumerAuthorizationGrantInput } from "./opencredit-consumer-authorization.service";
import { assertOpenCreditConsumerAuthorizationTestDatabase } from "./opencredit-consumer-authorization-postgres.guard";
import { classifyPhoneNormalization } from "./phone-normalization.service";
import { persistInboundMessage } from "./meta-reply-ingestion";

assertOpenCreditConsumerAuthorizationTestDatabase(process.env);
if (process.env.OPENCREDIT_SIMULATION_POSTGRES_TEST !== "1") throw Error("SIMULATION_TEST_REQUIRES_DISPOSABLE_OPT_IN");
const db = new PrismaClient({ log: [] });
let simulation: typeof import("./opencredit-clt-simulation.service");
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
    simulation = await import("./opencredit-clt-simulation.service");
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
const parameters = { bankId: "synthetic-bank", mode: "parcela" as const, amountBRL: "1050,00" };
const offer = { offerId: "synthetic-offer", installments: 12, installmentAmount: 10, liquidAmount: 100, interestRate: 1.2, totalAmount: 120, hasInsurance: false };
function material(name: string, run: (f: F) => Promise<void>) {
  test(name, async () => {
    const keys = ["PLATFORM_COMPANY_ID", "PLATFORM_ADMIN_EMAILS", "OPENCREDIT_PARTNER_ID"] as const;
    const previous = keys.map(k => process.env[k]);
    try {
      const f = await fixture(); process.env.PLATFORM_COMPANY_ID = f.platform.id; process.env.PLATFORM_ADMIN_EMAILS = f.actor.email;
      process.env.OPENCREDIT_PARTNER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"; await run(f);
    } finally { keys.forEach((k, i) => { if (previous[i] === undefined) delete process.env[k]; else process.env[k] = previous[i]; }); }
  });
}
const grant = (f: F) => service.grantOpenCreditSimulationAuthorization(db, f.input);
const revoke = (f: F) => service.revokeOpenCreditSimulationAuthorization(db, f.revokeInput);
const input = (f: F) => ({ actor: f.actor, companyId: f.company.id, contactId: f.contact.id, ...parameters });
const options = (f: F) => ({ resolve: () => ({ tenantId: "synthetic", providerScope: f.input.providerScope }),
  banks: async () => [{ bankId: parameters.bankId, bankName: "Synthetic bank", capabilities: { simulacaoAtiva: true, suportaParcela: true, suportaLiquido: true } }] });
const where = (f: F) => ({ companyId: f.company.id, providerScope: f.input.providerScope, operationKind: "CREDIT_SIMULATION" });
function transport(f: F, http = 200, status: "aprovado" | "pendente" = "aprovado") {
  let posts = 0, gets = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "simulateJsonAfterCommit" | "getOnce"> = {
    async simulateJsonAfterCommit(path, commit) {
      assert.equal(path, "/api/tenants/synthetic/integration/simulate");
      const execution = await commit();
      const persisted = await db.openCreditCommercialOperation.findFirstOrThrow({ where: { ...where(f), state: "IN_FLIGHT" } });
      assert.equal(persisted.revision, 1);
      assert.deepEqual(JSON.parse(execution.body), { cpf: "00000000000", banks: ["synthetic-bank"], tipoValorSolicitado: "parcela", valorSolicitado: 105000, partnerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
      posts++;
      return { response: Response.json({ data: { fromCache: false, blocked: false, barriers: [], client: { cpf: "00000000000", nome: "PRIVATE_SENTINEL" },
        banks: [{ bankId: parameters.bankId, bankName: "Synthetic", simulationId: "synthetic-simulation", status, reasonType: null, simulationType: "valor_parcela", offers: status === "aprovado" ? [offer] : [] }] } }, { status: http }),
        committed: execution.committed, sanitizeDiagnosticIdentifier: () => null };
    },
    async getOnce(path) {
      assert.equal(path, "/api/tenants/synthetic/simulations/synthetic-simulation"); gets++;
      return { response: Response.json({ data: { id: "synthetic-simulation", tenantId: "synthetic", product: "clt", cpf: "00000000000", bankId: parameters.bankId, status: "approved", offers: [offer] } }), sanitizeDiagnosticIdentifier: () => null };
    },
  };
  return { client, posts: () => posts, gets: () => gets };
}
material("new simulation purpose preserves old grants/revisions/events and isolates all three purposes", async f => {
  await service.grantOpenCreditConsumerAuthorizationFromInboundEvidence(db, f.input);
  await service.grantOpenCreditCorrectionAuthorization(db, f.input);
  const previous = await db.openCreditConsumerAuthorization.findMany({ where: { companyId: f.company.id }, orderBy: { purpose: "asc" } });
  const events = await db.openCreditConsumerAuthorizationEvent.findMany({ where: { companyId: f.company.id }, orderBy: { id: "asc" } });
  const t = transport(f);
  await assert.rejects(() => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client })); assert.equal(t.posts(), 0);
  await grant(f);
  assert.deepEqual(await db.openCreditConsumerAuthorization.findMany({ where: { companyId: f.company.id, purpose: { in: ["CLIENT_PROFILE_UPSERT", "CLIENT_PROFILE_CORRECTION"] } }, orderBy: { purpose: "asc" } }), previous);
  assert.deepEqual(await db.openCreditConsumerAuthorizationEvent.findMany({ where: { id: { in: events.map(e => e.id) } }, orderBy: { id: "asc" } }), events);
  assert.equal(await db.openCreditConsumerAuthorization.count({ where: { companyId: f.company.id } }), 3);
});
material("simulation grant alone cannot reserve UPSERT or dispatch CORRECTION", async f => {
  await grant(f);
  await assert.rejects(() => correction.dispatchClientCorrection(db, { ...input(f), dataNascimento: "29/02/2000", nomeMae: "Synthetic", email: "synthetic@example.invalid" }, options(f)), e => e instanceof correction.ClientCorrectionError && e.code === "TARGET_NOT_READY");
  const prepared = await operation.prepareOpenCreditClientProfileOperation(db, { ...f.revokeInput, intentKey: randomUUID() });
  await assert.rejects(() => operation.reserveOpenCreditClientProfileOperationForDispatch(db, { actor: f.actor, companyId: f.company.id, providerScope: f.input.providerScope, operationId: prepared.operationId, expectedRevision: 0 }), e => e instanceof operation.OpenCreditCommercialOperationServiceError && e.code === "CONSUMER_AUTHORIZATION_MISSING");
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: prepared.operationId } })).state, "PREPARED");
});
material("same GRANTED repeats reconcile exact operation, one POST, no financial payload in diagnostics", async f => {
  await grant(f); const t = transport(f);
  const a = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client });
  const before = await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: a.operation.operationId } });
  const b = await simulation.dispatchCltSimulation(db, { ...input(f), amountBRL: "999,00" }, { ...options(f), client: t.client });
  assert.equal(a.operation.operationId, b.operation.operationId); assert.equal(t.posts(), 1); assert.equal(t.gets(), 0);
  assert.deepEqual(await db.openCreditCommercialOperation.findUnique({ where: { id: before.id } }), before);
  const events = await db.openCreditCommercialOperationEvent.findMany({ where: { operationId: before.id }, orderBy: { revision: "asc" } });
  assert.deepEqual(events.map(e => e.action), ["PREPARED", "RESERVED_FOR_DISPATCH", "SIMULATION_COMPLETED"]);
  assert.equal(before.intentKey, "simulation-" + events[1].dispatchAuthorizationEventId);
  for (const secret of ["00000000000", "PRIVATE_SENTINEL", "105000", "cpf", "offers", "1050,00"]) assert.equal(before.diagnostic!.includes(secret), false);
});
material("concurrent requests under same GRANTED produce one intention and one paid POST", async f => {
  await grant(f); const t = transport(f);
  const result = await Promise.allSettled(Array.from({ length: 6 }, () => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client })));
  assert(result.some(r => r.status === "fulfilled")); assert.equal(t.posts(), 1); assert.equal(await db.openCreditCommercialOperation.count({ where: where(f) }), 1);
  const events = await db.openCreditCommercialOperationEvent.findMany({ where: { companyId: f.company.id }, orderBy: { revision: "asc" } });
  assert.deepEqual(events.map(e => e.revision), [0, 1, 2]);
});
material("regrant after completed simulation creates distinct grant-bound intention, never reuses prior terminal", async f => {
  await grant(f); const t = transport(f);
  const a = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client });
  await revoke(f); await grant(f);
  const b = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client });
  assert.notEqual(a.operation.operationId, b.operation.operationId); assert.equal(t.posts(), 2);
  const rows = await db.openCreditCommercialOperation.findMany({ where: where(f) }); assert.equal(new Set(rows.map(r => r.intentKey)).size, 2);
});
material("pending persists ID; manual provider GET settles, zero additional POST", async f => {
  await grant(f); const t = transport(f, 200, "pendente");
  const a = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client });
  assert.equal(a.operation.state, "IN_FLIGHT"); assert.equal(a.operation.displayState, "PENDING");
  const b = await simulation.pollCltSimulation(db, input(f), { ...options(f), client: t.client });
  assert.equal(b.operation.state, "SUCCEEDED"); assert.equal(t.posts(), 1); assert.equal(t.gets(), 1);
});
for (const http of [401, 500]) material("HTTP " + http + " -> UNKNOWN, no replay, blocks later grant", async f => {
  await grant(f); const t = transport(f, http);
  const a = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client }); assert.equal(a.operation.state, "UNKNOWN");
  await revoke(f); await grant(f);
  await assert.rejects(() => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client }));
  assert.equal(t.posts(), 1); assert.equal(await db.openCreditCommercialOperation.count({ where: where(f) }), 1);
});
material("IN_FLIGHT pending blocks a new grant but read-only GET can reconcile the original", async f => {
  await grant(f); const t = transport(f, 200, "pendente");
  await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client }); await revoke(f); await grant(f);
  await assert.rejects(() => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client }));
  assert.equal((await simulation.pollCltSimulation(db, input(f), { ...options(f), client: t.client })).operation.state, "SUCCEEDED"); assert.equal(t.posts(), 1);
});
for (const failure of ["TIMEOUT", "NETWORK"] as const) material(failure + " after commit becomes UNKNOWN without retry", async f => {
  await grant(f); const t = transport(f); let posts = 0;
  const client: typeof t.client = { ...t.client, async simulateJsonAfterCommit(_path, commit) { await commit(); posts++; throw new api.OpenCreditApiError(failure); } };
  const a = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client }); assert.equal(a.operation.state, "UNKNOWN");
  await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client }); assert.equal(posts, 1); assert.equal(t.gets(), 0);
});
material("bank removed/disabled since UI read fails closed before any reservation", async f => {
  await grant(f); const t = transport(f);
  await assert.rejects(() => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client, banks: async () => [] }));
  assert.equal(t.posts(), 0); assert.equal(await db.openCreditCommercialOperation.count({ where: where(f) }), 0);
});
material("revocation before reservation blocks; after commit does not undo observation", async f => {
  await grant(f); const t = transport(f);
  await assert.rejects(() => simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client, banks: async () => { await revoke(f); return options(f).banks(); } }));
  assert.equal(t.posts(), 0); await grant(f);
  const client: typeof t.client = { ...t.client, async simulateJsonAfterCommit(path, commit) { return t.client.simulateJsonAfterCommit(path, async () => { const committed = await commit(); await revoke(f); return committed; }); } };
  assert.equal((await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client })).operation.state, "SUCCEEDED"); assert.equal(t.posts(), 1);
});
material("database independently rejects two unresolved simulation intentions", async f => {
  await grant(f); const t = transport(f, 200, "pendente");
  const r = await simulation.dispatchCltSimulation(db, input(f), { ...options(f), client: t.client });
  const data = { ...where(f), remoteIdentityId: f.identity.id, intentKey: randomUUID(), state: "IN_FLIGHT", revision: 1, createdByUserId: f.actor.id };
  await assert.rejects(() => db.openCreditCommercialOperation.create({ data }), e => {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return false;
    const target = e.meta?.target;
    return target === "OCOperation_simulation_unresolved_key" || Array.isArray(target) && target.length === 3 && ["companyId", "providerScope", "remoteIdentityId"].every(k => target.includes(k));
  });
  assert.equal((await db.openCreditCommercialOperation.findUniqueOrThrow({ where: { id: r.operation.operationId } })).state, "IN_FLIGHT"); assert.equal(t.posts(), 1);
});
