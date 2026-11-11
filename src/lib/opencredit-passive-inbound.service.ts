import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readPassiveReceipt, readPassiveMaterializationInput, PassiveInboundError, type PassiveReceipt, type PassiveBinding, type PassiveMetadata } from "./opencredit-passive-inbound-contract";
import { protectMaterializationIdentity } from "./opencredit-lead-materialization-payload";
import { OpenCreditDeadline } from "./opencredit-webhook-contract";
type Db = Pick<PrismaClient, "$transaction">;
const materializationTtlMs = 7 * 24 * 60 * 60 * 1000;
function duplicate(row: { externalLeadId: string; eventType: string; contractVersion: number | null }, metadata: PassiveMetadata) {
  if (row.externalLeadId !== metadata.externalLeadId || row.eventType !== metadata.eventType || row.contractVersion !== metadata.contractVersion) throw new PassiveInboundError("EVENT_CONFLICT", 409);
  return { duplicate: true };
}
async function current(tx: Prisma.TransactionClient, b: PassiveBinding) {
  // Compare ciphertext in memory, never in query arguments that Prisma error logging could render.
  const rows = await tx.$queryRaw<Array<{ providerScope: string | null; webhookSecret: string; passiveInboundEnabled: boolean; materializationEnabled: boolean }>>`SELECT "providerScope", "webhookSecret", "passiveInboundEnabled", "materializationEnabled" FROM "OpenCreditIntegration" WHERE "id" = ${b.id} AND "companyId" = ${b.companyId} FOR SHARE`;
  const row = rows[0];
  if (rows.length !== 1 || row.passiveInboundEnabled !== true || row.providerScope !== b.providerScope || row.webhookSecret !== b.webhookSecret) throw new PassiveInboundError("UNAVAILABLE", 403);
  const configs = await tx.$queryRaw<Array<{ autoStartEnabled: boolean }>>`
    SELECT "autoStartEnabled" FROM "OpenCreditWhatsappConfig"
    WHERE "integrationId" = ${b.id} AND "companyId" = ${b.companyId} AND "providerScope" = ${b.providerScope}
    FOR SHARE`;
  return row.materializationEnabled === true && configs.length === 1 && configs[0].autoStartEnabled === true;
}

function isUniqueTarget(target: unknown, name: string, fields: readonly string[]) {
  return target === name || Array.isArray(target) && target.length === fields.length && fields.every(field => target.includes(field));
}

/** A successful return always follows a committed transaction. */
export async function persistPassiveInbound(db: Db, receipt: PassiveReceipt, deadline: OpenCreditDeadline, onTransactionEntry?: (entered: boolean) => void) {
  const { binding: b, metadata } = readPassiveReceipt(receipt);
  const scope = { companyId: b.companyId, providerScope: b.providerScope };
  const lead = { ...scope, externalLeadId: metadata.externalLeadId };
  const where = { companyId_providerScope_eventId: { ...scope, eventId: metadata.eventId } };
  let attemptedMaterialization = false;
  const transact = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => {
    onTransactionEntry?.(false);
    deadline.assertRemaining();
    return db.$transaction(tx => {
      onTransactionEntry?.(true);
      return run(tx);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: Math.min(150, deadline.remainingMs()), timeout: Math.min(1000, deadline.remainingMs()) });
  };
  async function store(tx: Prisma.TransactionClient, recovering: boolean) {
    const enabled = await current(tx, b);
    deadline.assertRemaining();
    const old = await tx.openCreditInboundEvent.findUnique({ where });
    if (old) return duplicate(old, metadata);
    if (recovering && !attemptedMaterialization) throw new PassiveInboundError("UNAVAILABLE", 503);

    if (enabled && !recovering) attemptedMaterialization = true;
    const existingLead = enabled || recovering ? await tx.openCreditLeadMaterialization.findUnique({
      where: { companyId_providerScope_externalLeadId: lead },
      select: { id: true },
    }) : null;
    // A distinct event can survive a lead-unique race only after verifying its committed winner.
    if (recovering && !existingLead) throw new PassiveInboundError("UNAVAILABLE", 503);

    const event = await tx.openCreditInboundEvent.create({
      data: { ...scope, integrationId: b.id, ...metadata, provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1, processingState: "RECEIVED" },
      select: { id: true, receivedAt: true },
    });
    if (enabled && !existingLead) {
      const identity = readPassiveMaterializationInput(receipt);
      const usable = Boolean(identity.cpf || identity.phone);
      const binding = { ...lead, integrationId: b.id, eventId: metadata.eventId };
      const protectedEnvelope = Object.values(identity).some(Boolean) ? protectMaterializationIdentity(binding, identity) : null;
      deadline.assertRemaining();
      await tx.openCreditLeadMaterialization.create({
        data: {
          ...lead,
          integrationId: b.id,
          inboundEventId: event.id,
          state: usable ? "PENDING" : "NEEDS_REVIEW",
          reviewCode: usable ? null : "IDENTITY_INSUFFICIENT",
          protectedEnvelope,
          expiresAt: new Date(event.receivedAt.getTime() + materializationTtlMs),
        },
      });
    }
    return { duplicate: false };
  }

  try {
    return await transact(tx => store(tx, false));
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const target = error.meta?.target;
    const eventUnique = isUniqueTarget(target, "OCInbound_company_scope_event_key", ["companyId", "providerScope", "eventId"]);
    const leadUnique = attemptedMaterialization && isUniqueTarget(target, "OCMaterialization_company_scope_lead_key", ["companyId", "providerScope", "externalLeadId"]);
    if (error.code !== "P2034" && !(error.code === "P2002" && (eventUnique || leadUnique))) throw error;
    return transact(tx => store(tx, true));
  }
}
