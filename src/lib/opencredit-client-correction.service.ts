import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf } from "./opencredit-commercial-identity-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { openCreditApiClient, readOpenCreditApiErrorCode } from "./opencredit-api-client";
import { readOpenCreditStrictJsonResponse, OpenCreditHttpJsonBoundaryError } from "./opencredit-http-json-boundary";
import { safeDiagnosticId } from "./opencredit-create-client-diagnostic";
import { correctionPayload, correctionPhone, type CorrectionFields } from "./opencredit-client-correction";

const KIND = "CLIENT_PROFILE_CORRECTION";
type Db = Pick<PrismaClient, "$transaction">;
type Input = { actor: SessionUser; companyId: string; contactId: string };
type Config = ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
type Options = { client?: Pick<typeof openCreditApiClient, "patchJsonAfterCommit">; resolve?: () => Config };
type Diagnostic = {
  httpStatus: number | null; requestId: string | null; correlationId: string | null;
  responseReadable: boolean; responseParsed: boolean; providerSuccess: boolean | null;
  dispatchCommittedAt: string | null; respondedAt: string | null;
  settlement: "NOT_CONFIRMED" | "CONFIRMED" | "ERROR";
  stage: "TRANSPORT" | "RESPONSE"; category: "NONE" | "TIMEOUT" | "NETWORK" | "INVALID_RESPONSE" | "NON_SUCCESS";
};
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
export class ClientCorrectionError extends Error {
  constructor(readonly code: "NOT_AUTHORIZED" | "TARGET_NOT_READY" | "UNRESOLVED_CORRECTION" | "CONFIGURATION" | "INVALID_FIELDS" | "STORAGE_UNAVAILABLE" | "PRE_DISPATCH_FAILED" | "SETTLEMENT_FAILED") {
    super("OPENCREDIT_CLIENT_CORRECTION_" + code); this.name = "ClientCorrectionError";
  }
}
const deny = (): never => { throw new ClientCorrectionError("TARGET_NOT_READY"); };
const settings = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 } as const;
const operationSelect = { id: true, companyId: true, providerScope: true, remoteIdentityId: true, operationKind: true, intentKey: true, state: true, revision: true } as const;
type Operation = Prisma.OpenCreditCommercialOperationGetPayload<{ select: typeof operationSelect }>;
function view(o: Operation) {
  if (!id(o.id) || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].includes(o.state) || !Number.isSafeInteger(o.revision) || o.revision < 0) return deny();
  return { operationId: o.id, state: o.state, revision: o.revision };
}
function config(resolve: () => Config) {
  try { return resolve(); } catch { throw new ClientCorrectionError("CONFIGURATION"); }
}
async function target(tx: Prisma.TransactionClient, i: Input, c: Config) {
  if (typeof window !== "undefined" || !id(i.companyId) || !id(i.contactId) || !id(i.actor?.id) || !isPlatformAdmin(i.actor)) throw new ClientCorrectionError("NOT_AUTHORIZED");
  const a = await tx.user.findUnique({ where: { id: i.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
  if (!a || a.role !== "ADMIN" || a.companyId !== i.actor.companyId || a.email.trim().toLowerCase() !== i.actor.email.trim().toLowerCase()
    || !isPlatformAdmin({ ...a, role: "ADMIN" })) throw new ClientCorrectionError("NOT_AUTHORIZED");
  const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: i.companyId, id: i.contactId } }, select: { id: true, companyId: true, cpf: true, phone: true, archivedAt: true } });
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
  const intentKey = "correction-" + grant.id;
  const existing = await tx.openCreditCommercialOperation.findUnique({ where: { companyId_providerScope_intentKey: { companyId: i.companyId, providerScope: c.providerScope, intentKey } }, select: operationSelect });
  if (existing && (existing.remoteIdentityId !== identity.id || existing.operationKind !== KIND || existing.companyId !== i.companyId || existing.providerScope !== c.providerScope)) return deny();
  // Reconciliation remains possible after gate changes; no old row is resumed or reused.
  if (existing) return { cpf: identity.normalizedCpf, phone: contact.phone, identityId: identity.id, grantId: grant.id, authorizationId: auth.id, revision: auth.revision, intentKey, existing };
  if (!auth.active || contact.archivedAt !== null || !identity.enabled) return deny();
  let cpf: string; try { cpf = canonicalizeOpenCreditOwnershipCpf(contact.cpf); correctionPhone(contact.phone); } catch { return deny(); }
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
  const unresolved = await tx.openCreditCommercialOperation.findFirst({ where: { companyId: i.companyId, providerScope: c.providerScope, remoteIdentityId: identity.id, operationKind: KIND, state: { in: ["IN_FLIGHT", "UNKNOWN"] } }, select: { id: true } });
  if (unresolved) throw new ClientCorrectionError("UNRESOLVED_CORRECTION");
  return { cpf, phone: contact.phone, identityId: identity.id, grantId: grant.id, authorizationId: auth.id, revision: auth.revision, intentKey, existing };
}
export async function readClientCorrectionContext(db: Db, i: Input, options: Pick<Options, "resolve"> = {}) {
  const c = config(options.resolve ?? resolveConfiguredOpenCreditProviderContext);
  const t = await db.$transaction(tx => target(tx, i, c), settings);
  let phonePreview: string | null = null;
  try { phonePreview = "(**) *****-" + correctionPhone(t.phone).slice(-4); } catch { if (!t.existing) return deny(); }
  return { ok: true as const, phonePreview, operation: t.existing ? view(t.existing) : null };
}
class ExistingIntent extends Error { constructor(readonly operation: Operation) { super("EXISTING_INTENT"); } }

