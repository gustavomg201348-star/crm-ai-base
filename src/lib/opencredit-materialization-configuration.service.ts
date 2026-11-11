import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { isPlatformAdmin } from "./permissions";
import { parseOpenCreditProviderScope, type OpenCreditProviderScope } from "./opencredit-commercial-identity-policy";
import { getOpenCreditMaterializationPreflight } from "./opencredit-materialization-preflight.service";
import { safeLogInfo } from "./safe-logger";

type Code = "NOT_AUTHORIZED" | "NOT_FOUND" | "INVALID_REQUEST" | "CONFLICT" | "GATES_INVALID" | "ROLLOUT_RESERVED" | "UNAVAILABLE";
export class MaterializationConfigurationError extends Error {
  constructor(readonly code: Code) { super(code); }
}
export type ConfigurationCommand = { companyId: string; integrationId: string } & (
  { action: "READ" } | { action: "SET"; materializationEnabled: boolean; expectedUpdatedAt: string }
);
const validId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
export function parseMaterializationConfiguration(value: unknown): ConfigurationCommand | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (!validId(v.companyId) || !validId(v.integrationId)) return null;
  const keys = v.action === "READ" ? ["action", "companyId", "integrationId"] : v.action === "SET"
    ? ["action", "companyId", "integrationId", "materializationEnabled", "expectedUpdatedAt"] : [];
  if (!keys.length || Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) return null;
  if (v.action === "SET") {
    if (typeof v.materializationEnabled !== "boolean" || typeof v.expectedUpdatedAt !== "string") return null;
    try { if (new Date(v.expectedUpdatedAt).toISOString() !== v.expectedUpdatedAt) return null; } catch { return null; }
  }
  return v as ConfigurationCommand;
}
const fail = (code: Code): never => { throw new MaterializationConfigurationError(code); };
type Db = Pick<PrismaClient, "$transaction">;
type Input = { actor: SessionUser; providerScope: OpenCreditProviderScope; command: ConfigurationCommand };

/** Projection of the existing read-only preflight: never return candidates/envelopes/rollout IDs. */
export async function readMaterializationConfiguration(db: Db, input: Input) {
  const result = await getOpenCreditMaterializationPreflight(db, {
    actor: input.actor, companyId: input.command.companyId, providerScope: input.providerScope,
  });
  const i = result.integrations.find(row => row.integrationId === input.command.integrationId);
  if (!i) return fail("NOT_FOUND");
  const [lastAdmission] = await db.$transaction(tx => tx.$queryRaw<Array<{
    admittedAt: Date; jobState: string; reviewCode: string | null; lastErrorCode: string | null;
    contactCreated: boolean; sourceConversationCreated: boolean; sourceConversationStatus: string | null;
    handoffState: string | null; whatsappConversationCreated: boolean; whatsappConversationStatus: string | null;
    outboundStatus: string | null; providerAccepted: boolean;
  }>>`
    SELECT a."admittedAt",
      j."state" AS "jobState", j."reviewCode", j."lastErrorCode",
      (j."contactId" IS NOT NULL) AS "contactCreated",
      (j."conversationId" IS NOT NULL) AS "sourceConversationCreated",
      src."status" AS "sourceConversationStatus",
      h."state" AS "handoffState",
      (h."metaConversationId" IS NOT NULL) AS "whatsappConversationCreated",
      meta."status" AS "whatsappConversationStatus",
      o."status" AS "outboundStatus",
      (COALESCE(h."providerMessageId", o."providerMessageId") IS NOT NULL) AS "providerAccepted"
    FROM "OpenCreditMaterializationRolloutAdmission" a
    JOIN "OpenCreditLeadMaterialization" j ON j."id"=a."jobId"
      AND j."companyId"=a."companyId" AND j."integrationId"=a."integrationId" AND j."providerScope"=a."providerScope"
    LEFT JOIN "Conversation" src ON src."id"=j."conversationId"
    LEFT JOIN "OpenCreditWhatsappHandoff" h ON h."jobId"=j."id"
    LEFT JOIN "Conversation" meta ON meta."id"=h."metaConversationId"
    LEFT JOIN "OutboundOperation" o ON o."id"=h."outboundOperationId"
    WHERE a."companyId"=${input.command.companyId} AND a."integrationId"=${input.command.integrationId}
      AND a."providerScope"=${input.providerScope}
    ORDER BY a."admittedAt" DESC LIMIT 1`
  );
  return { ok: true as const, companyId: result.companyId, integrationId: i.integrationId,
    enabled: i.enabled, paused: i.paused, passiveInboundEnabled: i.passiveInboundEnabled,
    materializationEnabled: i.materializationEnabled, interlockReady: i.interlockReady,
    bindingReserved: i.rollouts.bindingReserved, updatedAt: i.updatedAt, autoStartOperational: i.autoStartOperational,
    queue: { claimableNow: i.queue.claimableNow, counts: i.queue.counts, complete: i.queue.readiness.complete },
    lastAdmission: lastAdmission ? {
      admittedAt: lastAdmission.admittedAt.toISOString(), jobState: lastAdmission.jobState,
      reviewCode: lastAdmission.reviewCode, lastErrorCode: lastAdmission.lastErrorCode,
      contactCreated: lastAdmission.contactCreated, sourceConversationCreated: lastAdmission.sourceConversationCreated,
      sourceConversationStatus: lastAdmission.sourceConversationStatus, handoffState: lastAdmission.handoffState,
      whatsappConversationCreated: lastAdmission.whatsappConversationCreated,
      whatsappConversationStatus: lastAdmission.whatsappConversationStatus,
      outboundStatus: lastAdmission.outboundStatus, providerAccepted: lastAdmission.providerAccepted,
    } : null };
}

