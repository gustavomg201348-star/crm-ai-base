import assert from "node:assert/strict";
import { before, test } from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { correctionFields, correctionPhone, correctionPayload } from "./opencredit-client-correction";
let service: typeof import("./opencredit-client-correction.service");
let api: typeof import("./opencredit-api-client");
let handler: typeof import("./opencredit-client-correction-admin-handler");
before(async () => {
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown }; const original = loader._load;
  loader._load = (s, ...args) => s === "server-only" ? {} : original.call(loader, s, ...args);
  try { service = await import("./opencredit-client-correction.service"); api = await import("./opencredit-api-client"); handler = await import("./opencredit-client-correction-admin-handler"); }
  finally { loader._load = original; }
});
const fields = { dataNascimento: "29/02/2000", nomeMae: " Synthetic Mother ", email: " synthetic@example.invalid " };
for (const phone of [null, "", "11999999999", "+5511999999999", "551199999999", "05511999999999", "55 11999999999", "55119999999999", "5511999999999\n"]) test("phone fails closed: " + JSON.stringify(phone), () => assert.throws(() => correctionPhone(phone)));
test("phone removes exactly DDI 55 and payload is exactly four fields", () => {
  const payload = correctionPayload(fields, "5511999999999");
  assert.deepEqual(payload, { data_nascimento: "29/02/2000", nome_mae: "Synthetic Mother", email: "synthetic@example.invalid", celular: "11999999999" });
});
for (const date of ["31/04/2000", "29/02/1900", "00/12/2000", "01/13/2000", "1/01/2000", "01/01/0000", "2020-01-01", "01/01/2000\n"]) test("reject impossible/non-exact date " + date, () => assert.throws(() => correctionFields({ ...fields, dataNascimento: date })));
for (const value of ["", " ", "a\n", "x".repeat(161)]) test("mother name validation " + value.length, () => assert.throws(() => correctionFields({ ...fields, nomeMae: value })));
for (const value of ["", "a", "x@y", "a b@example.invalid", "a@-example.invalid", "x".repeat(255) + "@example.invalid"]) test("email validation " + value.length, () => assert.throws(() => correctionFields({ ...fields, email: value })));
for (const status of [200, 201, 400, 401, 403, 429, 500]) test("one-shot API transport no replay after HTTP " + status, async () => {
  let login = 0, patch = 0, committed = false;
  const client = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic-password" }), fetch: async (_url, init) => {
    if (String(_url).endsWith("/api/auth/login")) { login++; return Response.json({ data: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh", expiresIn: 3600 } }); }
    assert.equal(init?.method, "PATCH"); assert.equal(committed, true); patch++;
    assert.equal(init?.body, JSON.stringify(correctionPayload(fields, "5511999999999")));
    return Response.json({ data: { success: true } }, { status });
  } });
  try {
    const r = await client.patchJsonAfterCommit("/api/tenants/synthetic/integration/clients/00000000000", async () => { committed = true; return { body: JSON.stringify(correctionPayload(fields, "5511999999999")), committed: "synthetic" }; });
    assert.equal(r.response.status, status); assert.equal(login, 1); assert.equal(patch, 1);
  } finally { client.dispose(); }
});
test("pre-commit rejection sends zero PATCH", async () => {
  let patch = 0;
  const client = api.createOpenCreditApiClient({ credentials: () => ({ email: "synthetic@example.invalid", password: "synthetic" }), fetch: async (url) => {
    if (String(url).endsWith("/api/auth/login")) return Response.json({ data: { accessToken: "a", refreshToken: "r", expiresIn: 3600 } });
    patch++; throw Error();
  } });
  try { await assert.rejects(() => client.patchJsonAfterCommit("/api/tenants/synthetic/integration/clients/00000000000", async () => { throw Error("COMMIT_DENIED"); })); assert.equal(patch, 0); }
  finally { client.dispose(); }
});
const actor = { id: "synthetic-admin", companyId: "synthetic-platform", role: "ADMIN" as const, email: "synthetic@example.invalid", name: "Synthetic" };
const scope = "synthetic-scope" as never;
function fixture() {
  let operation: Record<string, unknown> | null = null;
  const events: Record<string, unknown>[] = [];
  const state = { phone: "5511999999999", active: true, access: true, grantId: "synthetic-grant", revision: 0, identityEnabled: true, owner: "synthetic-identity", purpose: "CLIENT_PROFILE_CORRECTION" };
  const auth = () => ({ id: "synthetic-auth", purpose: state.purpose, active: state.active, revision: state.revision, companyId: "synthetic-company", contactId: "synthetic-contact", providerScope: scope, remoteIdentityId: "synthetic-identity", evidenceInboundEventId: "synthetic-evidence" });
  const tx = {
    $queryRaw: async () => [],
    user: { findUnique: async () => actor },
    contact: { findUnique: async () => ({ id: "synthetic-contact", companyId: "synthetic-company", cpf: "00000000000", phone: state.phone, archivedAt: null }), findMany: async () => [{ id: "synthetic-contact" }] },
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
  const db = { $transaction: async (run: (t: typeof tx) => unknown) => run(tx) } as unknown as Parameters<typeof service.dispatchClientCorrection>[0];
  const input = { actor, companyId: "synthetic-company", contactId: "synthetic-contact", ...fields };
  process.env.PLATFORM_COMPANY_ID = actor.companyId; process.env.PLATFORM_ADMIN_EMAILS = actor.email;
  return { db, input, state, events, current: () => operation, resolve: () => ({ tenantId: "synthetic", providerScope: scope }) };
}
for (const [status, success, expected] of [[200, true, "SUCCEEDED"], [200, false, "UNKNOWN"], [201, true, "UNKNOWN"], [401, true, "UNKNOWN"], [500, true, "UNKNOWN"]] as const) test("settlement only exact HTTP 200 success true " + status + "/" + success, async () => {
  const f = fixture(); let patches = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = { async patchJsonAfterCommit(_path, commit) { const execution = await commit(); patches++; return { response: Response.json({ data: { success }, private: "DO_NOT_PERSIST" }, { status }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null }; } };
  const result = await service.dispatchClientCorrection(f.db, f.input, { client, resolve: f.resolve });
  assert.equal(result.state, expected); assert.equal(result.revision, 2); assert.equal(patches, 1);
  const again = await service.dispatchClientCorrection(f.db, f.input, { client, resolve: f.resolve }); assert.equal(again.operationId, result.operationId); assert.equal(patches, 1);
  assert.deepEqual(f.events.map(e => e.action), ["PREPARED", "RESERVED_FOR_DISPATCH", expected === "SUCCEEDED" ? "MARKED_SUCCEEDED_CORRECTED" : "MARKED_UNKNOWN"]);
  assert.equal(f.events[1].dispatchAuthorizationEventId, "synthetic-grant");
  assert.equal(f.current()?.intentKey, "correction-synthetic-grant");
  const diagnostic = String(f.current()?.diagnostic);
  for (const sensitive of ["00000000000", "5511999999999", "Synthetic Mother", "synthetic@example.invalid", "29/02/2000", "DO_NOT_PERSIST"]) assert.equal(diagnostic.includes(sensitive), false);
});
for (const failure of ["TIMEOUT", "NETWORK"] as const) test("post-commit " + failure + " is UNKNOWN with no retry", async () => {
  const f = fixture(); let attempts = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = { async patchJsonAfterCommit(_path, commit) { await commit(); attempts++; throw new api.OpenCreditApiError(failure); } };
  const r = await service.dispatchClientCorrection(f.db, f.input, { client, resolve: f.resolve }); assert.equal(r.state, "UNKNOWN"); assert.equal(attempts, 1);
});
for (const change of ["revoke", "phone", "access", "identity", "owner", "grant"] as const) test("freshness change before reserve blocks: " + change, async () => {
  const f = fixture(); let patches = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = { async patchJsonAfterCommit(_path, commit) {
    if (change === "revoke") f.state.active = false; if (change === "phone") f.state.phone = "5511888888888"; if (change === "access") f.state.access = false;
    if (change === "identity") f.state.identityEnabled = false; if (change === "owner") f.state.owner = "other"; if (change === "grant") f.state.grantId = "other-grant";
    const execution = await commit(); patches++; return { response: Response.json({ data: { success: true } }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null };
  } };
  await assert.rejects(() => service.dispatchClientCorrection(f.db, f.input, { client, resolve: f.resolve })); assert.equal(patches, 0); assert.equal(f.current(), null);
});
test("UPSERT grant cannot authorize CORRECTION", async () => { const f = fixture(); f.state.purpose = "CLIENT_PROFILE_UPSERT"; await assert.rejects(() => service.dispatchClientCorrection(f.db, f.input, { resolve: f.resolve })); });
for (const change of ["tenant", "scope", "credentials"] as const) test("configuration change during authentication blocks before reserve: " + change, async () => {
  const f = fixture(); let changed = false, patches = 0;
  const previous = process.env.OPENCREDIT_API_PASSWORD;
  const resolve = () => ({ tenantId: changed && change === "tenant" ? "other" : "synthetic", providerScope: changed && change === "scope" ? "other-scope" as never : scope });
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = { async patchJsonAfterCommit(_path, commit) {
    changed = true; if (change === "credentials") process.env.OPENCREDIT_API_PASSWORD = "changed-synthetic";
    const execution = await commit(); patches++; return { response: Response.json({ data: { success: true } }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null };
  } };
  try { await assert.rejects(() => service.dispatchClientCorrection(f.db, f.input, { client, resolve })); assert.equal(patches, 0); assert.equal(f.current(), null); }
  finally { if (previous === undefined) delete process.env.OPENCREDIT_API_PASSWORD; else process.env.OPENCREDIT_API_PASSWORD = previous; }
});
test("existing intention stays read-only after gates or payload change", async () => {
  const f = fixture(); let patches = 0;
  const client: Pick<ReturnType<typeof api.createOpenCreditApiClient>, "patchJsonAfterCommit"> = { async patchJsonAfterCommit(_path, commit) { const execution = await commit(); patches++; return { response: Response.json({ data: { success: true } }), committed: execution.committed, sanitizeDiagnosticIdentifier: () => null }; } };
  const first = await service.dispatchClientCorrection(f.db, f.input, { client, resolve: f.resolve });
  f.state.phone = "unusable"; f.state.access = false; f.state.identityEnabled = false;
  assert.deepEqual(await service.dispatchClientCorrection(f.db, { ...f.input, email: "other@example.invalid" }, { client, resolve: f.resolve }), first);
  const context = await service.readClientCorrectionContext(f.db, f.input, { resolve: f.resolve }); assert.equal(context.operation?.operationId, first.operationId); assert.equal(context.phonePreview, null); assert.equal(patches, 1);
});
for (const extra of ["commandId", "cpf", "celular", "providerScope", "tenantId", "path", "method", "headers", "purpose"]) test("browser cannot supply " + extra, async () => {
  let calls = 0;
  const h = handler.createClientCorrectionHandler("dispatch", { db: {} as never, getSession: async () => actor, requirePlatformAdmin: () => null, enforceLimits: async () => null,
    dispatch: async () => { calls++; throw Error(); } });
  const response = await h(new NextRequest("https://crm.example.invalid/api/correction", { method: "POST", headers: { origin: "https://crm.example.invalid", "content-type": "application/json" }, body: JSON.stringify({ companyId: "synthetic-company", contactId: "synthetic-contact", ...fields, [extra]: "forbidden" }) }));
  assert.equal(response.status, 400); assert.equal(calls, 0);
});
test("migration restricts non-correction kinds and unresolved corrections without DML", () => {
  const sql = readFileSync("prisma/migrations/20261028120100_scope_opencredit_correction_intents/migration.sql", "utf8");
  assert.match(sql, /WHERE "operationKind" <> 'CLIENT_PROFILE_CORRECTION'/); assert.match(sql, /"state" IN \('IN_FLIGHT', 'UNKNOWN'\)/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
});
