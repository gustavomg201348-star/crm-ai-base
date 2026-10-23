import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { parseCreateClientContext, type CreateClientContext } from "./opencredit-create-client-ui";

const CODES = ["NOT_AUTHORIZED", "INVALID_COMPANY", "INVALID_CONTACT", "INVALID_PROVIDER_SCOPE", "COMPANY_NOT_FOUND", "CONTACT_NOT_FOUND", "CORRUPT_OPERATION", "STORAGE_ERROR"] as const;
type Code = typeof CODES[number];
export class OpenCreditCreateClientContextError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_CREATE_CLIENT_CONTEXT_" + code); this.name = "OpenCreditCreateClientContextError"; }
}
export function readOpenCreditCreateClientContextErrorCode(error: unknown): Code | null {
  try {
    if (!(error instanceof Error)) return null;
    const n = Object.getOwnPropertyDescriptor(error, "name"), c = Object.getOwnPropertyDescriptor(error, "code"), m = Object.getOwnPropertyDescriptor(error, "message");
    if (!n || !("value" in n) || n.value !== "OpenCreditCreateClientContextError" || !c || !("value" in c) || !m || !("value" in m)) return null;
    const code = CODES.find(k => k === c.value);
    return code && m.value === "OPENCREDIT_CREATE_CLIENT_CONTEXT_" + code ? code : null;
  } catch { return null; }
}
const fail = (code: Code): never => { throw new OpenCreditCreateClientContextError(code); };
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
/** Administrative snapshot only: no freshness/active checks and no domain mutations. */
export async function getOpenCreditCreateClientContext(db: Db, value: Input): Promise<CreateClientContext> {
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
      if (!identity) return { ok: true, operation: null };
      if (!id(identity.id)) return fail("CORRUPT_OPERATION");
      const operation = await tx.openCreditCommercialOperation.findUnique({ where: { companyId_providerScope_remoteIdentityId_operationKind: {
        companyId: input.companyId, providerScope: input.providerScope, remoteIdentityId: identity.id, operationKind: "CLIENT_PROFILE_UPSERT",
      } }, select: { id: true, intentKey: true, state: true, revision: true } });
      if (!operation) return { ok: true, operation: null };
      const row = closed(operation, ["id", "intentKey", "state", "revision"], "CORRUPT_OPERATION");
      const result = parseCreateClientContext({ ok: true, operation: { operationId: row.id, commandId: row.intentKey, state: row.state, revision: row.revision } });
      return result ?? fail("CORRUPT_OPERATION");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) { return fail(readOpenCreditCreateClientContextErrorCode(error) ?? "STORAGE_ERROR"); }
}
