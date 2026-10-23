import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

type Code = "NOT_AUTHORIZED" | "COMPANY_NOT_FOUND" | "STORAGE_ERROR";
export class OpenCreditCommercialAccessContextError extends Error {
  constructor(readonly code: Code) { super("OPENCREDIT_COMMERCIAL_ACCESS_CONTEXT_" + code); this.name = "OpenCreditCommercialAccessContextError"; }
}
type Db = Pick<PrismaClient, "$transaction">;
type Input = Readonly<{ actor: SessionUser; companyId: string; providerScope: OpenCreditProviderScope }>;
const fail = (code: Code): never => { throw new OpenCreditCommercialAccessContextError(code); };

/** Read-only snapshot. No grant/revoke service composition and no domain mutation. */
export async function getOpenCreditCommercialAccessContext(db: Db, input: Input) {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(input.companyId)) return fail("STORAGE_ERROR");
    parseOpenCreditProviderScope(input.providerScope);
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } });
      if (!actor || actor.companyId !== input.actor.companyId || actor.role !== "ADMIN"
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase()
        || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) return fail("COMPANY_NOT_FOUND");
      const access = await tx.openCreditCommercialAccess.findUnique({
        where: { companyId_providerScope: { companyId: input.companyId, providerScope: input.providerScope } }, select: { enabled: true },
      });
      if (access && typeof access.enabled !== "boolean") return fail("STORAGE_ERROR");
      return { ok: true as const, exists: access !== null, enabled: access?.enabled ?? false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
  } catch (error) {
    if (error instanceof OpenCreditCommercialAccessContextError) throw error;
    return fail("STORAGE_ERROR");
  }
}
