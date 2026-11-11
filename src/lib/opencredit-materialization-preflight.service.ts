import "server-only";
import { evaluateMaterializationReadiness, type ReadinessJob } from "./opencredit-materialization-readiness";
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

/** Read-only production preflight. It never returns protected payload contents and never mutates domain rows. */
export async function getOpenCreditMaterializationPreflight(db: Db, input: Input) {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(input.companyId)) return fail("STORAGE_ERROR");
    parseOpenCreditProviderScope(input.providerScope);
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");

    return await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
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

        const operatingWindow = await tx.openCreditWhatsappConfig.findFirst({
          where: { integrationId: integration.id, companyId: input.companyId, providerScope: input.providerScope },
          select: { autoStartEnabled: true, updatedAt: true },
        });
        const operating = operatingWindow?.autoStartEnabled === true;
        const readyWhere: Prisma.OpenCreditLeadMaterializationWhereInput = {
          ...baseWhere,
          state: { in: ["PENDING", "RETRY"] },
          expiresAt: { gt: now },
          attempts: { lt: 10 },
          createdAt: { gte: operating ? operatingWindow!.updatedAt : new Date("9999-12-31T23:59:59.999Z") },
          OR: [
            { availableAt: { lte: now } },
            { state: "PENDING", availableAt: null },
          ],
        };

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

        // Bounded read-only identity audit. Counts are explicitly partial if the cap is hit.
        const readiness = { readyExistingContact: 0, readyNewContact: 0, waitingIdentity: 0, reviewRisk: 0,
          evaluated: 0, complete: true, nextCursor: null as string | null, scanLimit: 200 };
        let after: string | undefined;
        while (readiness.evaluated < readiness.scanLimit) {
          const page = await tx.openCreditLeadMaterialization.findMany({
            where: { ...readyWhere, ...(after ? { id: { gt: after } } : {}) },
            select: { id: true, companyId: true, integrationId: true, providerScope: true,
              externalLeadId: true, inboundEventId: true, protectedEnvelope: true },
            orderBy: { id: "asc" }, take: 25,
          });
          if (!page.length) break;
          for (const job of page) {
            const decision = await evaluateMaterializationReadiness(tx, job as ReadinessJob);
            if (decision === "READY_EXISTING_CONTACT") readiness.readyExistingContact++;
            else if (decision === "READY_NEW_CONTACT") readiness.readyNewContact++;
            else if (decision === "WAITING_IDENTITY") readiness.waitingIdentity++;
            else readiness.reviewRisk++;
            readiness.evaluated++;
            after = job.id;
          }
          if (page.length < 25) break;
        }
        readiness.complete = readiness.evaluated === readyIfEnabled;
        readiness.nextCursor = readiness.complete ? null : after ?? null;
        const identityReady = readiness.readyExistingContact + readiness.readyNewContact;
        const budgets = await tx.openCreditMaterializationRolloutBudget.findMany({
          where: baseWhere, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100,
          select: { id: true, state: true, maxAdmitted: true, admittedCount: true, expiresAt: true,
            closedAt: true, releasedAt: true, _count: { select: { admissions: true } } },
        });
        const bindingReserved = await tx.openCreditMaterializationRolloutBudget.count({
          where: { ...baseWhere, releasedAt: null },
        }) > 0;
        const budgetTotal = await tx.openCreditMaterializationRolloutBudget.count({ where: baseWhere });
        const rollouts = budgets.map(b => ({
          rolloutId: b.id, state: b.state, maxAdmitted: b.maxAdmitted, admittedCount: b.admittedCount,
          remaining: Math.max(0, b.maxAdmitted - b.admittedCount), expiresAt: b.expiresAt.toISOString(),
          closedAt: safeDate(b.closedAt), releasedAt: safeDate(b.releasedAt), admissionCount: b._count.admissions,
          ledgerConsistent: b.admittedCount === b._count.admissions && b.admittedCount >= 0 && b.admittedCount <= b.maxAdmitted,
        }));

        snapshots.push({
          integrationId: integration.id,
          enabled: integration.enabled,
          paused: integration.paused,
          passiveInboundEnabled: integration.passiveInboundEnabled,
          materializationEnabled: integration.materializationEnabled,
          interlockReady: !integration.enabled && integration.materializationEnabled,
          createdAt: integration.createdAt.toISOString(),
          updatedAt: integration.updatedAt.toISOString(),
          rollouts: { items: rollouts, total: budgetTotal, complete: budgets.length === budgetTotal, bindingReserved },
          queue: {
            total,
            counts,
            readyIfEnabled: identityReady,
            readiness,
            pendingTotal: counts.PENDING,
            expiredOrIneligible: Math.max(0, counts.PENDING + counts.RETRY - readyIfEnabled),
            claimableNow: operating && !bindingReserved && !integration.enabled && !integration.paused && integration.materializationEnabled ? identityReady : 0,
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
