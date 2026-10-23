import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

type Code = "NOT_AUTHORIZED" | "COMPANY_NOT_FOUND" | "CONTACT_NOT_FOUND" | "STORAGE_ERROR";
export class OpenCreditRemoteIdentityContextError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_REMOTE_IDENTITY_CONTEXT_" + code); this.name = "OpenCreditRemoteIdentityContextError"; }
}
type Db = Pick<PrismaClient, "$transaction">;
type Input = Readonly<{ actor: SessionUser; companyId: string; contactId: string; providerScope: OpenCreditProviderScope }>;
const fail = (code: Code): never => { throw new OpenCreditRemoteIdentityContextError(code); };

/** Read-only snapshot. No mutation service composition and no domain mutation. */
export async function getOpenCreditRemoteIdentityContext(db: Db, input: Input) {
  try {
    if (![input.companyId, input.contactId].every(v => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v))) return fail("STORAGE_ERROR");
    parseOpenCreditProviderScope(input.providerScope);
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } });
      if (!actor || actor.companyId !== input.actor.companyId || actor.role !== "ADMIN"
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase()
        || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
      if (!await tx.contact.findUnique({ where: { companyId_id: { companyId: input.companyId, id: input.contactId } }, select: { id: true } })) return fail("CONTACT_NOT_FOUND");
      const access = await tx.openCreditRemoteIdentity.findUnique({
        where: { companyId_providerScope_contactId: { companyId: input.companyId, providerScope: input.providerScope, contactId: input.contactId } }, select: { enabled: true },
      });
      if (access && typeof access.enabled !== "boolean") return fail("STORAGE_ERROR");
      return { ok: true as const, exists: access !== null, enabled: access?.enabled ?? false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) {
    if (error instanceof OpenCreditRemoteIdentityContextError) throw error;
    return fail("STORAGE_ERROR");
  }
}
