import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { canonicalizeOpenCreditOwnershipCpf, parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

export type OpenCreditRemoteIdentityServiceCode =
  | "NOT_AUTHORIZED" | "INVALID_COMPANY" | "INVALID_CONTACT" | "INVALID_PROVIDER_SCOPE"
  | "COMPANY_NOT_FOUND" | "CONTACT_NOT_FOUND" | "CONTACT_ARCHIVED" | "CONTACT_CPF_MISSING"
  | "CONTACT_CPF_INVALID" | "CONTACT_AMBIGUOUS" | "COMMERCIAL_ACCESS_MISSING" | "COMMERCIAL_ACCESS_DISABLED"
  | "IDENTITY_NOT_FOUND" | "OWNERSHIP_CONFLICT" | "IDENTITY_SNAPSHOT_MISMATCH" | "IDENTITY_CONFLICT"
  | "CONCURRENT_CONFLICT" | "STORAGE_ERROR";
export class OpenCreditRemoteIdentityServiceError extends Error {
  constructor(readonly code: OpenCreditRemoteIdentityServiceCode) {
    super("OPENCREDIT_REMOTE_IDENTITY_" + code);
    this.name = "OpenCreditRemoteIdentityServiceError";
  }
}
export type OpenCreditRemoteIdentityInput = Readonly<{
  actor: SessionUser;
  companyId: string;
  contactId: string;
  /** Syntax only: a future trusted server-side resolver must supply this namespace. */
  providerScope: OpenCreditProviderScope;
}>;
export type OpenCreditRemoteIdentityResult = Readonly<{ changed: boolean; enabled: boolean; identityId: string | null }>;
type Db = Pick<PrismaClient, "$transaction">;
type Operation = "CLAIM" | "ENABLE" | "DISABLE";
const fail = (code: OpenCreditRemoteIdentityServiceCode): never => { throw new OpenCreditRemoteIdentityServiceError(code); };
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const email = (v: string) => v.trim().toLowerCase();
function validate(input: OpenCreditRemoteIdentityInput): OpenCreditRemoteIdentityInput {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Reflect.ownKeys(input).some(k => !["actor", "companyId", "contactId", "providerScope"].includes(String(k)))) return fail("INVALID_COMPANY");
    if (!validId(input.companyId)) return fail("INVALID_COMPANY");
    if (!validId(input.contactId)) return fail("INVALID_CONTACT");
    let providerScope: OpenCreditProviderScope;
    try { providerScope = parseOpenCreditProviderScope(input.providerScope); } catch { return fail("INVALID_PROVIDER_SCOPE"); }
    const a = input.actor;
    if (!a || typeof a !== "object" || !validId(a.id) || !validId(a.companyId) || a.role !== "ADMIN"
      || typeof a.name !== "string" || typeof a.email !== "string" || !email(a.email) || a.email.length > 254) return fail("NOT_AUTHORIZED");
    const actor: SessionUser = { id: a.id, companyId: a.companyId, name: a.name, email: a.email, role: a.role };
    if (!isPlatformAdmin(actor)) return fail("NOT_AUTHORIZED");
    return { actor, companyId: input.companyId, contactId: input.contactId, providerScope };
  } catch (error) {
    if (error instanceof OpenCreditRemoteIdentityServiceError) throw error;
    return fail("NOT_AUTHORIZED");
  }
}
const identitySelect = { id: true, companyId: true, contactId: true, providerScope: true, normalizedCpf: true, enabled: true } as const;
function expectedUnique(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.meta?.modelName !== undefined && error.meta.modelName !== "OpenCreditRemoteIdentity") return false;
  const target = error.meta?.target;
  if (typeof target === "string") return ["OCRemote_scope_cpf_key", "OCRemote_company_scope_contact_key"].includes(target);
  return Array.isArray(target) && [ ["providerScope", "normalizedCpf"], ["companyId", "providerScope", "contactId"] ]
    .some(fields => target.length === fields.length && fields.every(f => target.includes(f)));
}
async function transition(db: Db, supplied: OpenCreditRemoteIdentityInput, operation: Operation): Promise<OpenCreditRemoteIdentityResult> {
  const input = validate(supplied);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } });
        if (!actor || actor.id !== input.actor.id || actor.companyId !== input.actor.companyId || actor.role !== input.actor.role
          || email(actor.email) !== email(input.actor.email) || !isPlatformAdmin({ ...actor, role: input.actor.role })) return fail("NOT_AUTHORIZED");
        if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
        const binding = { companyId: input.companyId, providerScope: input.providerScope, contactId: input.contactId };
        const where = { companyId_providerScope_contactId: binding };
        let normalizedCpf: string | undefined;
        if (operation !== "DISABLE") {
          const contact = await tx.contact.findUnique({ where: { companyId_id: { companyId: input.companyId, id: input.contactId } },
            select: { id: true, companyId: true, cpf: true, archivedAt: true } });
          if (!contact) return fail("CONTACT_NOT_FOUND");
          if (contact.archivedAt !== null) return fail("CONTACT_ARCHIVED");
          if (contact.cpf === null || contact.cpf === "") return fail("CONTACT_CPF_MISSING");
          try { normalizedCpf = canonicalizeOpenCreditOwnershipCpf(contact.cpf); } catch { return fail("CONTACT_CPF_INVALID"); }
          // Format only an already canonical 11-digit key. Archived matches deliberately count.
          const formatted = normalizedCpf.slice(0, 3) + "." + normalizedCpf.slice(3, 6) + "." + normalizedCpf.slice(6, 9) + "-" + normalizedCpf.slice(9);
          const matches = await tx.contact.findMany({ where: { companyId: input.companyId, cpf: { in: [normalizedCpf, formatted] } }, take: 2, select: { id: true } });
          if (matches.length === 0) return fail("CONTACT_CPF_INVALID");
          if (matches.length !== 1 || matches[0].id !== input.contactId) return fail("CONTACT_AMBIGUOUS");
          const access = await tx.openCreditCommercialAccess.findUnique({ where: { companyId_providerScope: { companyId: input.companyId, providerScope: input.providerScope } }, select: { enabled: true } });
          if (!access) return fail("COMMERCIAL_ACCESS_MISSING");
          if (!access.enabled) return fail("COMMERCIAL_ACCESS_DISABLED");
        }
        const current = await tx.openCreditRemoteIdentity.findUnique({ where, select: identitySelect });
        if (operation !== "DISABLE") {
          const byCpf = await tx.openCreditRemoteIdentity.findUnique({ where: { providerScope_normalizedCpf: { providerScope: input.providerScope, normalizedCpf: normalizedCpf! } }, select: identitySelect });
          if (current && byCpf && current.id !== byCpf.id) return fail("IDENTITY_CONFLICT");
          if (current && current.normalizedCpf !== normalizedCpf) return fail("IDENTITY_SNAPSHOT_MISMATCH");
          if (byCpf && (byCpf.companyId !== input.companyId || byCpf.contactId !== input.contactId)) return fail("OWNERSHIP_CONFLICT");
          if (current && (!byCpf || current.id !== byCpf.id || current.companyId !== input.companyId
            || current.contactId !== input.contactId || current.providerScope !== input.providerScope)) return fail("IDENTITY_CONFLICT");
          if (!current && byCpf) return fail("IDENTITY_CONFLICT");
        }
        if (!current && operation === "ENABLE") return fail("IDENTITY_NOT_FOUND");
        if (!current && operation === "DISABLE") return { changed: false, enabled: false, identityId: null };
        if (current && (operation === "CLAIM" || current.enabled === (operation === "ENABLE"))) {
          return { changed: false, enabled: current.enabled, identityId: current.id };
        }
        const enabled = operation === "ENABLE";
        const identity = current
          ? await tx.openCreditRemoteIdentity.update({ where, data: { enabled }, select: { id: true } })
          : await tx.openCreditRemoteIdentity.create({ data: { ...binding, normalizedCpf: normalizedCpf!, enabled: false, createdByUserId: actor.id }, select: { id: true } });
        await tx.openCreditRemoteIdentityEvent.create({ data: { remoteIdentityId: identity.id, companyId: input.companyId,
          providerScope: input.providerScope, actorUserId: actor.id, action: operation === "CLAIM" ? "CLAIMED" : enabled ? "ENABLED" : "DISABLED",
          previousEnabled: current?.enabled ?? null, nextEnabled: enabled }, select: { id: true } });
        return { changed: true, enabled, identityId: identity.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof OpenCreditRemoteIdentityServiceError) throw error;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || operation === "CLAIM" && error.code === "P2002" && expectedUnique(error));
      if (retryable && attempt < 2) continue;
      return fail(retryable ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR");
    }
  }
  return fail("CONCURRENT_CONFLICT");
}
/** Reservation only, never consent or authorization for a remote financial operation. No runtime caller exists. */
export async function claimOpenCreditRemoteIdentity(db: Db, input: OpenCreditRemoteIdentityInput): Promise<OpenCreditRemoteIdentityResult> {
  return transition(db, input, "CLAIM");
}
export async function enableOpenCreditRemoteIdentity(db: Db, input: OpenCreditRemoteIdentityInput): Promise<OpenCreditRemoteIdentityResult> {
  return transition(db, input, "ENABLE");
}
export async function disableOpenCreditRemoteIdentity(db: Db, input: OpenCreditRemoteIdentityInput): Promise<OpenCreditRemoteIdentityResult> {
  return transition(db, input, "DISABLE");
}