/** Human-only boundary composition. A callback commit is the only route to the sole PATCH. */
export async function dispatchClientCorrection(db: Db, i: Input & CorrectionFields, options: Options = {}) {
  const resolve = options.resolve ?? resolveConfiguredOpenCreditProviderContext;
  const c = config(resolve);
  const initial = await db.$transaction(tx => target(tx, i, c), settings);
  if (initial.existing) return { ok: true as const, ...view(initial.existing) }; // Never authenticate/replay an existing intent.
  let body: string;
  let payload: ReturnType<typeof correctionPayload>;
  try { payload = Object.freeze(correctionPayload(i, initial.phone)); body = JSON.stringify(payload); } catch { throw new ClientCorrectionError("INVALID_FIELDS"); }
  const credentials = [process.env.OPENCREDIT_API_EMAIL, process.env.OPENCREDIT_API_PASSWORD];
  let reserved: Operation | undefined;
  const diagnostic: Diagnostic = { httpStatus: null, requestId: null, correlationId: null, responseReadable: false, responseParsed: false, providerSuccess: null,
    dispatchCommittedAt: null, respondedAt: null, settlement: "NOT_CONFIRMED", stage: "TRANSPORT", category: "NETWORK" };
  let succeeded = false;
  try {
    const execution = await (options.client ?? openCreditApiClient).patchJsonAfterCommit(`/api/tenants/${c.tenantId}/integration/clients/${initial.cpf}`, async () => {
      const now = config(resolve);
      if (now.tenantId !== c.tenantId || now.providerScope !== c.providerScope || credentials[0] !== process.env.OPENCREDIT_API_EMAIL || credentials[1] !== process.env.OPENCREDIT_API_PASSWORD) return deny();
      reserved = await db.$transaction(async tx => {
        // PostgreSQL production: locks serialize mutable gates with concurrent revocation/edits.
        // Parameterized SELECT only; never mutate auth/contact/access to acquire a lock.
        await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${i.actor.id} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "Contact" WHERE "id" = ${i.contactId} AND "companyId" = ${i.companyId} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditCommercialAccess" WHERE "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditRemoteIdentity" WHERE "id" = ${initial.identityId} AND "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        await tx.$queryRaw`SELECT "id" FROM "OpenCreditConsumerAuthorization" WHERE "id" = ${initial.authorizationId} AND "companyId" = ${i.companyId} AND "providerScope" = ${c.providerScope} FOR SHARE`;
        const current = await target(tx, i, c);
        if (current.existing) throw new ExistingIntent(current.existing);
        if (current.cpf !== initial.cpf || current.phone !== initial.phone || current.identityId !== initial.identityId || current.grantId !== initial.grantId
          || current.authorizationId !== initial.authorizationId || current.revision !== initial.revision) return deny();
        const op = await tx.openCreditCommercialOperation.create({ data: { companyId: i.companyId, providerScope: c.providerScope, remoteIdentityId: current.identityId,
          operationKind: KIND, intentKey: current.intentKey, state: "PREPARED", revision: 0, createdByUserId: i.actor.id }, select: operationSelect });
        await tx.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: i.companyId, providerScope: c.providerScope, actorUserId: i.actor.id,
          action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 } });
        const changed = await tx.openCreditCommercialOperation.updateMany({ where: { id: op.id, companyId: i.companyId, providerScope: c.providerScope, operationKind: KIND, state: "PREPARED", revision: 0 }, data: { state: "IN_FLIGHT", revision: 1 } });
        if (changed.count !== 1) return deny();
        await tx.openCreditCommercialOperationEvent.create({ data: { operationId: op.id, companyId: i.companyId, providerScope: c.providerScope, actorUserId: i.actor.id,
          action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision: 1, dispatchAuthorizationEventId: current.grantId } });
        const beforeCommit = config(resolve);
        if (beforeCommit.tenantId !== c.tenantId || beforeCommit.providerScope !== c.providerScope || credentials[0] !== process.env.OPENCREDIT_API_EMAIL || credentials[1] !== process.env.OPENCREDIT_API_PASSWORD) return deny();
        return { ...op, state: "IN_FLIGHT", revision: 1 };
      }, settings);
      diagnostic.dispatchCommittedAt = new Date().toISOString();
      return { body, committed: reserved };
    });
    const response = execution.response;
    if (!(response instanceof Response) || response.status < 100 || response.status > 599) throw Error();
    diagnostic.stage = "RESPONSE"; diagnostic.httpStatus = response.status; diagnostic.respondedAt = new Date().toISOString(); diagnostic.category = "INVALID_RESPONSE";
    const secrets = [initial.cpf, initial.phone, ...Object.values(payload), ...credentials].filter((v): v is string => typeof v === "string" && v.length > 0);
    const safe = (v: unknown) => { const s = safeDiagnosticId(execution.sanitizeDiagnosticIdentifier(v)); return s && !secrets.some(secret => s.toLowerCase().includes(secret.toLowerCase())) ? s : null; };
    diagnostic.requestId = safe(response.headers.get("x-request-id")); diagnostic.correlationId = safe(response.headers.get("x-correlation-id"));
    const parsed = await readOpenCreditStrictJsonResponse(response);
    diagnostic.responseReadable = true; diagnostic.responseParsed = true;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      diagnostic.requestId ??= safe(parsed.requestId);
      const data = parsed.data;
      if (data && typeof data === "object" && !Array.isArray(data) && typeof data.success === "boolean") diagnostic.providerSuccess = data.success;
    }
    succeeded = response.status === 200 && diagnostic.providerSuccess === true;
    diagnostic.category = succeeded ? "NONE" : "NON_SUCCESS";
  } catch (error) {
    if (!reserved) {
      if (error instanceof ExistingIntent) return { ok: true as const, ...view(error.operation) };
      if (error instanceof ClientCorrectionError) throw error;
      // A losing serializable/unique race may only reconcile; never rerun the commit or transport.
      const current = await db.$transaction(tx => target(tx, i, c), settings);
      if (current.grantId === initial.grantId && current.existing) return { ok: true as const, ...view(current.existing) };
      throw new ClientCorrectionError("PRE_DISPATCH_FAILED");
    }
    diagnostic.category = readOpenCreditApiErrorCode(error) === "TIMEOUT" ? "TIMEOUT" : diagnostic.stage === "RESPONSE" ? "INVALID_RESPONSE" : "NETWORK";
    if (error instanceof OpenCreditHttpJsonBoundaryError) {
      diagnostic.responseReadable = error.code === "INVALID_JSON";
      if (error.code === "TIMEOUT") diagnostic.category = "TIMEOUT";
    }
  }
  if (!reserved) throw new ClientCorrectionError("PRE_DISPATCH_FAILED");
  // Independent diagnostic write survives a failed settlement; never stores a body or payload.
  const where = { id: reserved.id, companyId: i.companyId, providerScope: c.providerScope, operationKind: KIND, state: "IN_FLIGHT", revision: 1 };
  try { await db.$transaction(tx => tx.openCreditCommercialOperation.updateMany({ where, data: { diagnostic: JSON.stringify(diagnostic) } }), settings); } catch { /* Settlement is still attempted, without replay. */ }
  try {
    const state = succeeded ? "SUCCEEDED" : "UNKNOWN";
    await db.$transaction(async tx => {
      const changed = await tx.openCreditCommercialOperation.updateMany({ where, data: { state, revision: 2, diagnostic: JSON.stringify({ ...diagnostic, settlement: "CONFIRMED" }) } });
      if (changed.count !== 1) throw new ClientCorrectionError("SETTLEMENT_FAILED");
      await tx.openCreditCommercialOperationEvent.create({ data: { operationId: reserved!.id, companyId: i.companyId, providerScope: c.providerScope,
        actorUserId: i.actor.id, action: succeeded ? "MARKED_SUCCEEDED_CORRECTED" : "MARKED_UNKNOWN", previousState: "IN_FLIGHT", nextState: state, revision: 2 } });
    }, settings);
    return { ok: true as const, operationId: reserved.id, state, revision: 2 };
  } catch {
    try { await db.$transaction(tx => tx.openCreditCommercialOperation.updateMany({ where, data: { diagnostic: JSON.stringify({ ...diagnostic, settlement: "ERROR" }) } }), settings); } catch { /* No retry or state rewrite. */ }
    throw new ClientCorrectionError("SETTLEMENT_FAILED");
  }
}
