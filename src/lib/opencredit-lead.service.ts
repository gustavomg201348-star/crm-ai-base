import { Prisma, type PrismaClient } from "@prisma/client";
import { findContactPhoneIdentityMatch } from "@/lib/contacts";
import { OpenCreditDeadline, OpenCreditInputError, type OpenCreditAssignedLead } from "@/lib/opencredit-webhook-contract";

type Db = Pick<PrismaClient, "$transaction" | "openCreditEvent">;
export type OpenCreditBinding = { id: string; companyId: string };
type Tx = Prisma.TransactionClient;

async function resolveContact(tx: Tx, companyId: string, payload: OpenCreditAssignedLead) {
  const { cpf, phone, name, email } = payload.client;
  const cpfMatches = cpf ? await tx.contact.findMany({
    where: { companyId, cpf }, take: 2
  }) : [];
  const phoneMatch = phone ? await findContactPhoneIdentityMatch(tx, {
    companyId, phone, archived: true, source: "opencredit-lead",
    allowBrazilianWhatsappAlternate: false
  }) : { contact: null, matchType: "none" };
  const phoneMatches = phone ? await tx.contact.findMany({
    where: { companyId, normalizedPhone: phone }, take: 2
  }) : [];
  const localBrazilianPhone = phone?.startsWith("55") && phone.length > 11
    ? phone.slice(2) : null;
  // The shared lookup chooses a first exact match. Detect ambiguous legacy
  // rows too before accepting that match; never select a duplicate arbitrarily.
  const legacyPhoneMatches = phone ? await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Contact"
    WHERE "companyId" = ${companyId}
      AND (regexp_replace("phone", '\\D', '', 'g') = ${phone}
        ${localBrazilianPhone ? Prisma.sql`OR regexp_replace("phone", '\\D', '', 'g') = ${localBrazilianPhone}` : Prisma.empty})
    LIMIT 2
  ` : [];
  const phoneIds = new Set([
    ...phoneMatches.map(c => c.id), ...legacyPhoneMatches.map(c => c.id),
    ...(phoneMatch.contact ? [phoneMatch.contact.id] : [])
  ]);
  if (cpfMatches.length > 1 || phoneIds.size > 1 ||
      phoneMatch.matchType === "ambiguous" ||
      (cpfMatches[0] && phoneMatch.contact && cpfMatches[0].id !== phoneMatch.contact.id) ||
      (cpf && phoneMatch.contact?.cpf && phoneMatch.contact.cpf !== cpf)) {
    return { contactId: null, errorCode: "CONTACT_IDENTITY_CONFLICT" };
  }
  const existing = cpfMatches[0] ?? phoneMatch.contact;
  // Preserve trusted local data, assignment, archive state and history.
  if (existing) return { contactId: existing.id, errorCode: null };
  if (!phone) return { contactId: null, errorCode: "CONTACT_DATA_INCOMPLETE" };
  const [origin, stage] = await Promise.all([
    tx.origin.findFirst({ where: { companyId, name: "OpenCredit" } }),
    tx.pipelineStage.findFirst({ where: { companyId }, orderBy: { position: "asc" } })
  ]);
  const contact = await tx.contact.create({
    data: {
      companyId, name: name || "Lead OpenCredit",
      phone, normalizedPhone: phone, cpf, email,
      originId: origin?.id ?? null, stageId: stage?.id ?? null
    }, select: { id: true }
  });
  return { contactId: contact.id, errorCode: null };
}

function validateDuplicate(
  event: { externalLeadId: string; companyId: string; processingStatus: string; processedAt: Date | null },
  binding: OpenCreditBinding, payload: OpenCreditAssignedLead
) {
  if (event.companyId !== binding.companyId || event.externalLeadId !== payload.externalLeadId) {
    throw new OpenCreditInputError("EVENT_ID_CONFLICT", 409);
  }
  if (!event.processedAt || !["PROCESSED", "NEEDS_REVIEW"].includes(event.processingStatus)) {
    throw new OpenCreditInputError("EVENT_NOT_COMPLETED", 503);
  }
  return { duplicate: true };
}

// Event, external identity and Contact commit together. Serialization failures
// roll back all work; bounded retry never repeats an external side effect.
function expectedUniqueConflict(error: Prisma.PrismaClientKnownRequestError) {
  const targets = [
    { model: "OpenCreditEvent", fields: ["integrationId", "eventId"], index: "OpenCreditEvent_integrationId_eventId_key" },
    { model: "OpenCreditLead", fields: ["companyId", "integrationId", "externalLeadId"], index: "OpenCreditLead_companyId_integrationId_externalLeadId_key" }
  ];
  return targets.some(({ model, fields, index }) => {
    if (error.meta?.modelName !== undefined && error.meta.modelName !== model) return false;
    const target = error.meta?.target;
    return target === index || (Array.isArray(target) && target.length === fields.length &&
      fields.every(field => target.includes(field)));
  });
}

export async function ingestOpenCreditLead(db: Db, binding: OpenCreditBinding, payload: OpenCreditAssignedLead,
  deadline = new OpenCreditDeadline()) {
  for (let attempt = 0; attempt < 3; attempt++) {
    deadline.assertRemaining();
    try {
      return await db.$transaction(async (tx) => {
        deadline.assertRemaining();
        const integration = await tx.openCreditIntegration.findFirst({
          where: { id: binding.id, companyId: binding.companyId, enabled: true },
          select: { id: true }
        });
        if (!integration) throw new OpenCreditInputError("INTEGRATION_UNAVAILABLE", 403);
        const where = { integrationId_eventId: { integrationId: binding.id, eventId: payload.eventId } };
        const previous = await tx.openCreditEvent.findUnique({ where });
        if (previous) return validateDuplicate(previous, binding, payload);
        let lead = await tx.openCreditLead.findUnique({
          where: { companyId_integrationId_externalLeadId: {
            companyId: binding.companyId, integrationId: binding.id, externalLeadId: payload.externalLeadId
          } }
        });
        let errorCode: string | null = null;
        let contactId = lead?.contactId ?? null;
        if (contactId) {
          const contact = await tx.contact.findFirst({ where: { id: contactId, companyId: binding.companyId } });
          if (!contact || (payload.client.cpf && contact.cpf && payload.client.cpf !== contact.cpf)) {
            errorCode = "CONTACT_IDENTITY_CONFLICT";
          }
        } else {
          const result = await resolveContact(tx, binding.companyId, payload);
          contactId = result.contactId;
          errorCode = result.errorCode;
        }
        if (!lead) {
          lead = await tx.openCreditLead.create({ data: {
            companyId: binding.companyId, integrationId: binding.id,
            externalLeadId: payload.externalLeadId, contactId
          } });
        } else if (!lead.contactId && contactId) {
          await tx.openCreditLead.update({ where: { id: lead.id }, data: { contactId } });
        }
        deadline.assertRemaining();
        await tx.openCreditEvent.create({ data: {
          companyId: binding.companyId, integrationId: binding.id,
          eventId: payload.eventId, eventType: "lead.assigned",
          externalLeadId: payload.externalLeadId, contractVersion: payload.contractVersion,
          assignedAt: payload.assignedAt, processedAt: new Date(),
          processingStatus: errorCode ? "NEEDS_REVIEW" : "PROCESSED", errorCode
        } });
        deadline.assertRemaining();
        return { duplicate: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: Math.min(500, deadline.remainingMs()), timeout: Math.min(1500, deadline.remainingMs()) });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !(error.code === "P2034" || (error.code === "P2002" && expectedUniqueConflict(error)))) throw error;
      deadline.assertRemaining();
      const existing = await deadline.wait(() => db.openCreditEvent.findUnique({
        where: { integrationId_eventId: { integrationId: binding.id, eventId: payload.eventId } }
      }));
      if (existing) return validateDuplicate(existing, binding, payload);
      if (attempt === 2) throw new OpenCreditInputError("INGESTION_BUSY", 503);
    }
  }
  throw new OpenCreditInputError("INGESTION_BUSY", 503);
}
