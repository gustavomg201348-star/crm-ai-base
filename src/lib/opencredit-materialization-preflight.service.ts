import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";

type Code = "NOT_AUTHORIZED" | "COMPANY_NOT_FOUND" | "STORAGE_ERROR";
export class OpenCreditMaterializationPreflightError extends Error {
  constructor(readonly code: Code) {
    super("OPENCREDIT_MATERIALIZATION_PREFLIGHT_" + code);
    this.name = "OpenCreditMaterializationPreflightError";
  }
}

type Db = Pick<PrismaClient, "$transaction">;
type Input = Readonly<{ actor: SessionUser; companyId: string; providerScope: OpenCreditProviderScope }>;
const fail = (code: Code): never => { throw new OpenCreditMaterializationPreflightError(code); };
const queueStates = ["PENDING", "RETRY", "PROCESSING", "NEEDS_REVIEW", "COMPLETED", "EXPIRED"] as const;

function safeDate(value: Date | null) {
  return value ? value.toISOString() : null;
}

/** Read-only production preflight. It never reads protected payload contents and never mutates domain rows. */
export async function getOpenCreditMaterializationPreflight(db: Db, input: Input) {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(input.companyId)) return fail("STORAGE_ERROR");
    parseOpenCreditProviderScope(input.providerScope);
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");

    return await db.$transaction(async tx => {
      const actor = await tx.user.findUnique({
        where: { id: input.actor.id },
        select: { id: true, companyId: true, name: true, email: true, role: true },
      });
      if (!actor || actor.companyId !== input.actor.companyId || actor.role !== "ADMIN"
        || actor.email.trim().toLowerCase() !== input.actor.email.trim().toLowerCase()
        || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");

      if (!await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } })) {
        return fail("COMPANY_NOT_FOUND");
      }

      const integrations = await tx.openCreditIntegration.findMany({
        where: { companyId: input.companyId, providerScope: input.providerScope },
        select: {
          id: true,
          enabled: true,
          paused: true,
          passiveInboundEnabled: true,
          materializationEnabled: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { id: "asc" },
      });

      const now = new Date();
      const snapshots = [];
      for (const integration of integrations) {
        const baseWhere = {
          companyId: input.companyId,
          providerScope: input.providerScope,
          integrationId: integration.id,
        };
        const counts: Record<string, number> = {};
        let known = 0;
        for (const state of queueStates) {
          const count = await tx.openCreditLeadMaterialization.count({ where: { ...baseWhere, state } });
          counts[state] = count;
          known += count;
        }
        const total = await tx.openCreditLeadMaterialization.count({ where: baseWhere });
        counts.UNKNOWN = Math.max(0, total - known);

        const readyWhere = {
          ...baseWhere,
          state: { in: ["PENDING", "RETRY"] },
          expiresAt: { gt: now },
          attempts: { lt: 10 },
          OR: [
            { availableAt: { lte: now } },
            { state: "PENDING", availableAt: null },
          ],
        } as const;

        const [readyIfEnabled, staleProcessing, expiredActive, candidates] = await Promise.all([
          tx.openCreditLeadMaterialization.count({ where: readyWhere }),
          tx.openCreditLeadMaterialization.count({
            where: { ...baseWhere, state: "PROCESSING", leaseUntil: { lte: now } },
          }),
          tx.openCreditLeadMaterialization.count({
            where: { ...baseWhere, state: { in: ["PENDING", "RETRY", "PROCESSING", "NEEDS_REVIEW"] }, expiresAt: { lte: now } },
          }),
          tx.openCreditLeadMaterialization.findMany({
            where: readyWhere,
            select: {
              id: true,
              externalLeadId: true,
              state: true,
              attempts: true,
              availableAt: true,
              expiresAt: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            take: 10,
          }),
        ]);

        snapshots.push({
          integrationId: integration.id,
          enabled: integration.enabled,
          paused: integration.paused,
          passiveInboundEnabled: integration.passiveInboundEnabled,
          materializationEnabled: integration.materializationEnabled,
          interlockReady: !integration.enabled && integration.materializationEnabled,
          createdAt: integration.createdAt.toISOString(),
          updatedAt: integration.updatedAt.toISOString(),
          queue: {
            total,
            counts,
            readyIfEnabled,
            claimableNow: integration.materializationEnabled ? readyIfEnabled : 0,
            staleProcessing,
            expiredActive,
            candidates: candidates.map(candidate => ({
              id: candidate.id,
              externalLeadId: candidate.externalLeadId,
              state: candidate.state,
              attempts: candidate.attempts,
              availableAt: safeDate(candidate.availableAt),
              expiresAt: candidate.expiresAt.toISOString(),
              createdAt: candidate.createdAt.toISOString(),
            })),
          },
        });
      }

      return {
        ok: true as const,
        companyId: input.companyId,
        providerScope: input.providerScope,
        generatedAt: now.toISOString(),
        integrations: snapshots,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 8000 });
  } catch (error) {
    if (error instanceof OpenCreditMaterializationPreflightError) throw error;
    return fail("STORAGE_ERROR");
  }
}
