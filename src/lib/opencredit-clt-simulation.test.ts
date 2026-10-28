import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { reaisToCents, simulationParameters, simulationPayload, parseSimulationPost, parseSimulationPoll, parseSimulationReply } from "./opencredit-clt-simulation";
let service: typeof import("./opencredit-clt-simulation.service");
let api: typeof import("./opencredit-api-client");
let handler: typeof import("./opencredit-clt-simulation-admin-handler");
const originalFetch = globalThis.fetch;
before(async () => {
  globalThis.fetch = async () => { throw Error("REAL_HTTP_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { service = await import("./opencredit-clt-simulation.service"); api = await import("./opencredit-api-client"); handler = await import("./opencredit-clt-simulation-admin-handler"); }
  finally { loader._load = original; }
});
after(() => { globalThis.fetch = originalFetch; });
const parameters = { bankId: "synthetic-bank", mode: "parcela" as const, amountBRL: "1050,00" };
const offer = { offerId: "synthetic-offer", installments: 12, installmentAmount: 10, liquidAmount: 100, interestRate: 1.2, totalAmount: 120, hasInsurance: false };
const response = (status: "aprovado" | "recusado" | "pendente" = "aprovado", reasonType: string | null = null) => ({ data: { fromCache: false, blocked: false, barriers: [], client: { cpf: "00000000000", nome: "PRIVATE_SENTINEL" }, banks: [{ bankId: parameters.bankId, bankName: "Synthetic", simulationId: "synthetic-simulation", status, reasonType, simulationType: "valor_parcela", offers: status === "aprovado" ? [offer] : [] }] } });
for (const [value, expected] of [["0,01", 1], ["1", 100], ["1050,00", 105000], ["1050,09", 105009]] as const) test("exact integer cents " + value, () => assert.equal(reaisToCents(value), expected));
for (const value of ["", "0", "0,00", "1.050,00", "1050.00", "R$ 1050", " 1", "1 ", "1,0", "01", "-1", "+1", "1e3", "1\n", "99999999999999999999", 1050, null]) test("reject ambiguous monetary input " + JSON.stringify(value), () => assert.throws(() => reaisToCents(value)));
test("provider body exactly cpf, one bank, paired integer-cent parameters; maximum explicitly omits both", () => {
  assert.deepEqual(simulationPayload(parameters, "00000000000"), { cpf: "00000000000", banks: ["synthetic-bank"], tipoValorSolicitado: "parcela", valorSolicitado: 105000 });
  assert.deepEqual(simulationPayload({ bankId: "synthetic-bank", mode: "maximum", amountBRL: "" }, "00000000000"), { cpf: "00000000000", banks: ["synthetic-bank"] });
  assert.throws(() => simulationParameters({ ...parameters, mode: "maximum" }));
});
for (const status of [200, 201, 400, 401, 403, 429, 500]) test("actual one-shot transport HTTP " + status + " never replays", async () => {
  let auth = 0, posts = 0, committed = false;
  const client = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic-password" }), fetch: async (url, init) => {
    if (String(url).endsWith("/api/auth/login")) { auth++; return Response.json({ data: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600 } }); }
    assert.equal(init?.method, "POST"); assert.equal(committed, true); posts++; return Response.json(response(), { status });
  } });
  try { const r = await client.simulateJsonAfterCommit("/api/tenants/synthetic/integration/simulate", async () => { committed = true; return { body: "{}", committed: "synthetic" }; }); assert.equal(r.response.status, status); assert.equal(auth, 1); assert.equal(posts, 1); }
  finally { client.dispose(); }
});
test("one-shot path is fixed and commit failure never calls paid transport", async () => {
  let count = 0; const client = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic" }), fetch: async () => { count++; return Response.json({ data: { accessToken: "a", refreshToken: "r", expiresIn: 3600 } }); } });
  try {
    for (const path of ["https://evil.invalid", "/api/tenants/synthetic/integration/clients", "/api/tenants/synthetic/integration/simulate?cpf=x"]) await assert.rejects(() => client.simulateJsonAfterCommit(path, async () => ({ body: "{}", committed: null })));
    assert.equal(count, 0); await assert.rejects(() => client.simulateJsonAfterCommit("/api/tenants/synthetic/integration/simulate", async () => { throw Error(); })); assert.equal(count, 1);
  } finally { client.dispose(); }
});
const actor = { id: "synthetic-admin", companyId: "synthetic-platform", role: "ADMIN" as const, email: "synthetic@example.invalid", name: "Synthetic" };
const scope = "synthetic-scope" as never;
function fixture() {
  let operation: Record<string, unknown> | null = null;
  const events: Record<string, unknown>[] = [];
  process.env.OPENCREDIT_PARTNER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const state = { cpf: "00000000000", phone: "5511999999999", active: true, access: true, grantId: "synthetic-grant", revision: 0, identityEnabled: true, owner: "synthetic-identity", purpose: "CREDIT_SIMULATION" };
  const auth = () => ({ id: "synthetic-auth", purpose: state.purpose, active: state.active, revision: state.revision, companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: scope, remoteIdentityId: "synthetic-identity", evidenceInboundEventId: "synthetic-evidence" });
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async () => actor },
    contact: { findUnique: async () => ({ id: "synthetic-contact", companyId: "synthetic-company", cpf: state.cpf, phone: state.phone, archivedAt: null }), findMany: async () => [{ id: "synthetic-contact" }] },
    openCreditCommercialAccess: { findUnique: async () => ({ enabled: state.access }) },
    openCreditRemoteIdentity: { findUnique: async (arg: { where: Record<string, unknown> }) => "providerScope_normalizedCpf" in arg.where ? { id: state.owner } : { id: "synthetic-identity", enabled: state.identityEnabled, companyId: "synthetic-company", providerScope: scope, contactId: "synthetic-contact", normalizedCpf: "00000000000" } },
    openCreditConsumerAuthorization: { findUnique: async () => auth() },
    openCreditConsumerAuthorizationEvent: { findUnique: async () => ({ id: state.grantId, authorizationId: "synthetic-auth", companyId: "synthetic-company", providerScope: scope, revision: state.revision, action: "GRANTED", nextActive: true, evidenceInboundEventId: "synthetic-evidence" }) },
    conversationInboundEvent: { findUnique: async () => ({ id: "synthetic-evidence", companyId: "synthetic-company", contactId: "synthetic-contact", channelId: "synthetic-channel", conversationId: "synthetic-conversation", messageId: "synthetic-message", provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED", provenanceVersion: 1,
      channel: { id: "synthetic-channel", companyId: "synthetic-company" }, conversation: { channelId: "synthetic-channel", contactId: "synthetic-contact", contact: { companyId: "synthetic-company" } }, message: { id: "synthetic-message", conversationId: "synthetic-conversation", direction: "inbound", type: "text", body: "Synthetic correction attestation", providerMessageId: "synthetic-provider" } }) },
    openCreditCommercialOperation: {
      findUnique: async () => operation,
      findFirst: async () => operation && ["IN_FLIGHT", "UNKNOWN"].includes(operation.state as string) ? operation : null,
      create: async ({ data }: { data: Record<string, unknown> }) => operation = { id: "synthetic-operation", ...data },
      updateMany: async ({ where, data }: { where: { state: string; revision: number }; data: Record<string, unknown> }) => {
        if (!operation || operation.state !== where.state || operation.revision !== where.revision) return { count: 0 };
        Object.assign(operation, data); return { count: 1 };
      },
    },
    openCreditCommercialOperationEvent: { create: async ({ data }: { data: Record<string, unknown> }) => { events.push(data); return data; } },
  };
  const db = { $transaction: async (run: (t: typeof tx) => unknown) => run(tx) } as unknown as Parameters<typeof service.dispatchCltSimulation>[0];
  const input = { actor, companyId: "synthetic-company", contactId: "synthetic-contact", ...parameters };
  process.env.PLATFORM_COMPANY_ID = actor.companyId; process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  return { db, input, state, events, current: () => operation, resolve: () => ({ tenantId: "synthetic", providerScope: scope }) };
}

