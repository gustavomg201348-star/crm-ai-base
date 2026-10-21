import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf, parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { buildOpenCreditClientProfileFromContact } from "./opencredit-contact-client-profile-adapter";
import { serializeOpenCreditClientProfilePayload, type OpenCreditClientProfilePayload } from "./opencredit-client-profile-contract";
import { classifyOpenCreditCreateClientOutcome, type OpenCreditCreateClientObservation } from "./opencredit-create-client-outcome";

const CODES = ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_OPERATION", "INVALID_PROVIDER_SCOPE",
  "INVALID_INTENT_KEY", "INVALID_REVISION", "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CONTACT_ARCHIVED",
  "CONTACT_CPF_MISSING", "CONTACT_CPF_INVALID", "CONTACT_AMBIGUOUS", "COMMERCIAL_ACCESS_MISSING",
  "COMMERCIAL_ACCESS_DISABLED", "IDENTITY_NOT_FOUND", "IDENTITY_DISABLED", "IDENTITY_SNAPSHOT_MISMATCH",
  "IDENTITY_CONFLICT", "PROFILE_INVALID", "INTENT_CONFLICT", "OPERATION_NOT_FOUND", "OPERATION_KIND_MISMATCH",
  "CONSUMER_AUTHORIZATION_MISSING", "CONSUMER_AUTHORIZATION_INACTIVE", "CONSUMER_AUTHORIZATION_MISMATCH", "CONSUMER_AUTHORIZATION_EVENT_INVALID",
  "OPERATION_STATE_INVALID", "OPERATION_STATE_CONFLICT", "OPERATION_REVISION_CONFLICT", "INVALID_OBSERVATION", "CONCURRENT_CONFLICT", "STORAGE_ERROR"] as const;
export type OpenCreditCommercialOperationServiceCode = typeof CODES[number];
export class OpenCreditCommercialOperationServiceError extends Error {
  constructor(readonly code: OpenCreditCommercialOperationServiceCode) {
    super("OPENCREDIT_COMMERCIAL_OPERATION_" + code);
    this.name = "OpenCreditCommercialOperationServiceError";
  }
}

/** Module-stable, closed domain error code only; no getters or retained error. */
export function readOpenCreditCommercialOperationServiceErrorCode(error: unknown): OpenCreditCommercialOperationServiceCode | null {
  try {
    if (!(error instanceof Error)) return null;
    const name = Object.getOwnPropertyDescriptor(error, "name");
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    const message = Object.getOwnPropertyDescriptor(error, "message");
    if (!name || !("value" in name) || name.value !== "OpenCreditCommercialOperationServiceError"
      || !descriptor || !("value" in descriptor) || !message || !("value" in message)) return null;
    const code = CODES.find(candidate => candidate === descriptor.value);
    return code && message.value === "OPENCREDIT_COMMERCIAL_OPERATION_" + code ? code : null;
  } catch { return null; }
}
type Db = Pick<PrismaClient, "$transaction">;
type Common = Readonly<{ actor: SessionUser; companyId: string; providerScope: OpenCreditProviderScope }>;
export type OpenCreditPrepareClientProfileInput = Common & Readonly<{ contactId: string; intentKey: string }>;
export type OpenCreditOperationTransitionInput = Common & Readonly<{ operationId: string; expectedRevision: number }>;
export type OpenCreditCommercialOperationState = "PREPARED" | "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
export type OpenCreditCommercialOperationResult<S extends OpenCreditCommercialOperationState = OpenCreditCommercialOperationState> =
  Readonly<{ changed: boolean; operationId: string; state: S; revision: number }>;
