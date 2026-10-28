import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf } from "./opencredit-commercial-identity-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { openCreditApiClient, readOpenCreditApiErrorCode } from "./opencredit-api-client";
import { readOpenCreditStrictJsonResponse, OpenCreditHttpJsonBoundaryError } from "./opencredit-http-json-boundary";
import { safeDiagnosticId } from "./opencredit-create-client-diagnostic";
import { simulationParameters, simulationPayload, simulationId, parseSimulationPost, parseSimulationPoll, type SimulationParameters, type SimulationResult, type SimulationBank } from "./opencredit-clt-simulation";
import { parseOpenCreditBankCapabilities } from "./opencredit-banks";

const KIND = "CREDIT_SIMULATION";
type Db = Pick<PrismaClient, "$transaction">;
type Input = { actor: SessionUser; companyId: string; contactId: string };
type Config = ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
type Options = { client?: Pick<typeof openCreditApiClient, "simulateJsonAfterCommit" | "getOnce">; resolve?: () => Config; banks?: () => Promise<SimulationBank[]> };

const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
export class CltSimulationError extends Error {
  constructor(readonly code: "NOT_AUTHORIZED" | "TARGET_NOT_READY" | "UNRESOLVED_SIMULATION" | "CONFIGURATION" | "INVALID_FIELDS" | "STORAGE_UNAVAILABLE" | "PRE_DISPATCH_FAILED" | "SETTLEMENT_FAILED") {
    super("OPENCREDIT_CLT_SIMULATION_" + code); this.name = "CltSimulationError";
  }
}
const deny = (): never => { throw new CltSimulationError("TARGET_NOT_READY"); };
const settings = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 } as const;
const operationSelect = { id: true, companyId: true, providerScope: true, remoteIdentityId: true, operationKind: true, intentKey: true, state: true, revision: true, diagnostic: true } as const;
type Operation = Prisma.OpenCreditCommercialOperationGetPayload<{ select: typeof operationSelect }>;
function view(o: Operation) {
  if (!id(o.id) || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(o.state) || !Number.isSafeInteger(o.revision) || o.revision < 0) return deny();
  return { operationId: o.id, state: o.state, revision: o.revision };
}
function config(resolve: () => Config) {
  try { return resolve(); } catch { throw new CltSimulationError("CONFIGURATION"); }
}
async function target(tx: Prisma.TransactionClient, i: Input, c: Config, inspectOnly = false) {
  if (typeof window !== "undefined" || !id(i.companyId) || !id(i.contactId) || !id(i.actor?.id) || !isPlatformAdmin(i.actor)) throw new CltSimulationError("NOT_AUTHORIZED");
  const a = await tx.user.findUnique({ where: { id: i.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
  if (!a || a.role !== "ADMIN" || a.companyId !== i.actor.companyId || a.email.trim().toLowerCase() !== i.actor.email.trim().toLowerCase()
    || !isPlatformAdmin({ ...a, role: "ADMIN" })) throw new CltSimulationError("NOT_AUTHORIZED");
  const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: i.companyId, id: i.contactId } }, select: { id: true, companyId: true, cpf: true, archivedAt: true } });
  if (!contact || contact.companyId !== i.companyId || contact.id !== i.contactId) return deny();
  const identity = await tx.openCreditRemoteIdentity.findUnique({ where: { companyId_providerScope_contactId: { companyId: i.companyId, providerScope: c.providerScope, contactId: i.contactId } } });
  if (!identity || identity.companyId !== i.companyId || identity.providerScope !== c.providerScope || identity.contactId !== i.contactId) return deny();
  const auth = await tx.openCreditConsumerAuthorization.findUnique({ where: { companyId_providerScope_contactId_purpose: { companyId: i.companyId, providerScope: c.providerScope, contactId: i.contactId, purpose: KIND } } });
  if (!auth || typeof auth.active !== "boolean" || auth.purpose !== KIND || auth.companyId !== i.companyId || auth.providerScope !== c.providerScope || auth.contactId !== i.contactId
    || auth.remoteIdentityId !== identity.id || !Number.isSafeInteger(auth.revision) || auth.revision < 0) return deny();
  // A revoked authorization's previous revision is its last GRANTED. Reading it grants no dispatch authority.
  const grantRevision = auth.active ? auth.revision : auth.revision - 1;
  if (grantRevision < 0) return deny();
  const grant = await tx.openCreditConsumerAuthorizationEvent.findUnique({ where: { authorizationId_revision: { authorizationId: auth.id, revision: grantRevision } } });
  if (!grant || !id(grant.id) || grant.action !== "GRANTED" || grant.nextActive !== true || grant.authorizationId !== auth.id || grant.revision !== grantRevision
    || grant.companyId !== i.companyId || grant.providerScope !== c.providerScope || grant.evidenceInboundEventId !== auth.evidenceInboundEventId) return deny();
  const intentKey = "simulation-" + grant.id;
  const existing = await tx.openCreditCommercialOperation.findUnique({ where: { companyId_providerScope_intentKey: { companyId: i.companyId, providerScope: c.providerScope, intentKey } }, select: operationSelect });
  if (existing && (existing.remoteIdentityId !== identity.id || existing.operationKind !== KIND || existing.companyId !== i.companyId || existing.providerScope !== c.providerScope)) return deny();
  // Reconciliation remains possible after gate changes; no old row is resumed or reused.
  if (existing) return { cpf: identity.normalizedCpf, identityId: identity.id, grantId: grant.id, authorizationId: auth.id, revision: auth.revision, intentKey, existing };
  if (!auth.active || contact.archivedAt !== null || !identity.enabled) return deny();
  let cpf: string; try { cpf = canonicalizeOpenCreditOwnershipCpf(contact.cpf); } catch { return deny(); }
  if (identity.normalizedCpf !== cpf) return deny();
  const formatted = cpf.slice(0, 3) + "." + cpf.slice(3, 6) + "." + cpf.slice(6, 9) + "-" + cpf.slice(9);
  const matches = await tx.contact.findMany({ where: { companyId: i.companyId, cpf: { in: [cpf, formatted] } }, select: { id: true }, take: 2 });
  if (matches.length !== 1 || matches[0].id !== i.contactId) return deny();
  const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: i.companyId, providerScope: c.providerScope } }, select: { enabled: true } });
  if (access?.enabled !== true) return deny();
  const owner = await tx.openCreditRemoteIdentity.findUnique({ where: { providerScope_normalizedCpf: { providerScope: c.providerScope, normalizedCpf: cpf } }, select: { id: true } });
  if (owner?.id !== identity.id) return deny();
  const evidence = await tx.conversationInboundEvent.findUnique({ where: { id: auth.evidenceInboundEventId }, include: { message: true, conversation: { include: { contact: { select: { companyId: true } } } }, channel: { select: { companyId: true, id: true } } } });
  if (!evidence || evidence.companyId !== i.companyId || evidence.contactId !== i.contactId || !evidence.channelId || evidence.channel?.companyId !== i.companyId
    || evidence.provenanceKind !== "META_WEBHOOK_HMAC_SHA256_VERIFIED" || evidence.provenanceVersion !== 1
    || evidence.conversation.contactId !== i.contactId || evidence.conversation.contact.companyId !== i.companyId || evidence.conversation.channelId !== evidence.channelId
    || evidence.message.id !== evidence.messageId || evidence.message.conversationId !== evidence.conversationId || evidence.message.direction !== "inbound"
    || evidence.message.type !== "text" || !evidence.message.body?.trim() || !evidence.message.providerMessageId?.trim()) return deny();
  const unresolved = await tx.openCreditCommercialOperation.findFirst({ where: { companyId: i.companyId, providerScope: c.providerScope, remoteIdentityId: identity.id, operationKind: KIND, state: { in: ["IN_FLIGHT", "UNKNOWN"] } }, select: operationSelect });
  if (unresolved && !inspectOnly) throw new CltSimulationError("UNRESOLVED_SIMULATION");
  if (unresolved) return { cpf, identityId: identity.id, grantId: grant.id, authorizationId: auth.id, revision: auth.revision, intentKey, existing: unresolved };
  return { cpf, identityId: identity.id, grantId: grant.id, authorizationId: auth.id, revision: auth.revision, intentKey, existing };
}