const catalog = () => [{ bankId: parameters.bankId, bankName: "Synthetic bank", capabilities: { simulacaoAtiva: true, suportaParcela: true, suportaLiquido: true } }];
function transport(status = 200, bankStatus: "aprovado" | "recusado" | "pendente" = "aprovado", reasonType: string | null = null) {
  let posts = 0, gets = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "simulateJsonAfterCommit" | "getOnce"> = {
    async simulateJsonAfterCommit(path, commit) {
      assert.equal(path, "/api/tenants/synthetic/integration/simulate"); const execution = await commit(); posts++;
      assert.deepEqual(JSON.parse(execution.body), { ...simulationPayload(parameters, "00000000000"), partnerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
      return { response: Response.json(response(bankStatus, reasonType), { status }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null };
    },
    async getOnce(path) { assert.equal(path, "/api/tenants/synthetic/simulations/synthetic-simulation"); gets++;
      return { response: Response.json({ data: { id: "synthetic-simulation", bankId: parameters.bankId, cpf: "00000000000", tenantId: "synthetic", product: "clt", status: "approved", offers: [offer] } }), sanitizeDiagnosticIdentifier: () => null };
    },
  };
  return { client, posts: () => posts, gets: () => gets };
}
for (const [http, status, expected] of [[200, "aprovado", "SUCCEEDED"], [200, "recusado", "SUCCEEDED"], [200, "pendente", "IN_FLIGHT"], [201, "aprovado", "UNKNOWN"], [401, "aprovado", "UNKNOWN"], [500, "aprovado", "UNKNOWN"]] as const) test("one grant + one POST -> " + http + "/" + status, async () => {
  const f = fixture(), t = transport(http, status);
  const r = await service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => catalog() });
  assert.equal(r.operation.state, expected); assert.equal(t.posts(), 1); assert.equal(t.gets(), 0);
  const again = await service.dispatchCltSimulation(f.db, { ...f.input, amountBRL: "999,00" }, { client: t.client, resolve: f.resolve, banks: async () => catalog() });
  assert.equal(again.operation.operationId, r.operation.operationId); assert.equal(t.posts(), 1);
  assert.equal(f.current()?.intentKey, "simulation-synthetic-grant"); assert.equal(f.events[1].dispatchAuthorizationEventId, "synthetic-grant");
  const diagnostic = String(f.current()?.diagnostic);
  for (const secret of ["00000000000", "PRIVATE_SENTINEL", "1050", "105000", "synthetic@example.invalid"]) assert.equal(diagnostic.includes(secret), false);
  assert.equal(f.events.some(e => e.nextState === "FAILED"), false);
  assert.doesNotThrow(() => parseSimulationReply(r));
});
test("pending stores provider ID; a manual GET completes without another POST", async () => {
  const f = fixture(), t = transport(200, "pendente");
  const r = await service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => catalog() });
  assert.equal(r.operation.displayState, "PENDING"); assert.equal(t.posts(), 1);
  const polled = await service.pollCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve });
  assert.equal(polled.operation.state, "SUCCEEDED"); assert.equal(t.posts(), 1); assert.equal(t.gets(), 1);
});
test("waiting_authorization is not a refusal and does not cause any resend", async () => {
  const f = fixture(), t = transport(200, "recusado", "waiting_authorization");
  const r = await service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => catalog() });
  assert.equal(r.operation.displayState, "PENDING"); assert.equal(t.posts(), 1); assert.equal(t.gets(), 0);
});
for (const error of ["TIMEOUT", "NETWORK"] as const) test(error + " never replays and UNKNOWN cannot poll without ID", async () => {
  const f = fixture(), t = transport(); let posts = 0;
  const client: typeof t.client = { ...t.client, async simulateJsonAfterCommit(_path, commit) { await commit(); posts++; throw new api.OpenCreditApiError(error); } };
  const r = await service.dispatchCltSimulation(f.db, f.input, { client, resolve: f.resolve, banks: async () => catalog() }); assert.equal(r.operation.state, "UNKNOWN");
  await assert.rejects(() => service.pollCltSimulation(f.db, f.input, { client, resolve: f.resolve })); assert.equal(t.gets(), 0); assert.equal(posts, 1);
  await service.dispatchCltSimulation(f.db, f.input, { client, resolve: f.resolve }); assert.equal(posts, 1);
});
for (const purpose of ["CLIENT_PROFILE_UPSERT", "CLIENT_PROFILE_CORRECTION"]) test(purpose + " does not authorize paid simulation", async () => {
  const f = fixture(); f.state.purpose = purpose; const t = transport();
  await assert.rejects(() => service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => catalog() })); assert.equal(t.posts(), 0);
});
for (const capabilities of [{}, { simulacaoAtiva: false }, { simulacaoAtiva: true }, { simulacaoAtiva: true, suportaParcela: false }]) test("absent/disabled mode capability blocks before reservation " + JSON.stringify(capabilities), async () => {
  const f = fixture(), t = transport();
  await assert.rejects(() => service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => [{ bankId: parameters.bankId, bankName: "Synthetic", capabilities }] }));
  assert.equal(t.posts(), 0); assert.equal(f.current(), null);
});
test("unlisted/stale bank cannot be injected", async () => {
  const f = fixture(), t = transport(); await assert.rejects(() => service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => [] })); assert.equal(t.posts(), 0); assert.equal(f.current(), null);
});
test("manual catalog uses fixed tenant/product, preserves absence and false and strips unknown fields", async () => {
  let reads = 0;
  const t = transport();
  const client: typeof t.client = { ...t.client, async getOnce(path) {
    assert.equal(path, "/api/tenants/synthetic/banks?product=clt"); reads++;
    return { response: Response.json({ data: { items: [{ bankId: "synthetic-bank", bankName: "Synthetic", simulacaoAtiva: false, ignored: "PRIVATE" }] } }), sanitizeDiagnosticIdentifier: () => null };
  } };
  const result = await service.readSimulationBanks({ client, resolve: () => ({ tenantId: "synthetic", providerScope: scope }) });
  assert.equal(reads, 1); assert.deepEqual(result, [{ bankId: "synthetic-bank", bankName: "Synthetic", capabilities: { simulacaoAtiva: false } }]);
});
for (const field of ["bankId", "simulationId", "status", "reasonType", "simulationType", "offers"]) test("POST response contract rejects missing bank field " + field, () => {
  const value = response(); Reflect.deleteProperty(value.data.banks[0], field); assert.throws(() => parseSimulationPost(value, parameters.bankId, "00000000000"));
});
test("financial parameters and serialized body do not change during auth/catalog work", async () => {
  const f = fixture(), t = transport();
  const mutable = { ...f.input };
  const r = await service.dispatchCltSimulation(f.db, mutable, { client: t.client, resolve: f.resolve, banks: async () => { mutable.amountBRL = "999,00"; return catalog(); } });
  assert.equal(r.operation.state, "SUCCEEDED"); assert.equal(t.posts(), 1);
  assert.equal(JSON.parse(String(f.current()?.diagnostic)).requestedMode, "parcela");
});
for (const fault of ["scope", "tenant", "credentials", "revoke", "owner", "cpf"]) test("pre-commit change blocks: " + fault, async () => {
  const f = fixture(), t = transport(); let changed = false;
  const old = process.env.OPENCREDIT_API_PASSWORD;
  const resolve = () => ({ tenantId: changed && fault === "tenant" ? "other" : "synthetic", providerScope: changed && fault === "scope" ? "other-scope" as never : scope });
  try {
    await assert.rejects(() => service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve, banks: async () => {
      changed = true; if (fault === "credentials") process.env.OPENCREDIT_API_PASSWORD = "changed-synthetic";
      if (fault === "revoke") f.state.active = false; if (fault === "owner") f.state.owner = "other"; if (fault === "cpf") f.state.cpf = "11111111111";
      return catalog();
    } }));
    assert.equal(t.posts(), 0); assert.equal(f.current(), null);
  } finally { if (old === undefined) delete process.env.OPENCREDIT_API_PASSWORD; else process.env.OPENCREDIT_API_PASSWORD = old; }
});
test("explicit enabled=false blocks, and a non-CLT catalog product is rejected", async () => {
  const f = fixture(), t = transport();
  await assert.rejects(() => service.dispatchCltSimulation(f.db, f.input, { client: t.client, resolve: f.resolve, banks: async () => catalog().map(b => ({ ...b, enabled: false })) })); assert.equal(t.posts(), 0);
  const client: typeof t.client = { ...t.client, async getOnce() { return { response: Response.json({ data: { items: [{ bankId: "synthetic-bank", bankName: "Synthetic", product: "fgts", simulacaoAtiva: true }] } }), sanitizeDiagnosticIdentifier: () => null }; } };
  await assert.rejects(() => service.readSimulationBanks({ client, resolve: f.resolve }));
});
test("missing simulationId is UNKNOWN and cannot poll", async () => {
  const f = fixture(), t = transport();
  const client: typeof t.client = { ...t.client, async simulateJsonAfterCommit(_path, commit) { const e = await commit(); const value = response("pendente"); Reflect.deleteProperty(value.data.banks[0], "simulationId"); return { response: Response.json(value), committed: e.committed, sanitizeDiagnosticIdentifier: () => null }; } };
  const r = await service.dispatchCltSimulation(f.db, f.input, { client, resolve: f.resolve, banks: async () => catalog() }); assert.equal(r.operation.state, "UNKNOWN");
  await assert.rejects(() => service.pollCltSimulation(f.db, f.input, { client, resolve: f.resolve })); assert.equal(t.gets(), 0);
});
for (const invalid of [null, "true", 1, [], {}]) test("present capability is a real boolean only: " + JSON.stringify(invalid), async () => {
  const t = transport(); const client: typeof t.client = { ...t.client, async getOnce() { return { response: Response.json({ data: { items: [{ bankId: "synthetic-bank", bankName: "Synthetic", simulacaoAtiva: invalid }] } }), sanitizeDiagnosticIdentifier: () => null }; } };
  await assert.rejects(() => service.readSimulationBanks({ client, resolve: () => ({ tenantId: "synthetic", providerScope: scope }) }));
});
test("GET polling validates exact persisted ID, CPF, tenant, bank and fixed CLT", () => {
  const data = { id: "synthetic-simulation", bankId: parameters.bankId, cpf: "00000000000", tenantId: "synthetic", product: "clt", status: "pending", offers: [] };
  const expected = { simulationId: data.id, bankId: data.bankId, cpf: data.cpf, tenantId: data.tenantId };
  assert.equal(parseSimulationPoll({ data }, expected).status, "pendente");
  for (const key of ["id", "bankId", "cpf", "tenantId", "product", "status"]) assert.throws(() => parseSimulationPoll({ data: { ...data, [key]: "unexpected" } }, expected));
});
test("pending cannot masquerade as a completed offer set", () => {
  const value = response("pendente"); value.data.banks[0].offers = [offer]; assert.throws(() => parseSimulationPost(value, parameters.bankId, "00000000000"));
  assert.throws(() => parseSimulationPoll({ data: { id: "synthetic-simulation", bankId: parameters.bankId, cpf: "00000000000", tenantId: "synthetic", product: "clt", status: "pending", offers: [offer] } }, { simulationId: "synthetic-simulation", bankId: parameters.bankId, cpf: "00000000000", tenantId: "synthetic" }));
});
test("catalog duplicate JSON is rejected, never truthiness or last-key-wins", async () => {
  const t = transport();
  const client: typeof t.client = { ...t.client, async getOnce() { return { response: new Response('{"data":{"items":[{"bankId":"synthetic-bank","bankName":"Synthetic","simulacaoAtiva":false,"simulacaoAtiva":true}]}}', { headers: { "content-type": "application/json" } }), sanitizeDiagnosticIdentifier: () => null }; } };
  await assert.rejects(() => service.readSimulationBanks({ client, resolve: () => ({ tenantId: "synthetic", providerScope: scope }) }));
});
for (const key of ["commandId", "intentKey", "cpf", "tenantId", "providerScope", "url", "path", "method", "headers", "product", "banks", "valorSolicitado", "partnerId"]) test("browser cannot inject " + key, async () => {
  let calls = 0;
  const h = handler.createCltSimulationHandler("dispatch", { db: {} as never, getSession: async () => actor, requirePlatformAdmin: () => null, enforceLimits: async () => null,
    dispatch: async () => { calls++; throw Error(); } });
  const r = await h(new NextRequest("https://crm.example.invalid/api/dispatch", { method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ companyId: "synthetic-company", contactId: "synthetic-contact", ...parameters, [key]: "forbidden" }) }));
  assert.equal(r.status, 400); assert.equal(calls, 0); assert.equal(r.headers.get("cache-control"), "no-store");
});
for (const failure of ["session", "admin", "origin", "limit", "limiter-failure"]) test("HTTP boundary fails closed before any provider/domain call: " + failure, async () => {
  let calls = 0;
  const h = handler.createCltSimulationHandler("dispatch", { db: {} as never, getSession: async () => failure === "session" ? null : actor,
    requirePlatformAdmin: () => failure === "admin" ? new Response(null, { status: 403 }) : null,
    enforceLimits: async () => { if (failure === "limiter-failure") throw Error("PRIVATE_SENTINEL"); return failure === "limit" ? new Response(null, { status: 429 }) : null; },
    dispatch: async () => { calls++; throw Error(); } });
  const r = await h(new NextRequest("https://crm.example.invalid/api/dispatch", { method: "POST", headers: { origin: failure === "origin" ? "https://evil.invalid" : "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ companyId: "synthetic-company", contactId: "synthetic-contact", ...parameters }) }));
  assert.equal(r.status, failure === "session" ? 401 : ["admin", "origin"].includes(failure) ? 403 : failure === "limit" ? 429 : 503);
  assert.equal(calls, 0); assert.equal(JSON.stringify(await r.json()).includes("PRIVATE_SENTINEL"), false);
});
test("HTTP strict JSON rejects duplicate financial parameter and no server consumer is automatic", async () => {
  let calls = 0;
  const h = handler.createCltSimulationHandler("dispatch", { db: {} as never, getSession: async () => actor, requirePlatformAdmin: () => null, enforceLimits: async () => null,
    dispatch: async () => { calls++; throw Error(); } });
  const r = await h(new NextRequest("https://crm.example.invalid/api/dispatch", { method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: '{"companyId":"synthetic-company","contactId":"synthetic-contact","bankId":"synthetic-bank","mode":"parcela","amountBRL":"1,00","amountBRL":"2,00"}' }));
  assert.equal(r.status, 400); assert.equal(calls, 0);
  const source = readFileSync("src/lib/opencredit-clt-simulation.service.ts", "utf8");
  assert.doesNotMatch(source, /console\.|\/validate|\/proposals|\.request\(|\.patchJsonAfterCommit\(|\.postJsonAfterCommit\(/);
  const client = readFileSync("src/lib/opencredit-api-client.ts", "utf8"); assert.match(client, /false, 130_000/);
});