export async function setMaterializationConfiguration(db: Db, input: Input) {
  try {
    if (!parseMaterializationConfiguration(input.command) || input.command.action !== "SET") return fail("INVALID_REQUEST");
    if (!isPlatformAdmin(input.actor)) return fail("NOT_AUTHORIZED");
    parseOpenCreditProviderScope(input.providerScope);
    const cmd = input.command;
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true)`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${input.actor.id} FOR SHARE`;
      const actor = await tx.user.findUnique({ where: { id: input.actor.id }, select: { id: true, companyId: true, name: true, email: true, role: true } });
      if (!actor || actor.role !== "ADMIN" || actor.companyId !== input.actor.companyId
        || actor.email.toLowerCase().trim() !== input.actor.email.toLowerCase().trim()
        || !isPlatformAdmin({ ...actor, role: "ADMIN" })) return fail("NOT_AUTHORIZED");
      const [row] = await tx.$queryRaw<Array<{ id: string; enabled: boolean; paused: boolean;
        passiveInboundEnabled: boolean; materializationEnabled: boolean; updatedAt: Date }>>`
        SELECT "id","enabled","paused","passiveInboundEnabled","materializationEnabled","updatedAt"
        FROM "OpenCreditIntegration" WHERE "id"=${cmd.integrationId} AND "companyId"=${cmd.companyId}
          AND "providerScope"=${input.providerScope} FOR UPDATE`;
      if (!row) return fail("NOT_FOUND");
      const bindingReserved = await tx.openCreditMaterializationRolloutBudget.count({ where: {
        companyId: cmd.companyId, integrationId: cmd.integrationId, providerScope: input.providerScope, releasedAt: null,
      } }) > 0;
      if (cmd.materializationEnabled) {
        if (row.enabled || row.paused || !row.passiveInboundEnabled) return fail("GATES_INVALID");
        if (bindingReserved) return fail("ROLLOUT_RESERVED");
      }
      const changed = row.materializationEnabled !== cmd.materializationEnabled;
      if (changed && row.updatedAt.toISOString() !== cmd.expectedUpdatedAt) return fail("CONFLICT");
      const updated = changed ? await tx.openCreditIntegration.update({ where: {
        id: row.id, companyId: cmd.companyId, providerScope: input.providerScope, updatedAt: row.updatedAt,
        materializationEnabled: row.materializationEnabled, enabled: row.enabled, paused: row.paused, passiveInboundEnabled: row.passiveInboundEnabled,
      }, data: { materializationEnabled: cmd.materializationEnabled }, select: { updatedAt: true } }) : row;
      return { ok: true as const, changed, companyId: cmd.companyId, integrationId: row.id,
        materializationEnabled: cmd.materializationEnabled, interlockReady: !row.enabled && cmd.materializationEnabled,
        updatedAt: updated.updatedAt.toISOString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 8000 });
    if (result.changed) {
      try { safeLogInfo("opencredit-materialization-admin", "opencredit_materialization_configuration_changed", {
        event: "opencredit_materialization_configuration_changed", action: cmd.materializationEnabled ? "ENABLED" : "DISABLED",
        companyId: cmd.companyId, integrationId: cmd.integrationId, actorId: input.actor.id, timestamp: result.updatedAt,
      }); } catch { /* The commit is authoritative; never report a false rollback or retry a write. */ }
    }
    return result;
  } catch (error) {
    if (error instanceof MaterializationConfigurationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && (["P2025", "P2034", "P2002"].includes(error.code)
      || error.code === "P2010" && ["40001", "40P01", "55P03"].includes(String(error.meta?.code)))) return fail("CONFLICT");
    return fail("UNAVAILABLE");
  }
}
