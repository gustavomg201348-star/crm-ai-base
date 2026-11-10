import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  OPEN_CREDIT_CHANNEL_PROVIDER, OPEN_CREDIT_CHANNEL_TYPE, OPEN_CREDIT_CONVERSATION_CHANNEL
} from "./conversation-channel.service";
import { lockOpenCreditDomainMode, OpenCreditDomainModeUnavailableError } from "./opencredit-domain-interlock";
import { openMaterializationIdentity, type MaterializationIdentity } from "./opencredit-lead-materialization-payload";
import {
  completeInTransaction, createOpenCreditMaterializationQueue, MaterializationLeaseLostError,
  type MaterializationLease, type MaterializationReviewReason
} from "./opencredit-materialization-queue.service";
import { getSecretEncryptionKeyStatus } from "./secret-encryption-env";
import { validateRolloutLease } from "./opencredit-materialization-rollout-budget.service";

type Tx = Prisma.TransactionClient;
const activeStatuses = ["OPEN", "PENDING", "BOT"];

class ReviewRequired extends Error {
  constructor(readonly reason: MaterializationReviewReason) { super(reason); }
}

class KeyUnavailable extends Error {}

async function advisoryLock(tx: Tx, scope: string, companyId: string, identity?: string) {
  const key = createHash("sha256").update(JSON.stringify([scope, companyId, identity])).digest().readBigInt64BE();
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(${key}::bigint)`;
}

async function loadJob(tx: Tx, lease: MaterializationLease) {
  const [job] = await tx.$queryRaw<Array<{
    id: string; inboundEventId: string; companyId: string; integrationId: string; providerScope: string;
    externalLeadId: string; protectedEnvelope: string | null; leaseUntil: Date; expiresAt: Date; attempts: number;
  }>>`
    SELECT "id", "inboundEventId", "companyId", "integrationId", "providerScope",
           "externalLeadId", "protectedEnvelope", "leaseUntil", "expiresAt", "attempts"
    FROM "OpenCreditLeadMaterialization"
    WHERE "id" = ${lease.id} AND "state" = 'PROCESSING' AND "leaseToken" = ${lease.leaseToken}
      AND "leaseUntil" > (statement_timestamp() AT TIME ZONE 'UTC')
      AND "expiresAt" > (statement_timestamp() AT TIME ZONE 'UTC')
    FOR UPDATE`;
  if (!job) throw new MaterializationLeaseLostError();
  return job;
}

async function readIdentity(tx: Tx, job: Awaited<ReturnType<typeof loadJob>>) {
  const event = await tx.openCreditInboundEvent.findUnique({
    where: { id: job.inboundEventId },
    select: { eventId: true, companyId: true, integrationId: true, providerScope: true, externalLeadId: true }
  });
  if (!event || event.companyId !== job.companyId || event.integrationId !== job.integrationId ||
      event.providerScope !== job.providerScope || event.externalLeadId !== job.externalLeadId) {
    throw new ReviewRequired("BINDING_MISMATCH");
  }
  if (!job.protectedEnvelope) throw new ReviewRequired("ENVELOPE_INVALID");
  if (getSecretEncryptionKeyStatus().status !== "configured") throw new KeyUnavailable();
  try {
    return openMaterializationIdentity(job.protectedEnvelope, event);
  } catch (error) {
    if (error instanceof Error && error.message === "OPENCREDIT_MATERIALIZATION_KEY_UNAVAILABLE") throw new KeyUnavailable();
    throw new ReviewRequired("ENVELOPE_INVALID");
  }
}

async function resolveContact(tx: Tx, companyId: string, { cpf, phone, name, email }: MaterializationIdentity) {
  // Every transaction acquires CPF before phone, regardless of how the job was claimed.
  if (cpf) await advisoryLock(tx, "opencredit-cpf", companyId, cpf);
  if (phone) await advisoryLock(tx, "opencredit-phone", companyId, phone);

  const nationalPhone = phone?.slice(2);
  const match = Prisma.sql`(
    (${cpf}::text IS NOT NULL AND "cpf" = ${cpf})
    OR (${phone}::text IS NOT NULL AND (
      "normalizedPhone" = ${phone}
      OR ("normalizedPhone" IS NULL AND (
        regexp_replace("phone", '\\D', '', 'g') = ${phone}
        OR ("phone" NOT LIKE '+%' AND regexp_replace("phone", '\\D', '', 'g') = ${nationalPhone ?? null})
      ))
    ))
  )`;
  const active = await tx.$queryRaw<Array<{ id: string; cpf: string | null }>>`
    SELECT "id", "cpf" FROM "Contact"
    WHERE "companyId" = ${companyId} AND "archivedAt" IS NULL AND ${match}
    ORDER BY "id" LIMIT 2 FOR UPDATE`;
  const [existing] = active;
  if (active.length > 1 || (cpf && existing?.cpf?.trim() && existing.cpf !== cpf)) {
    throw new ReviewRequired("CONTACT_IDENTITY_CONFLICT");
  }
  if (existing) return existing.id;
  const [archived] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Contact"
    WHERE "companyId" = ${companyId} AND "archivedAt" IS NOT NULL AND ${match}
    LIMIT 1 FOR UPDATE`;
  if (archived) throw new ReviewRequired("CONTACT_ARCHIVED_MATCH");
  if (!phone) throw new ReviewRequired("CONTACT_DATA_INCOMPLETE");
  const origin = await tx.origin.findFirst({ where: { companyId, name: "OpenCredit" }, orderBy: { id: "asc" }, select: { id: true } });
  const stage = await tx.pipelineStage.findFirst({ where: { companyId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true } });
  const contact = await tx.contact.create({
    data: { companyId, name: name ?? "Lead OpenCredit", phone, normalizedPhone: phone, cpf, email,
      originId: origin?.id, stageId: stage?.id },
    select: { id: true }
  });
  return contact.id;
}

