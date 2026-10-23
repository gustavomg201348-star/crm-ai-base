import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { parseOpenCreditCreateClientReconciliationContext, type OpenCreditCreateClientReconciliationContext } from "./opencredit-create-client-reconciliation-ui";

const CODES = ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CORRUPT_LEDGER", "STORAGE_ERROR"] as const;
type Code = typeof CODES[number];
export class OpenCreditCreateClientReconciliationContextError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_CREATE_CLIENT_RECONCILIATION_" + code); this.name = "OpenCreditCreateClientReconciliationContextError"; }
}
export function readOpenCreditCreateClientReconciliationContextErrorCode(error: unknown): Code | null {
  try {
    if (!(error instanceof Error)) return null;
    const n = Object.getOwnPropertyDescriptor(error, "name"), c = Object.getOwnPropertyDescriptor(error, "code"), m = Object.getOwnPropertyDescriptor(error, "message");
    if (!n || !("value" in n) || n.value !== "OpenCreditCreateClientReconciliationContextError" || !c || !("value" in c) || !m || !("value" in m)) return null;
    const code = CODES.find(k => k === c.value);
    return code && m.value === "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_" + code ? code : null;
  } catch { return null; }
}
const fail = (code: Code): never => { throw new OpenCreditCreateClientReconciliationContextError(code); };
type Input = Readonly<{ actor: SessionUser; companyId: string; contactId: string; providerScope: OpenCreditProviderScope }>;
type Db = Pick<PrismaClient, "$transaction">;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
function closed(v: unknown, keys: readonly string[], code: Code): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) return fail(code);
  const own = Reflect.ownKeys(v); if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return fail(code);
  const r: Record<string, unknown> = {};
  for (const k of keys) { const d = Object.getOwnPropertyDescriptor(v, k); if (!d || !("value" in d) || !d.enumerable) return fail(code); r[k] = d.value; }
  return r;
}
function time(value: unknown): number {
  try { const ms = Date.prototype.getTime.call(value); if (Number.isFinite(ms)) return ms; } catch { /* Invalid persisted timestamp. */ }
  return fail("CORRUPT_LEDGER");
}
/** Historical facts only; no freshness checks, repairs or domain mutations. */
export async function getOpenCreditCreateClientReconciliationContext(db: Db, value: Input): Promise<OpenCreditCreateClientReconciliationContext> {
  try {
    const r = closed(value, ["actor", "companyId", "contactId", "providerScope"], "INVALID_COMPANY");
    if (!id(r.companyId)) return fail("INVALID_COMPANY"); if (!id(r.contactId)) return fail("INVALID_CONTACT");
    let providerScope: OpenCreditProviderScope;
    try { providerScope = parseOpenCreditProviderScope(r.providerScope); } catch { return fail("INVALID_PROVIDER_SCOPE"); }
    const a = closed(r.actor, ["id", "companyId", "role", "email", "name"], "NOT_AUTHORIZED");
    if (!id(a.id) || !id(a.companyId) || a.role !== "ADMIN" || typeof a.email !== "string" || !a.email.trim() || a.email.length > 254
      || typeof a.name !== "string" || !isPlatformAdmin(a as SessionUser)) return fail("NOT_AUTHORIZED");
    const input = { actor: a as SessionUser, companyId: r.companyId, contactId: r.contactId, providerScope };
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, role: true, email: true, name: true } });
      if (!actor || actor.id !== input.actor.id || actor.companyId !== input.actor.companyId || actor.role !== "ADMIN"
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase() || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
      const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: input.companyId, id: input.contactId } }, select: { id: true, companyId: true } });
      if (!contact || contact.id !== input.contactId || contact.companyId !== input.companyId) return fail("CONTACT_NOT_FOUND");
      const identity = await tx.openCreditRemoteIdentity.findUnique({ where: { companyId_providerScope_contactId: {
        companyId: input.companyId, providerScope: input.providerScope, contactId: input.contactId,
      } }, select: { id: true } });
      if (!identity) return { ok: true, review: null };
      if (!id(identity.id)) return fail("CORRUPT_LEDGER");
      const operation = await tx.openCreditCommercialOperation.findUnique({ where: { companyId_providerScope_remoteIdentityId_operationKind: {
        companyId: input.companyId, providerScope: input.providerScope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT",
      } }, select: { id: true, state: true, revision: true, createdAt: true, updatedAt: true } });
      if (!operation) return { ok: true, review: null };
      const op = closed(operation, ["id", "state", "revision", "createdAt", "updatedAt"], "CORRUPT_LEDGER");
      if (!id(op.id) || !["PREPARED", "IN_FLIGHT", "UNKNOWN", "SUCCEEDED", "FAILED"].some(state => state === op.state)
        || typeof op.revision !== "number" || !Number.isSafeInteger(op.revision) || op.revision < 0
        || time(op.createdAt) > time(op.updatedAt)) return fail("CORRUPT_LEDGER");
      if (op.state !== "IN_FLIGHT" && op.state !== "UNKNOWN") return { ok: true, review: null };
      const count = op.state === "IN_FLIGHT" ? 2 : 3;
      if (op.revision !== count - 1) return fail("CORRUPT_LEDGER");
      const events = await tx.openCreditCommercialOperationEvent.findMany({ where: {
        operationId: op.id, companyId: input.companyId, providerScope: input.providerScope,
      }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 4, select: {
        id: true, action: true, previousState: true, nextState: true, revision: true, createdAt: true, dispatchAuthorizationEventId: true,
      } });
      if (!Array.isArray(events) || Object.getPrototypeOf(events) !== Array.prototype
        || events.length !== count || Reflect.ownKeys(events).length !== count + 1) return fail("CORRUPT_LEDGER");
      const ids = new Set<string>(), timestamps: number[] = [];
      const actions = ["PREPARED", "RESERVED_FOR_DISPATCH", "MARKED_UNKNOWN"];
      const previous = [null, "PREPARED", "IN_FLIGHT"], next = ["PREPARED", "IN_FLIGHT", "UNKNOWN"];
      for (let i = 0; i < count; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(events, String(i));
        if (!descriptor || !("value" in descriptor)) return fail("CORRUPT_LEDGER");
        const e = closed(descriptor.value, ["id", "action", "previousState", "nextState", "revision", "createdAt", "dispatchAuthorizationEventId"], "CORRUPT_LEDGER");
        if (!id(e.id) || ids.has(e.id) || e.action !== actions[i] || e.previousState !== previous[i] || e.nextState !== next[i]
          || e.revision !== i || (i === 1 ? !id(e.dispatchAuthorizationEventId) : e.dispatchAuthorizationEventId !== null)) return fail("CORRUPT_LEDGER");
        ids.add(e.id); timestamps.push(time(e.createdAt));
        if (i > 0 && timestamps[i] < timestamps[i - 1]) return fail("CORRUPT_LEDGER");
      }
      const result = parseOpenCreditCreateClientReconciliationContext({ ok: true, review: {
        operationId: op.id, state: op.state, revision: op.revision,
        reason: op.state === "IN_FLIGHT" ? "DISPATCH_COMMITTED_RESULT_UNCONFIRMED" : "REMOTE_RESULT_AMBIGUOUS",
        preparedAt: new Date(timestamps[0]).toISOString(), dispatchCommittedAt: new Date(timestamps[1]).toISOString(),
        settledAt: count === 3 ? new Date(timestamps[2]).toISOString() : null, dispatchAuthorizationBound: true,
      } });
      return result ?? fail("CORRUPT_LEDGER");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) { return fail(readOpenCreditCreateClientReconciliationContextErrorCode(error) ?? "STORAGE_ERROR"); }
}