export type OpenCreditClientProfileReservation = Readonly<{
  operationId: string; state: "IN_FLIGHT"; revision: number; profile: OpenCreditClientProfilePayload; profileJson: string;
  dispatchAuthorization: Readonly<{ authorizationId: string; authorizationRevision: number; authorizationEventId: string }>;
}>;
const KIND = "CLIENT_PROFILE_UPSERT";
const STATES: readonly string[] = ["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"];
const MAX_REVISION = 2147483647;
const fail = (code: OpenCreditCommercialOperationServiceCode): never => { throw new OpenCreditCommercialOperationServiceError(code); };
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const email = (v: string) => v.trim().toLowerCase();
function closed(value: unknown, keys: readonly string[], code: OpenCreditCommercialOperationServiceCode): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return fail(code);
    const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return fail(code);
    const own = Reflect.ownKeys(value);
    if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return fail(code);
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const d = Object.getOwnPropertyDescriptor(value, key);
      if (!d || !d.enumerable || !("value" in d)) return fail(code);
      result[key] = d.value;
    }
    return result;
  } catch { return fail(code); }
}
function common(raw: Record<string, unknown>): Common {
  if (!validId(raw.companyId)) return fail("INVALID_COMPANY");
  let providerScope: OpenCreditProviderScope;
  try { providerScope = parseOpenCreditProviderScope(raw.providerScope); } catch { return fail("INVALID_PROVIDER_SCOPE"); }
  const a = closed(raw.actor, ["id", "companyId", "role", "email", "name"], "NOT_AUTHORIZED");
  if (!validId(a.id) || !validId(a.companyId) || a.role !== "ADMIN" || typeof a.email !== "string"
    || !email(a.email) || a.email.length > 254 || typeof a.name !== "string") return fail("NOT_AUTHORIZED");
  const actor: SessionUser = { id: a.id, companyId: a.companyId, role: a.role, email: a.email, name: a.name };
  if (!isPlatformAdmin(actor)) return fail("NOT_AUTHORIZED");
  return { actor, companyId: raw.companyId, providerScope };
}
function prepareInput(value: OpenCreditPrepareClientProfileInput): OpenCreditPrepareClientProfileInput {
  const raw = closed(value, ["actor", "companyId", "providerScope", "contactId", "intentKey"], "INVALID_COMPANY");
  const input = common(raw);
  if (!validId(raw.contactId)) return fail("INVALID_CONTACT");
  if (typeof raw.intentKey !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(raw.intentKey)) return fail("INVALID_INTENT_KEY");
  return { ...input, contactId: raw.contactId, intentKey: raw.intentKey };
}
function transitionInput(value: OpenCreditOperationTransitionInput): OpenCreditOperationTransitionInput {
  const raw = closed(value, ["actor", "companyId", "providerScope", "operationId", "expectedRevision"], "INVALID_OPERATION");
  const input = common(raw);
  if (!validId(raw.operationId)) return fail("INVALID_OPERATION");
  if (typeof raw.expectedRevision !== "number" || !Number.isSafeInteger(raw.expectedRevision)
    || raw.expectedRevision < 0 || raw.expectedRevision >= MAX_REVISION) return fail("INVALID_REVISION");
  return { ...input, operationId: raw.operationId, expectedRevision: raw.expectedRevision };
}
const operationSelect = { id: true, companyId: true, providerScope: true, remoteIdentityId: true, operationKind: true, state: true, revision: true } as const;
const identitySelect = { id: true, companyId: true, contactId: true, providerScope: true, normalizedCpf: true, enabled: true } as const;
type Identity = Prisma.OpenCreditRemoteIdentityGetPayload<{ select: typeof identitySelect }>;
type Operation = Prisma.OpenCreditCommercialOperationGetPayload<{ select: typeof operationSelect }>;
async function authorize(tx: Prisma.TransactionClient, input: Common): Promise<string> {
  const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
  if (!actor || actor.id !== input.actor.id || actor.companyId !== input.actor.companyId || actor.role !== input.actor.role
    || email(actor.email) !== email(input.actor.email) || !isPlatformAdmin({ ...actor, role: input.actor.role })) return fail("NOT_AUTHORIZED");
  if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
  return actor.id;
}
function expectedUnique(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.meta?.modelName !== undefined && error.meta.modelName !== "OpenCreditCommercialOperation") return false;
  const target = error.meta?.target;
  return target === "OCOperation_company_scope_intent_key" || target === "OCOperation_company_scope_identity_kind_key"
    || Array.isArray(target) && (
      target.length === 3 && ["companyId", "providerScope", "intentKey"].every(k => target.includes(k))
      || target.length === 4 && ["companyId", "providerScope", "remoteIdentityId", "operationKind"].every(k => target.includes(k))
    );
}
async function transaction<T>(db: Db, input: Common, preparing: boolean, run: (tx: Prisma.TransactionClient, actorId: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => run(tx, await authorize(tx, input)),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      let semantic: OpenCreditCommercialOperationServiceCode | undefined; let retryable = false;
      try {
        if (error instanceof OpenCreditCommercialOperationServiceError) {
          const d = Object.getOwnPropertyDescriptor(error, "code");
          if (d && "value" in d && CODES.includes(d.value)) semantic = d.value;
        } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
          retryable = error.code === "P2034" || preparing && error.code === "P2002" && expectedUnique(error);
        }
      } catch { /* Do not let hostile/raw exceptions escape the sanitized boundary. */ }
      if (semantic) return fail(semantic);
      if (retryable && attempt < 2) continue;
      return fail(retryable ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR");
    }
  }
  return fail("CONCURRENT_CONFLICT");
}
function operationFacts(operation: Operation, input: Common, preparing = false): void {
  if (operation.companyId !== input.companyId || operation.providerScope !== input.providerScope || operation.operationKind !== KIND) return fail(preparing ? "INTENT_CONFLICT" : "OPERATION_KIND_MISMATCH");
  if (!Number.isSafeInteger(operation.revision) || operation.revision < 0 || operation.revision > MAX_REVISION) return fail("OPERATION_REVISION_CONFLICT");
}
async function fresh(tx: Prisma.TransactionClient, input: Common, contactId: string, linked?: Identity) {
  const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: input.companyId, id: contactId } },
    select: { id: true, companyId: true, name: true, phone: true, email: true, cpf: true, archivedAt: true } });
  if (!contact) return fail("CONTACT_NOT_FOUND");
  if (contact.archivedAt !== null) return fail("CONTACT_ARCHIVED");
  if (contact.cpf === null || contact.cpf === "") return fail("CONTACT_CPF_MISSING");
  let cpf: string;
  try { cpf = canonicalizeOpenCreditOwnershipCpf(contact.cpf); } catch { return fail("CONTACT_CPF_INVALID"); }
  const formatted = cpf.slice(0, 3) + "." + cpf.slice(3, 6) + "." + cpf.slice(6, 9) + "-" + cpf.slice(9);
  const matches = await tx.contact.findMany({ where: { companyId: input.companyId, cpf: { in: [cpf, formatted] } }, take: 2, select: { id: true } });
  if (matches.length !== 1 || matches[0].id !== contactId) return fail("CONTACT_AMBIGUOUS");
  const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: input.companyId, providerScope: input.providerScope } }, select: { enabled: true } });
  if (!access) return fail("COMMERCIAL_ACCESS_MISSING");
  if (!access.enabled) return fail("COMMERCIAL_ACCESS_DISABLED");
  const identity = linked ?? await tx.openCreditRemoteIdentity.findUnique({ where: { companyId_providerScope_contactId: { companyId: input.companyId, providerScope: input.providerScope, contactId } }, select: identitySelect });
  if (!identity) return fail("IDENTITY_NOT_FOUND");
  if (identity.companyId !== input.companyId || identity.contactId !== contactId || identity.providerScope !== input.providerScope) return fail("IDENTITY_CONFLICT");
  if (!identity.enabled) return fail("IDENTITY_DISABLED");
  if (identity.normalizedCpf !== cpf) return fail("IDENTITY_SNAPSHOT_MISMATCH");
  const byCpf = await tx.openCreditRemoteIdentity.findUnique({ where: { providerScope_normalizedCpf: { providerScope: input.providerScope, normalizedCpf: cpf } }, select: { id: true } });
  if (!byCpf || byCpf.id !== identity.id) return fail("IDENTITY_CONFLICT");
  try {
    const profile = buildOpenCreditClientProfileFromContact({ contact, identity: {
      companyId: identity.companyId, contactId: identity.contactId, providerScope: input.providerScope,
      normalizedCpf: identity.normalizedCpf, enabled: identity.enabled
    } });
    return { identity, profile };
  } catch { return fail("PROFILE_INVALID"); }
}
/** Used by the human admin command; preparation alone is not consent or dispatch permission. */
export async function prepareOpenCreditClientProfileOperation(db: Db, supplied: OpenCreditPrepareClientProfileInput): Promise<OpenCreditCommercialOperationResult> {
  const input = prepareInput(supplied);
  return transaction(db, input, true, async (tx, actorId) => {
    const current = await tx.openCreditCommercialOperation.findUnique({ where: { companyId_providerScope_intentKey: { companyId: input.companyId, providerScope: input.providerScope, intentKey: input.intentKey } }, select: operationSelect });
    if (current) {
      operationFacts(current, input, true);
      if (!STATES.includes(current.state)) return fail("OPERATION_STATE_INVALID");
      const identity = await tx.openCreditRemoteIdentity.findUnique({ where: { id_companyId_providerScope: { id: current.remoteIdentityId, companyId: input.companyId, providerScope: input.providerScope } }, select: { companyId: true, providerScope: true, contactId: true } });
      if (!identity || identity.contactId !== input.contactId || identity.companyId !== input.companyId || identity.providerScope !== input.providerScope) return fail("INTENT_CONFLICT");
      return { changed: false, operationId: current.id, state: current.state as OpenCreditCommercialOperationState, revision: current.revision };
    }
    const { identity } = await fresh(tx, input, input.contactId);
    // Single client-profile intention per identity until an explicit future update/sync flow exists.
    // Keep this predicate read and the insert in the same Serializable transaction.
    const existing = await tx.openCreditCommercialOperation.findFirst({ where: {
      companyId: input.companyId, providerScope: input.providerScope, remoteIdentityId: identity.id, operationKind: KIND,
    }, select: { id: true } });
    if (existing) return fail("INTENT_CONFLICT");
    const operation = await tx.openCreditCommercialOperation.create({ data: { companyId: input.companyId, providerScope: input.providerScope,
      remoteIdentityId: identity.id, operationKind: KIND, intentKey: input.intentKey, state: "PREPARED", revision: 0, createdByUserId: actorId }, select: { id: true } });
    await tx.openCreditCommercialOperationEvent.create({ data: { operationId: operation.id, companyId: input.companyId, providerScope: input.providerScope, actorUserId: actorId, action: "PREPARED", previousState: null, nextState: "PREPARED", revision: 0 }, select: { id: true } });
    return { changed: true, operationId: operation.id, state: "PREPARED", revision: 0 };
  });
}
async function loadOperation(tx: Prisma.TransactionClient, input: OpenCreditOperationTransitionInput): Promise<Operation> {
  const operation = await tx.openCreditCommercialOperation.findUnique({ where: { id_companyId_providerScope: { id: input.operationId, companyId: input.companyId, providerScope: input.providerScope } }, select: operationSelect });
  if (!operation) return fail("OPERATION_NOT_FOUND");
  operationFacts(operation, input); return operation;
}
/** Persisted facts only; never imports the separate grant/revoke mutation service. */
async function dispatchAuthorization(tx: Prisma.TransactionClient, input: Common, identity: Identity) {
  const a = await tx.openCreditConsumerAuthorization.findUnique({
    where: { companyId_providerScope_contactId_purpose: { companyId: input.companyId, providerScope: input.providerScope, contactId: identity.contactId, purpose: KIND } },
    select: { id: true, companyId: true, providerScope: true, contactId: true, purpose: true, remoteIdentityId: true, active: true, revision: true, evidenceInboundEventId: true }
  });
  if (!a) return fail("CONSUMER_AUTHORIZATION_MISSING");
  if (!validId(a.id) || a.companyId !== input.companyId || a.providerScope !== input.providerScope || a.contactId !== identity.contactId
    || a.purpose !== KIND || a.remoteIdentityId !== identity.id || typeof a.active !== "boolean"
    || !Number.isSafeInteger(a.revision) || a.revision < 0 || !validId(a.evidenceInboundEventId)) return fail("CONSUMER_AUTHORIZATION_MISMATCH");
  if (!a.active) return fail("CONSUMER_AUTHORIZATION_INACTIVE");
  const e = await tx.openCreditConsumerAuthorizationEvent.findUnique({
    where: { authorizationId_revision: { authorizationId: a.id, revision: a.revision } },
    select: { id: true, authorizationId: true, companyId: true, providerScope: true, revision: true, action: true, nextActive: true, evidenceInboundEventId: true }
  });
  if (!e || !validId(e.id) || e.authorizationId !== a.id || e.companyId !== input.companyId || e.providerScope !== input.providerScope
    || e.revision !== a.revision || e.action !== "GRANTED" || e.nextActive !== true
    || e.evidenceInboundEventId !== a.evidenceInboundEventId) return fail("CONSUMER_AUTHORIZATION_EVENT_INVALID");
  return { authorizationId: a.id, authorizationRevision: a.revision, authorizationEventId: e.id };
}
/** Successful IN_FLIGHT commit is the local commit-to-dispatch point, NOT an HTTP call or replay permission. */
export async function reserveOpenCreditClientProfileOperationForDispatch(db: Db, supplied: OpenCreditOperationTransitionInput): Promise<OpenCreditClientProfileReservation> {
  const input = transitionInput(supplied);
  return transaction(db, input, false, async (tx, actorId) => {
    const operation = await loadOperation(tx, input);
    if (operation.state !== "PREPARED") return fail("OPERATION_STATE_CONFLICT");
    if (operation.revision !== input.expectedRevision) return fail("OPERATION_REVISION_CONFLICT");
    const identity = await tx.openCreditRemoteIdentity.findUnique({ where: { id_companyId_providerScope: { id: operation.remoteIdentityId, companyId: input.companyId, providerScope: input.providerScope } }, select: identitySelect });
    if (!identity) return fail("IDENTITY_NOT_FOUND");
    const { profile } = await fresh(tx, input, identity.contactId, identity);
    const authorization = await dispatchAuthorization(tx, input, identity);
    let profileJson: string;
    try { profileJson = serializeOpenCreditClientProfilePayload(profile); }
    catch { return fail("PROFILE_INVALID"); }
    const revision = input.expectedRevision + 1;
    const result = await tx.openCreditCommercialOperation.updateMany({ where: { id: operation.id, companyId: input.companyId, providerScope: input.providerScope, state: "PREPARED", revision: input.expectedRevision }, data: { state: "IN_FLIGHT", revision } });
    if (result.count !== 1) return fail(result.count === 0 ? "OPERATION_REVISION_CONFLICT" : "STORAGE_ERROR");
    await tx.openCreditCommercialOperationEvent.create({ data: { operationId: operation.id, companyId: input.companyId, providerScope: input.providerScope, actorUserId: actorId, action: "RESERVED_FOR_DISPATCH", previousState: "PREPARED", nextState: "IN_FLIGHT", revision, dispatchAuthorizationEventId: authorization.authorizationEventId }, select: { id: true } });
    return { operationId: operation.id, state: "IN_FLIGHT", revision, profile, profileJson, dispatchAuthorization: authorization };
  });
}
/** Protective classification only: post-dispatch revocation/freshness cannot block UNKNOWN. */
export async function markOpenCreditCommercialOperationUnknown(db: Db, supplied: OpenCreditOperationTransitionInput): Promise<OpenCreditCommercialOperationResult<"UNKNOWN">> {
  const input = transitionInput(supplied);
  return settle(db, input, "UNKNOWN", "MARKED_UNKNOWN");
}
/** Passive post-dispatch fact recording, NOT permission to dispatch or reconcile. */
export async function applyOpenCreditCreateClientObservation(db: Db, supplied: OpenCreditOperationTransitionInput,
  observation: OpenCreditCreateClientObservation): Promise<OpenCreditCommercialOperationResult<"SUCCEEDED" | "UNKNOWN">> {
  // Classify once before opening a transaction; retries reuse this sanitized outcome.
  let outcome: ReturnType<typeof classifyOpenCreditCreateClientOutcome>;
  try { outcome = classifyOpenCreditCreateClientOutcome(observation); }
  catch { return fail("INVALID_OBSERVATION"); }
  const input = transitionInput(supplied);
  if (outcome.state === "UNKNOWN") return settle(db, input, "UNKNOWN", "MARKED_UNKNOWN");
  return settle(db, input, "SUCCEEDED", outcome.created ? "MARKED_SUCCEEDED_CREATED" : "MARKED_SUCCEEDED_UPDATED");
}
/** One terminal CAS definition shared with the existing protective UNKNOWN API. */
async function settle<S extends "SUCCEEDED" | "UNKNOWN">(db: Db, input: OpenCreditOperationTransitionInput, state: S,
  action: S extends "SUCCEEDED" ? "MARKED_SUCCEEDED_CREATED" | "MARKED_SUCCEEDED_UPDATED" : "MARKED_UNKNOWN"):
  Promise<OpenCreditCommercialOperationResult<S>> {
  return transaction(db, input, false, async (tx, actorId) => {
    const operation = await loadOperation(tx, input);
    if (operation.state === state) return { changed: false, operationId: operation.id, state, revision: operation.revision };
    if (operation.state !== "IN_FLIGHT") return fail("OPERATION_STATE_CONFLICT");
    if (operation.revision !== input.expectedRevision) return fail("OPERATION_REVISION_CONFLICT");
    const revision = input.expectedRevision + 1;
    const result = await tx.openCreditCommercialOperation.updateMany({ where: { id: operation.id, companyId: input.companyId, providerScope: input.providerScope, state: "IN_FLIGHT", revision: input.expectedRevision }, data: { state, revision } });
    if (result.count !== 1) return fail(result.count === 0 ? "OPERATION_REVISION_CONFLICT" : "STORAGE_ERROR");
    await tx.openCreditCommercialOperationEvent.create({ data: { operationId: operation.id, companyId: input.companyId, providerScope: input.providerScope, actorUserId: actorId, action, previousState: "IN_FLIGHT", nextState: state, revision }, select: { id: true } });
    return { changed: true, operationId: operation.id, state, revision };
  });
}
