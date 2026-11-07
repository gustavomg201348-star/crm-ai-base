import { Prisma } from "@prisma/client";
import { getSecretEncryptionKeyStatus } from "./secret-encryption-env";
import { openMaterializationIdentity } from "./opencredit-lead-materialization-payload";

export type ReadinessJob = {
  id: string; companyId: string; integrationId: string; providerScope: string;
  externalLeadId: string; inboundEventId: string; protectedEnvelope: string | null;
};
export type MaterializationReadiness =
  | "READY_EXISTING_CONTACT" | "READY_NEW_CONTACT" | "WAITING_IDENTITY" | "REVIEW_REQUIRED";

/** Read-only, closed result. Identity values never leave this boundary. */
export async function evaluateMaterializationReadiness(
  tx: Prisma.TransactionClient, job: ReadinessJob,
): Promise<MaterializationReadiness> {
  const event = await tx.openCreditInboundEvent.findUnique({
    where: { id: job.inboundEventId },
    select: { eventId: true, eventType: true, companyId: true, integrationId: true, providerScope: true,
      externalLeadId: true, provenanceKind: true, provenanceVersion: true },
  });
  if (!event || event.companyId !== job.companyId || event.integrationId !== job.integrationId ||
      event.providerScope !== job.providerScope || event.externalLeadId !== job.externalLeadId ||
      event.eventType !== "lead.assigned" || event.provenanceKind !== "OPENCREDIT_HMAC_SHA256_VERIFIED" ||
      event.provenanceVersion !== 1 || !job.protectedEnvelope) return "REVIEW_REQUIRED";
  if (getSecretEncryptionKeyStatus().status !== "configured") throw new Error("MATERIALIZATION_READINESS_UNAVAILABLE");
  let identity;
  try { identity = openMaterializationIdentity(job.protectedEnvelope, event); }
  catch { return "REVIEW_REQUIRED"; }
  const { cpf, phone } = identity;
  if (!cpf && !phone) return "WAITING_IDENTITY";
  const nationalPhone = phone?.slice(2);
  // Same matching rules as resolveContact, including legacy national phone storage.
  const rows = await tx.$queryRaw<Array<{ id: string; cpf: string | null; archivedAt: Date | null;
    phone: string; normalizedPhone: string | null }>>`
    SELECT "id", "cpf", "archivedAt", "phone", "normalizedPhone" FROM "Contact"
    WHERE "companyId" = ${job.companyId} AND (
      (${cpf}::text IS NOT NULL AND "cpf" = ${cpf}) OR
      (${phone}::text IS NOT NULL AND ("normalizedPhone" = ${phone} OR
        ("normalizedPhone" IS NULL AND (regexp_replace("phone", '\\D', '', 'g') = ${phone}
          OR ("phone" NOT LIKE '+%' AND regexp_replace("phone", '\\D', '', 'g') = ${nationalPhone ?? null}))))))
    ORDER BY ("archivedAt" IS NOT NULL), "id" LIMIT 3`;
  const active = rows.filter(row => row.archivedAt === null);
  if (active.length > 1) return "REVIEW_REQUIRED";
  const existing = active[0];
  if (existing) {
    if (cpf && existing.cpf?.trim() && existing.cpf !== cpf) return "REVIEW_REQUIRED";
    if (phone) {
      const digits = existing.phone.replace(/\D/g, "");
      const samePhone = existing.normalizedPhone === phone || existing.normalizedPhone === null &&
        (digits === phone || !existing.phone.startsWith("+") && digits === nationalPhone);
      if (!samePhone) return "REVIEW_REQUIRED";
    }
    return "READY_EXISTING_CONTACT";
  }
  if (rows.length) return "REVIEW_REQUIRED"; // Never resurrect archived identity.
  return phone ? "READY_NEW_CONTACT" : "WAITING_IDENTITY";
}
