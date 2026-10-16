import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

export type OpenCreditCommercialAccessServiceCode =
  | "NOT_AUTHORIZED" | "INVALID_COMPANY" | "INVALID_PROVIDER_SCOPE"
  | "COMPANY_NOT_FOUND" | "CONCURRENT_CONFLICT" | "STORAGE_ERROR";

export class OpenCreditCommercialAccessServiceError extends Error {
  constructor(readonly code: OpenCreditCommercialAccessServiceCode) {
    super("OPENCREDIT_COMMERCIAL_ACCESS_" + code);
    this.name = "OpenCreditCommercialAccessServiceError";
  }
}

export type OpenCreditCommercialAccessInput = Readonly<{
  actor: SessionUser;
  companyId: string;
  /** Syntax is checked, trust is not: a future caller MUST resolve this server-side. */
  providerScope: OpenCreditProviderScope;
}>;
export type OpenCreditCommercialAccessResult = Readonly<{
  changed: boolean;
  enabled: boolean;
  accessId: string | null;
}>;
type Db = Pick<PrismaClient, "$transaction">;
const validId = (value: unknown): value is string => typeof value === "string"
  && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value);
const normalizedEmail = (value: string) => value.trim().toLowerCase();
const fail = (code: OpenCreditCommercialAccessServiceCode): never => { throw new OpenCreditCommercialAccessServiceError(code); };

function validate(input: OpenCreditCommercialAccessInput): OpenCreditCommercialAccessInput {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return fail("INVALID_COMPANY");
    // These facts are derived by this service, never caller-controlled.
    if (Object.keys(input).some(key => !["actor", "companyId", "providerScope"].includes(key))) return fail("INVALID_COMPANY");
    const companyId = input.companyId;
    if (!validId(companyId)) return fail("INVALID_COMPANY");
    let providerScope: OpenCreditProviderScope;
    try { providerScope = parseOpenCreditProviderScope(input.providerScope); }
    catch { return fail("INVALID_PROVIDER_SCOPE"); }
    const actor = input.actor;
    if (!actor || typeof actor !== "object" || !validId(actor.id) || !validId(actor.companyId)
      || typeof actor.email !== "string" || !normalizedEmail(actor.email) || actor.email.length > 254
      || typeof actor.name !== "string" || actor.role !== "ADMIN") return fail("NOT_AUTHORIZED");
    const snapshot: SessionUser = { id: actor.id, companyId: actor.companyId, email: actor.email, name: actor.name, role: actor.role };
    if (!isPlatformAdmin(snapshot)) return fail("NOT_AUTHORIZED");
    return { companyId, providerScope, actor: snapshot };
  } catch (error) {
    if (error instanceof OpenCreditCommercialAccessServiceError) throw error;
    return fail("NOT_AUTHORIZED");
  }
}

function expectedAccessUnique(error: Prisma.PrismaClientKnownRequestError): boolean {
  if (error.meta?.modelName !== undefined && error.meta.modelName !== "OpenCreditCommercialAccess") return false;
  const target = error.meta?.target;
  return target === "OCCommercial_company_scope_key"
    || Array.isArray(target) && target.length === 2 && target.includes("companyId") && target.includes("providerScope");
}

async function transition(db: Db, supplied: OpenCreditCommercialAccessInput, enabled: boolean): Promise<OpenCreditCommercialAccessResult> {
  const input = validate(supplied);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const currentActor = await tx.user.findUnique({ where: { id: input.actor.id },
          select: { id: true, companyId: true, name: true, email: true, role: true } });
        if (!currentActor || currentActor.id !== input.actor.id || currentActor.companyId !== input.actor.companyId
          || currentActor.role !== input.actor.role || normalizedEmail(currentActor.email) !== normalizedEmail(input.actor.email)) return fail("NOT_AUTHORIZED");
        const authenticatedCurrent: SessionUser = { ...currentActor, role: input.actor.role };
        if (!isPlatformAdmin(authenticatedCurrent)) return fail("NOT_AUTHORIZED");
        const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
        if (!company) return fail("COMPANY_NOT_FOUND");
        const where = { companyId_providerScope: { companyId: input.companyId, providerScope: input.providerScope } };
        const current = await tx.openCreditCommercialAccess.findUnique({ where,
          select: { id: true, companyId: true, providerScope: true, enabled: true } });
        if (!current && !enabled) return { changed: false, enabled: false, accessId: null };
        if (current?.enabled === enabled) return { changed: false, enabled, accessId: current.id };
        const access = current
          ? await tx.openCreditCommercialAccess.update({ where, data: { enabled, changedByUserId: currentActor.id }, select: { id: true } })
          : await tx.openCreditCommercialAccess.create({ data: { companyId: input.companyId, providerScope: input.providerScope,
            enabled, changedByUserId: currentActor.id }, select: { id: true } });
        await tx.openCreditCommercialAccessEvent.create({ data: {
          commercialAccessId: access.id, companyId: input.companyId, providerScope: input.providerScope,
          actorUserId: currentActor.id, action: enabled ? "GRANTED" : "REVOKED",
          previousEnabled: current?.enabled ?? null, nextEnabled: enabled
        }, select: { id: true } });
        return { changed: true, enabled, accessId: access.id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 });
    } catch (error) {
      if (error instanceof OpenCreditCommercialAccessServiceError) throw error;
      const retryable = error instanceof Prisma.PrismaClientKnownRequestError
        && (error.code === "P2034" || error.code === "P2002" && expectedAccessUnique(error));
      if (retryable && attempt < 2) continue;
      return fail(retryable ? "CONCURRENT_CONFLICT" : "STORAGE_ERROR");
    }
  }
  return fail("CONCURRENT_CONFLICT");
}

/** No default DB/client: only an authenticated trusted server caller can invoke this internal service. */
export async function grantOpenCreditCommercialAccess(db: Db, input: OpenCreditCommercialAccessInput): Promise<OpenCreditCommercialAccessResult> {
  return transition(db, input, true);
}
export async function revokeOpenCreditCommercialAccess(db: Db, input: OpenCreditCommercialAccessInput): Promise<OpenCreditCommercialAccessResult> {
  return transition(db, input, false);
}
