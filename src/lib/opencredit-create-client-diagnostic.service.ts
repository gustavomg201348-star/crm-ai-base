import "server-only";
import type { PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseCreateClientDiagnostic, type OpenCreditCreateClientDiagnostic } from "./opencredit-create-client-diagnostic";
import { safeLogWarn } from "./safe-logger";

type Db = Pick<PrismaClient, "$transaction"> & Partial<Pick<PrismaClient, "user">>;
type Input = { actor: SessionUser; companyId: string; providerScope: string; operationId: string; expectedRevision: number };
/** Independent diagnostic commit, never changes state/revision/events or retries a transport.
 * Expected serialized snapshot CAS prevents overwriting a different/terminal observation.
 * Missing delegates fail closed (also useful for old test doubles), never bypass authorization. */
export async function persistCreateClientDiagnostic(db: Db, input: Input, diagnostic: OpenCreditCreateClientDiagnostic,
  previous: OpenCreditCreateClientDiagnostic | null = null): Promise<boolean> {
  try {
    const parsed = parseCreateClientDiagnostic(diagnostic); if (!parsed || !db.user || !isPlatformAdmin(input.actor)) return false;
    const before = previous === null ? null : parseCreateClientDiagnostic(previous);
    if (previous !== null && !before) return false;
    if (before && (before.settlement !== "NOT_CONFIRMED" || !["CONFIRMED", "ERROR"].includes(parsed.settlement)
      || JSON.stringify({ ...before, settlement: parsed.settlement }) !== JSON.stringify(parsed))) return false;
    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, role: true, email: true } });
      if (!actor || actor.companyId !== input.actor.companyId || actor.role !== input.actor.role
        || actor.email.toLowerCase() !== input.actor.email.toLowerCase() || !isPlatformAdmin({ ...input.actor, ...actor, role: input.actor.role })) return false;
      let expected = before === null ? null : JSON.stringify(before);
      if (before === null && parsed.dispatchCommittedAt !== null) {
        const current = await tx.openCreditCommercialOperation.findFirst({ where: { id: input.operationId,
          companyId: input.companyId, providerScope: input.providerScope }, select: { diagnostic: true } });
        // A pre-auth failure is not a provider attempt. A later explicitly initiated reservation may supersede it.
        if (current?.diagnostic) {
          const old = parseCreateClientDiagnostic(JSON.parse(current.diagnostic));
          if (!old || old.dispatchCommittedAt !== null) return false;
          expected = current.diagnostic;
        }
      }
      const result = await tx.openCreditCommercialOperation.updateMany({ where: {
        id: input.operationId, companyId: input.companyId, providerScope: input.providerScope, operationKind: "CLIENT_PROFILE_UPSERT",
        revision: input.expectedRevision, state: parsed.settlement === "CONFIRMED" ? { in: ["SUCCEEDED", "UNKNOWN"] }
          : parsed.dispatchCommittedAt === null ? "PREPARED" : "IN_FLIGHT",
        diagnostic: expected,
      }, data: { diagnostic: JSON.stringify(parsed) } });
      return result.count === 1;
    }, { maxWait: 2000, timeout: 5000 });
  } catch { return false; }
}
/** Same sanitized DTO as persistence. No raw exceptions or transport metadata. */
export function logCreateClientDiagnostic(operationId: string, diagnostic: OpenCreditCreateClientDiagnostic, persisted: boolean) {
  try {
    const parsed = parseCreateClientDiagnostic(diagnostic); if (!parsed) return;
    safeLogWarn("opencredit-create-client", "technical observation; never replay", {
      operationId, operationKind: "CLIENT_PROFILE_UPSERT", ...parsed, diagnosticPersisted: persisted,
    });
  } catch { /* Diagnostic sinks must never suppress settlement or cause replay. */ }
}