type Diagnostic = { bankId: string; requestedMode: SimulationParameters["mode"]; simulationId: string | null; httpStatus: number | null; requestId: string | null; correlationId: string | null;
  responseReadable: boolean; responseParsed: boolean; dispatchCommittedAt: string | null; respondedAt: string | null;
  settlement: "NOT_CONFIRMED" | "CONFIRMED"; stage: "TRANSPORT" | "RESPONSE" | "POLL";
  category: "NONE" | "PENDING" | "TIMEOUT" | "NETWORK" | "INVALID_RESPONSE"; providerStatus: SimulationResult["status"] | null };
function diagnosticRead(raw: string | null): Diagnostic | null {
  try {
    const d: unknown = JSON.parse(raw ?? "null");
    if (!d || typeof d !== "object" || Array.isArray(d)) return null;
    const r = d as Diagnostic;
    const keys = ["bankId", "requestedMode", "simulationId", "httpStatus", "requestId", "correlationId", "responseReadable", "responseParsed", "dispatchCommittedAt", "respondedAt", "settlement", "stage", "category", "providerStatus"];
    if (Object.keys(d).length !== keys.length || Object.keys(d).some(k => !keys.includes(k))) return null;
    simulationId(r.bankId); if (r.simulationId !== null) simulationId(r.simulationId);
    if (!["maximum", "parcela", "liberado"].includes(r.requestedMode) || r.httpStatus !== null && (!Number.isInteger(r.httpStatus) || r.httpStatus < 100 || r.httpStatus > 599)
      || typeof r.responseReadable !== "boolean" || typeof r.responseParsed !== "boolean"
      || !["NOT_CONFIRMED", "CONFIRMED"].includes(r.settlement) || !["TRANSPORT", "RESPONSE", "POLL"].includes(r.stage)
      || !["NONE", "PENDING", "TIMEOUT", "NETWORK", "INVALID_RESPONSE"].includes(r.category)
      || r.providerStatus !== null && !["aprovado", "recusado", "pendente", "waiting_authorization"].includes(r.providerStatus)
      || r.dispatchCommittedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.dispatchCommittedAt)
      || r.respondedAt !== null && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(r.respondedAt)) return null;
    for (const value of [r.requestId, r.correlationId]) if (value !== null && safeDiagnosticId(value) !== value) return null;
    return r;
  } catch { return null; }
}
function operationView(o: Operation) {
  const diagnostic = diagnosticRead(o.diagnostic);
  return { ...view(o), displayState: o.state === "IN_FLIGHT" && diagnostic?.simulationId && ["pendente", "waiting_authorization"].includes(diagnostic.providerStatus ?? "") ? "PENDING" : o.state, diagnostic };
}
/** Manual catalog read only, fixed tenant + CLT; no bank/account details or PII escape. */
export async function readSimulationBanks(options: Options = {}): Promise<SimulationBank[]> {
  const resolve = options.resolve ?? resolveConfiguredOpenCreditProviderContext, c = config(resolve);
  const execution = await (options.client ?? openCreditApiClient).getOnce(`/api/tenants/${c.tenantId}/banks?product=clt`);
  if (execution.response.status !== 200) { void execution.response.body?.cancel().catch(() => {}); return deny(); }
  const payload = await readOpenCreditStrictJsonResponse(execution.response);
  const banks = parseOpenCreditBankCapabilities(payload);
  const now = config(resolve);
  if (!banks || now.tenantId !== c.tenantId || now.providerScope !== c.providerScope || new Set(banks.map(b => b.bankId)).size !== banks.length) return deny();
  const rawItems = (payload as { data: { items: Record<string, unknown>[] } }).data.items;
  return banks.map((b, index) => {
    simulationId(b.bankId); const raw = rawItems[index];
    if (/[\u0000-\u001f\u007f]/.test(b.bankName) || Object.hasOwn(raw, "product") && raw.product !== "clt"
      || Object.hasOwn(raw, "enabled") && typeof raw.enabled !== "boolean") return deny();
    return { bankId: b.bankId, bankName: b.bankName, capabilities: { ...b.capabilities }, ...(Object.hasOwn(raw, "enabled") ? { enabled: raw.enabled as boolean } : {}) };
  });
}
function selectedBank(banks: SimulationBank[], p: SimulationParameters) {
  const matches = banks.filter(b => b.bankId === p.bankId);
  if (matches.length !== 1 || matches[0].enabled === false || matches[0].capabilities.simulacaoAtiva !== true
    || p.mode === "parcela" && matches[0].capabilities.suportaParcela !== true || p.mode === "liberado" && matches[0].capabilities.suportaLiquido !== true) return deny();
}
export async function readSimulationContext(db: Db, i: Input, options: Options = {}) {
  const c = config(options.resolve ?? resolveConfiguredOpenCreditProviderContext);
  const t = await db.$transaction(tx => target(tx, i, c, true), settings);
  return { ok: true as const, operation: t.existing ? operationView(t.existing) : null };
}
class ExistingSimulation extends Error { constructor(readonly operation: Operation) { super("EXISTING_SIMULATION"); } }
const pending = (r: SimulationResult) => r.status === "pendente" || r.status === "waiting_authorization";
async function record(db: Db, i: Input, c: Config, op: Operation, diagnostic: Diagnostic, result: SimulationResult | null) {
  const state = result ? pending(result) ? "IN_FLIGHT" : "SUCCEEDED" : "UNKNOWN";
  const expected = { id: op.id, companyId: i.companyId, providerScope: c.providerScope, operationKind: KIND, state: "IN_FLIGHT", revision: op.revision };
  // Independent technical snapshot survives terminal transaction failure. No payload/offers are persisted.
  await db.$transaction(tx => tx.openCreditCommercialOperation.updateMany({ where: expected, data: { diagnostic: JSON.stringify(diagnostic) } }), settings).catch(() => {});
  const revision = op.revision + 1;
  await db.$transaction(async tx => {
    const changed = await tx.openCreditCommercialOperation.updateMany({ where: expected, data: { state, revision, diagnostic: JSON.stringify({ ...diagnostic, settlement: "CONFIRMED" }) } });
    if (changed.count !== 1) throw new CltSimulationError("SETTLEMENT_FAILED");
    await tx.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: i.companyId, providerScope: c.providerScope, actorUserId: i.actor.id,
      action: state === "SUCCEEDED" ? "SIMULATION_COMPLETED" : state === "UNKNOWN" ? "MARKED_UNKNOWN" : "SIMULATION_PENDING", previousState: "IN_FLIGHT", nextState: state, revision } });
  }, settings);
  return { ok: true as const, operation: { operationId: op.id, state, revision, displayState: state === "IN_FLIGHT" ? "PENDING" : state, diagnostic: { ...diagnostic, settlement: "CONFIRMED" as const } }, result };
}
/** Auth -> current catalog -> frozen payload -> durable reservation -> one paid POST. */
export async function dispatchCltSimulation(db: Db, i: Input & SimulationParameters, options: Options = {}) {
  const resolve = options.resolve ?? resolveConfiguredOpenCreditProviderContext, c = config(resolve);
  const initial = await db.$transaction(tx => target(tx, i, c), settings);
  if (initial.existing) return { ok: true as const, operation: operationView(initial.existing), result: null };
  let parameters: SimulationParameters;
  try { parameters = Object.freeze(simulationParameters(i)); } catch { throw new CltSimulationError("INVALID_FIELDS"); }
  // Public request says ADMIN requires UUID; OPERATOR ignores it. Always server-derived, never token claims/browser.
  const partner = process.env.OPENCREDIT_PARTNER_ID;
  if (!partner || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(partner)) throw new CltSimulationError("CONFIGURATION");
  const credentials = [process.env.OPENCREDIT_API_EMAIL, process.env.OPENCREDIT_API_PASSWORD];
  const body = JSON.stringify({ ...simulationPayload(parameters, initial.cpf), partnerId: partner });
  let reserved: Operation | undefined;
  let result: SimulationResult | null = null;
  const diagnostic: Diagnostic = { bankId: parameters.bankId, requestedMode: parameters.mode, simulationId: null, httpStatus: null, requestId: null, correlationId: null, responseReadable: false, responseParsed: false,
    dispatchCommittedAt: null, respondedAt: null, settlement: "NOT_CONFIRMED", stage: "TRANSPORT", category: "NETWORK", providerStatus: null };
  const unchanged = () => { const now = config(resolve); if (now.tenantId !== c.tenantId || now.providerScope !== c.providerScope || partner !== process.env.OPENCREDIT_PARTNER_ID
    || credentials[0] !== process.env.OPENCREDIT_API_EMAIL || credentials[1] !== process.env.OPENCREDIT_API_PASSWORD) return deny(); };
  try {
    const execution = await (options.client ?? openCreditApiClient).simulateJsonAfterCommit(`/api/tenants/${c.tenantId}/integration/simulate`, async () => {
      selectedBank(await (options.banks ?? (() => readSimulationBanks(options)))(), parameters); unchanged();
      reserved = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${i.actor.id} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${i.contactId} AND "companyId" = ${i.companyId} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditCommercialAccess" WHERE "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditRemoteIdentity" WHERE "id" = ${initial.identityId} AND "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditConsumerAuthorization" WHERE "id" = ${initial.authorizationId} AND "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        const current = await target(tx, i, c);
        if (current.existing) throw new ExistingSimulation(current.existing);
        if (current.cpf !== initial.cpf || current.identityId !== initial.identityId || current.grantId !== initial.grantId || current.revision !== initial.revision || current.authorizationId !== initial.authorizationId) return deny();
        const op = await tx.openCreditCommercialOperation.create({ data: { companyId: i.companyId, providerScope: c.providerScope, remoteIdentityId: current.identityId,
          operationKind: KIND, intentKey: current.intentKey, state: "PREPARED", revision: 0, createdByUserId: i.actor.id, diagnostic: JSON.stringify(diagnostic) }, select: operationSelect });
        await tx.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: i.companyId, providerScope: c.providerScope, actorUserId: i.actor.id, action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 } });
        const changed = await tx.openCreditCommercialOperation.updateMany({ where: { id: op.id, companyId: i.companyId, providerScope: c.providerScope, operationKind: KIND, state: "PREPARED", revision: 0 }, data: { state: "IN_FLIGHT", revision: 1 } });
        if (changed.count !== 1) return deny();
        await tx.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: i.companyId, providerScope: c.providerScope, actorUserId: i.actor.id, action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision: 1, dispatchAuthorizationEventId: current.grantId } });
        unchanged(); return { ...op, state: "IN_FLIGHT", revision: 1 };
      }, settings);
      diagnostic.dispatchCommittedAt = new Date().toISOString(); return { body, committed: reserved };
    });
    diagnostic.stage = "RESPONSE"; diagnostic.respondedAt = new Date().toISOString(); diagnostic.httpStatus = execution.response.status;
    const safe = (v: unknown) => { const value = safeDiagnosticId(execution.sanitizeDiagnosticIdentifier(v)); return value && ![initial.cpf, partner, ...credentials].some(secret => secret && value.includes(secret)) ? value : null; };
    diagnostic.requestId = safe(execution.response.headers.get("x-request-id")); diagnostic.correlationId = safe(execution.response.headers.get("x-correlation-id"));
    const payload = await readOpenCreditStrictJsonResponse(execution.response); diagnostic.responseReadable = true; diagnostic.responseParsed = true;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) diagnostic.requestId ??= safe(payload.requestId);
    if (execution.response.status !== 200) throw Error();
    result = parseSimulationPost(payload, parameters.bankId, initial.cpf); diagnostic.simulationId = result.simulationId;
    diagnostic.providerStatus = result.status; diagnostic.category = pending(result) ? "PENDING" : "NONE";
  } catch (error) {
    if (!reserved) {
      if (error instanceof ExistingSimulation) return { ok: true as const, operation: operationView(error.operation), result: null };
      if (error instanceof CltSimulationError) throw error;
      const current = await db.$transaction(tx => target(tx, i, c), settings);
      if (current.grantId === initial.grantId && current.existing) return { ok: true as const, operation: operationView(current.existing), result: null };
      throw new CltSimulationError("PRE_DISPATCH_FAILED");
    }
    result = null;
    diagnostic.category = readOpenCreditApiErrorCode(error) === "TIMEOUT" || error instanceof OpenCreditHttpJsonBoundaryError && error.code === "TIMEOUT" ? "TIMEOUT"
      : diagnostic.stage === "TRANSPORT" ? "NETWORK" : "INVALID_RESPONSE";
    if (error instanceof OpenCreditHttpJsonBoundaryError && error.code === "INVALID_JSON") diagnostic.responseReadable = true;
  }
  if (!reserved) throw new CltSimulationError("PRE_DISPATCH_FAILED");
  return record(db, i, c, reserved, diagnostic, result);
}
/** One bounded manual provider GET, never a second POST. Local CAS records a conclusive observation. */
export async function pollCltSimulation(db: Db, i: Input, options: Options = {}) {
  const c = config(options.resolve ?? resolveConfiguredOpenCreditProviderContext);
  const t = await db.$transaction(tx => target(tx, i, c, true), settings), op = t.existing;
  if (!op) return deny();
  const d = diagnosticRead(op.diagnostic);
  if (!["IN_FLIGHT", "SUCCEEDED"].includes(op.state) || !d?.simulationId || op.state === "IN_FLIGHT" && !["pendente", "waiting_authorization"].includes(d.providerStatus ?? "")) return deny();
  try {
    const execution = await (options.client ?? openCreditApiClient).getOnce(`/api/tenants/${c.tenantId}/simulations/${simulationId(d.simulationId)}`);
    if (execution.response.status !== 200) { void execution.response.body?.cancel().catch(() => {}); throw Error(); }
    const payload = await readOpenCreditStrictJsonResponse(execution.response);
    const result = parseSimulationPoll(payload, { simulationId: d.simulationId, bankId: d.bankId, cpf: t.cpf, tenantId: c.tenantId });
    const now = config(options.resolve ?? resolveConfiguredOpenCreditProviderContext);
    if (now.tenantId !== c.tenantId || now.providerScope !== c.providerScope) return deny();
    const current = await db.$transaction(tx => target(tx, i, c, true), settings);
    if (current.cpf !== t.cpf || current.identityId !== t.identityId || current.existing?.id !== op.id) return deny();
    if (op.state === "SUCCEEDED") return { ok: true as const, operation: operationView(op), result };
    const safe = (v: unknown) => { const value = safeDiagnosticId(execution.sanitizeDiagnosticIdentifier(v)); return value && !value.includes(t.cpf) ? value : null; };
    return await record(db, i, c, op, { ...d, requestId: safe(execution.response.headers.get("x-request-id")), correlationId: safe(execution.response.headers.get("x-correlation-id")), stage: "POLL", respondedAt: new Date().toISOString(), httpStatus: 200, responseReadable: true, responseParsed: true, providerStatus: result.status, category: pending(result) ? "PENDING" : "NONE", settlement: "NOT_CONFIRMED" }, result);
  } catch {
    const current = await db.$transaction(tx => target(tx, i, c, true), settings);
    return { ok: true as const, operation: current.existing ? operationView(current.existing) : operationView(op), result: null, pollUnavailable: true };
  }
}