async function readChannel(tx: Tx, companyId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; type: string; provider: string }>>`
    SELECT "id", "type", "provider" FROM "Channel"
    WHERE "companyId" = ${companyId} AND ("type" = ${OPEN_CREDIT_CHANNEL_TYPE} OR "provider" = ${OPEN_CREDIT_CHANNEL_PROVIDER})
    ORDER BY "id" LIMIT 2 FOR UPDATE`;
  const [channel] = rows;
  if (rows.length > 1 || (channel && (channel.type !== OPEN_CREDIT_CHANNEL_TYPE || channel.provider !== OPEN_CREDIT_CHANNEL_PROVIDER))) {
    throw new ReviewRequired("CHANNEL_CONFIGURATION_CONFLICT");
  }
  return channel?.id;
}

async function resolveChannel(tx: Tx, companyId: string) {
  const existing = await readChannel(tx, companyId);
  if (existing) return existing;
  await advisoryLock(tx, "opencredit-channel", companyId);
  const afterLock = await readChannel(tx, companyId);
  if (afterLock) return afterLock;
  const channel = await tx.channel.create({
    data: { companyId, name: "OpenCredit", type: OPEN_CREDIT_CHANNEL_TYPE, provider: OPEN_CREDIT_CHANNEL_PROVIDER },
    select: { id: true }
  });
  return channel.id;
}

async function resolveConversation(tx: Tx, contactId: string, channelId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; agentId: string | null; channel: string }>>`
    SELECT "id", "agentId", "channel" FROM "Conversation"
    WHERE "contactId" = ${contactId} AND "channelId" = ${channelId}
      AND "status" IN (${Prisma.join(activeStatuses)})
    ORDER BY "id" LIMIT 2 FOR UPDATE`;
  const [existing] = rows;
  if (rows.length > 1 || (existing && existing.channel !== OPEN_CREDIT_CONVERSATION_CHANNEL)) {
    throw new ReviewRequired("CONVERSATION_CONFIGURATION_CONFLICT");
  }
  return existing ?? tx.conversation.create({
    data: { contactId, channelId, channel: OPEN_CREDIT_CONVERSATION_CHANNEL, status: "OPEN", summary: "Lead recebido via OpenCredit" },
    select: { id: true, agentId: true }
  });
}

