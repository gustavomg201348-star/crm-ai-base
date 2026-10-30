import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readPassiveReceipt, PassiveInboundError, type PassiveReceipt, type PassiveBinding, type PassiveMetadata } from "./opencredit-passive-inbound-contract";
import { OpenCreditDeadline } from "./opencredit-webhook-contract";
type Db = Pick<PrismaClient, "$transaction">;
function duplicate(row: { externalLeadId: string; eventType: string; contractVersion: number | null }, metadata: PassiveMetadata) {
  if (row.externalLeadId !== metadata.externalLeadId || row.eventType !== metadata.eventType || row.contractVersion !== metadata.contractVersion) throw new PassiveInboundError("EVENT_CONFLICT", 409);
  return { duplicate: true };
}
async function current(tx: Prisma.TransactionClient, b: PassiveBinding) {
  // Compare ciphertext in memory, never in query arguments that Prisma error logging could render.
  const rows = await tx.$queryRaw<Array<{ providerScope: string | null; webhookSecret: string; enabled: boolean }>>`SELECT "providerScope", "webhookSecret", "enabled" FROM "OpenCreditIntegration" WHERE "id" = ${b.id} AND "companyId" = ${b.companyId} FOR SHARE`;
  const row = rows[0];
  if (rows.length !== 1 || !row.enabled || row.providerScope !== b.providerScope || row.webhookSecret !== b.webhookSecret) throw new PassiveInboundError("UNAVAILABLE", 403);
}
/** Only inbox metadata is written. A successful return always follows a committed transaction. */
export async function persistPassiveInbound(db: Db, receipt: PassiveReceipt, deadline: OpenCreditDeadline) {
  const { binding: b, metadata } = readPassiveReceipt(receipt);
  const where = { companyId_providerScope_eventId: { companyId: b.companyId, providerScope: b.providerScope, eventId: metadata.eventId } };
  const transact = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>) => {
    deadline.assertRemaining();
    return db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: Math.min(150, deadline.remainingMs()), timeout: Math.min(1000, deadline.remainingMs()) });
  };
  try {
    return await transact(async tx => {
      await current(tx, b); deadline.assertRemaining();
      const old = await tx.openCreditInboundEvent.findUnique({ where });
      if (old) return duplicate(old, metadata);
      await tx.openCreditInboundEvent.create({ data: { companyId: b.companyId, providerScope: b.providerScope, integrationId: b.id, ...metadata, provenanceKind: "OPENCREDIT_HMAC_SHA256_VERIFIED", provenanceVersion: 1, processingState: "RECEIVED" } });
      return { duplicate: false };
    });
  } catch (error) {
    const target = error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : null;
    const expected = target === "OCInbound_company_scope_event_key" || Array.isArray(target) && target.length === 3 && ["companyId", "providerScope", "eventId"].every(k => target.includes(k));
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !(error.code === "P2034" || error.code === "P2002" && expected)) throw error;
    return transact(async tx => { await current(tx, b); const old = await tx.openCreditInboundEvent.findUnique({ where }); if (!old) throw new PassiveInboundError("UNAVAILABLE", 503); return duplicate(old, metadata); });
  }
}
