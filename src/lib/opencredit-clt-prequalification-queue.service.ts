import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { canonicalizeOpenCreditOwnershipCpf } from "./opencredit-commercial-identity-policy";
import { resolveConfiguredOpenCreditProviderContext } from "./opencredit-provider-scope-resolver";
import { classifyOpenCreditTemplateButton } from "./opencredit-whatsapp-button-policy";

export type CltPrequalificationLease = { id: string; leaseToken: string; attempts: number };
type EnqueueInput = { companyId: string; conversationId: string; inboundEventId: string };
const settings = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 } as const;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);

export function isCltPrequalificationEnabled(env: Record<string, string | undefined> = process.env) {
  return env.OPENCREDIT_CLT_PREQUALIFICATION_ENABLED === "true";
}

export async function enqueueCltPrequalification(db: PrismaClient, input: EnqueueInput) {
  if (!isCltPrequalificationEnabled() || !id(input.companyId) || !id(input.conversationId) || !id(input.inboundEventId)) return null;
  let config: ReturnType<typeof resolveConfiguredOpenCreditProviderContext>;
  try { config = resolveConfiguredOpenCreditProviderContext(); } catch { return null; }
  try {
    return await db.$transaction(async tx => {
      const conversation = await tx.conversation.findFirst({
        where: { id: input.conversationId, contact: { companyId: input.companyId } },
        include: { contact: { include: { origin: { select: { name: true } } } } }
      });
      if (!conversation?.channelId || conversation.contact.origin?.name.trim().toLocaleLowerCase("pt-BR") !== "prospecta") return null;
      const evidence = await tx.conversationInboundEvent.findFirst({
        where: {
          id: input.inboundEventId,
          companyId: input.companyId,
          contactId: conversation.contactId,
          conversationId: conversation.id,
          channelId: conversation.channelId,
          provenanceKind: "META_WEBHOOK_HMAC_SHA256_VERIFIED",
          provenanceVersion: 1,
        },
        include: { message: { select: { direction: true, type: true, body: true, providerMessageId: true } } }
      });
      if (!evidence || evidence.message.direction !== "inbound" || !evidence.message.providerMessageId
        || classifyOpenCreditTemplateButton(evidence.message) !== "CHECK") return null;
      let cpf: string;
      try { cpf = canonicalizeOpenCreditOwnershipCpf(conversation.contact.cpf); } catch { return null; }
      const access = await tx.openCreditCommercialAccess.findUnique({
        where: { companyId_providerScope: { companyId: input.companyId, providerScope: config.providerScope } },
        select: { enabled: true }
      });
      const identity = await tx.openCreditRemoteIdentity.findUnique({
        where: { companyId_providerScope_contactId: { companyId: input.companyId, providerScope: config.providerScope, contactId: conversation.contactId } },
        select: { id: true, normalizedCpf: true, enabled: true }
      });
      if (access?.enabled !== true || identity?.enabled !== true || identity.normalizedCpf !== cpf) return null;
      return tx.openCreditCltPrequalification.upsert({
        where: { companyId_conversationId_inboundEventId: {
          companyId: input.companyId, conversationId: conversation.id, inboundEventId: evidence.id
        } },
        update: {},
        create: {
          companyId: input.companyId,
          contactId: conversation.contactId,
          conversationId: conversation.id,
          channelId: conversation.channelId,
          inboundEventId: evidence.id,
          providerScope: config.providerScope,
          state: "PENDING",
        },
        select: { id: true, state: true }
      });
    }, settings);
  } catch { return null; }
}

export function createCltPrequalificationQueue(db: PrismaClient) {
  return {
    async recover(limit = 10) {
      const bounded = Number.isInteger(limit) ? Math.min(10, Math.max(1, limit)) : 1;
      return db.$queryRaw<Array<{ id: string }>>`
        WITH t AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now),
        candidates AS (
          SELECT q."id" FROM "OpenCreditCltPrequalification" q, t
          WHERE q."state" = 'PROCESSING' AND q."leaseUntil" <= t.now AND q."attempts" < 3
          ORDER BY q."leaseUntil", q."id" LIMIT ${bounded}
          FOR UPDATE OF q SKIP LOCKED
        )
        UPDATE "OpenCreditCltPrequalification" q
        SET "state"='PENDING', "leaseToken"=NULL, "leaseUntil"=NULL,
            "availableAt"=t.now, "errorCode"='LEASE_EXPIRED', "updatedAt"=t.now
        FROM candidates, t WHERE q."id"=candidates."id"
        RETURNING q."id"`;
    },
    async claim(limit = 2): Promise<CltPrequalificationLease[]> {
      const bounded = Number.isInteger(limit) ? Math.min(5, Math.max(1, limit)) : 1;
      return db.$queryRaw<CltPrequalificationLease[]>`
        WITH t AS (SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now),
        candidates AS (
          SELECT q."id" FROM "OpenCreditCltPrequalification" q, t
          WHERE q."state"='PENDING' AND q."attempts" < 3 AND q."availableAt" <= t.now
          ORDER BY q."availableAt", q."id" LIMIT ${bounded}
          FOR UPDATE OF q SKIP LOCKED
        )
        UPDATE "OpenCreditCltPrequalification" q
        SET "state"='PROCESSING', "attempts"=q."attempts"+1,
            "leaseToken"=gen_random_uuid()::text, "leaseUntil"=t.now + INTERVAL '150 seconds',
            "startedAt"=COALESCE(q."startedAt", t.now), "errorCode"=NULL, "updatedAt"=t.now
        FROM candidates, t WHERE q."id"=candidates."id"
        RETURNING q."id", q."leaseToken", q."attempts"`;
    },
    async complete(lease: CltPrequalificationLease, protectedResult: string) {
      return db.$transaction(async tx => {
        const updated = await tx.openCreditCltPrequalification.updateMany({
          where: { id: lease.id, state: "PROCESSING", leaseToken: lease.leaseToken, leaseUntil: { gt: new Date() } },
          data: { state: "COMPLETED", protectedResult, errorCode: null, leaseToken: null, leaseUntil: null, completedAt: new Date() }
        });
        return updated.count === 1;
      }, settings);
    },
    async retryOrFail(lease: CltPrequalificationLease, errorCode: "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "CONFIGURATION") {
      return db.$transaction(async tx => {
        const current = await tx.openCreditCltPrequalification.findFirst({
          where: { id: lease.id, state: "PROCESSING", leaseToken: lease.leaseToken },
          select: { attempts: true, leaseUntil: true }
        });
        if (!current || !current.leaseUntil || current.leaseUntil <= new Date()) return false;
        const retry = current.attempts < 3;
        const updated = await tx.openCreditCltPrequalification.updateMany({
          where: { id: lease.id, state: "PROCESSING", leaseToken: lease.leaseToken },
          data: retry
            ? { state: "PENDING", errorCode, leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + 30_000 * current.attempts) }
            : { state: "FAILED", errorCode, leaseToken: null, leaseUntil: null, completedAt: new Date() }
        });
        return updated.count === 1;
      }, settings);
    }
  };
}