async function assign(tx: Tx, companyId: string, conversation: { id: string; agentId: string | null }) {
  if (conversation.agentId !== null) return;
  const settings = await tx.leadAssignmentSetting.findUnique({ where: { companyId } });
  if (settings?.mode !== "ROUND_ROBIN") return;
  await advisoryLock(tx, "opencredit-assignment", companyId);
  const users = await tx.user.findMany({
    where: { companyId, role: { in: ["ADMIN", "SUPERVISOR", "AGENT"] },
      // Explicit PAUSED/OFFLINE/BUSY (or missing presence) never receive automatic work.
      availability: { is: { companyId, status: "ONLINE" } } },
    select: { id: true, name: true }
  });
  if (!users.length) return;
  const loads = await tx.conversation.groupBy({
    by: ["agentId"],
    where: { agentId: { in: users.map(user => user.id) }, status: { in: activeStatuses }, contact: { companyId } },
    _count: { _all: true }
  });
  const byUser = new Map(loads.map(row => [row.agentId, row._count._all]));
  const load = (id: string) => byUser.get(id) ?? 0;
  const next = users
    .filter(user => settings.maxOpenPerAttendant === null || load(user.id) < settings.maxOpenPerAttendant)
    .sort((a, b) => load(a.id) - load(b.id) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))[0];
  if (!next) return;
  await tx.$queryRaw`SELECT "userId" FROM "UserAvailability" WHERE "userId" = ${next.id} AND "companyId" = ${companyId} FOR SHARE`;
  if (!await tx.userAvailability.findFirst({ where: { companyId, userId: next.id, status: "ONLINE" }, select: { userId: true } })) return;
  const updated = await tx.conversation.updateMany({
    where: { id: conversation.id, agentId: null, contact: { companyId } }, data: { agentId: next.id }
  });
  if (updated.count === 1) await tx.leadAssignmentHistory.create({
    data: { companyId, conversationId: conversation.id, assignedToUserId: next.id, assignedByUserId: null, mode: "ROUND_ROBIN", action: "ASSIGNED" }
  });
}

export function createOpenCreditDomainMaterializer(db: Pick<PrismaClient, "$queryRaw" | "$transaction">) {
  const queue = createOpenCreditMaterializationQueue(db);
  return {
    async process(lease: MaterializationLease) {
      try {
        return await db.$transaction(async tx => {
          const job = await loadJob(tx, lease);
          if (!await validateRolloutLease(tx, job, lease)) throw new MaterializationLeaseLostError();
          const identity = await readIdentity(tx, job);
          const { companyId, integrationId } = job;
          await lockOpenCreditDomainMode(tx, { companyId, integrationId, expectedMode: "MATERIALIZATION" });
          const [time] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS now`;
          if (job.leaseUntil <= time.now || job.expiresAt <= time.now) throw new MaterializationLeaseLostError();
          const contactId = await resolveContact(tx, companyId, identity);
          const channelId = await resolveChannel(tx, companyId);
          const conversation = await resolveConversation(tx, contactId, channelId);
          await assign(tx, companyId, conversation);
          return completeInTransaction(tx, lease, { contactId, channelId, conversationId: conversation.id });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (error instanceof MaterializationLeaseLostError) return null;
        try {
          if (error instanceof ReviewRequired) return await queue.review(lease, error.reason);
          if (error instanceof KeyUnavailable) return await queue.retry(lease, "KEY_UNAVAILABLE");
          if (error instanceof OpenCreditDomainModeUnavailableError) return await queue.retry(lease, "MODE_UNAVAILABLE");
          const serialization = error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === "P2034" || (error.code === "P2010" && error.meta?.code === "40001"));
          return await queue.retry(lease, serialization ? "SERIALIZATION_CONFLICT" : "TRANSIENT_FAILURE");
        } catch {
          throw new Error("OPENCREDIT_MATERIALIZATION_TRANSITION_FAILED");
        }
      }
    }
  };
}
