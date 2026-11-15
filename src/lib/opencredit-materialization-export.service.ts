import "server-only";
import { Prisma, type PrismaClient } from "@prisma/client";
import { openMaterializationIdentity, type MaterializationIdentity } from "./opencredit-lead-materialization-payload";

type Db = Pick<PrismaClient, "$queryRaw">;
type ExportRow = {
  companyId: string;
  integrationId: string;
  providerScope: string;
  externalLeadId: string;
  state: string;
  reviewCode: string | null;
  lastErrorCode: string | null;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
  protectedEnvelope: string | null;
  eventId: string;
  receivedAt: Date;
  contactId: string | null;
  contactName: string | null;
  contactCpf: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  handoffState: string | null;
  providerMessageId: string | null;
};

export type OpenCreditMaterializationExportRow = {
  receivedAt: string;
  createdAt: string;
  name: string;
  cpf: string;
  phone: string;
  email: string;
  state: string;
  reviewCode: string;
  lastErrorCode: string;
  attempts: number;
  contactCreated: "SIM" | "NAO";
  templateState: string;
  providerAccepted: "SIM" | "NAO";
};

function identityFrom(row: ExportRow): MaterializationIdentity {
  if (row.contactId) {
    return {
      name: row.contactName?.trim() || null,
      cpf: row.contactCpf?.trim() || null,
      phone: row.contactPhone?.trim() || null,
      email: row.contactEmail?.trim() || null,
    };
  }
  if (!row.protectedEnvelope) return { name: null, cpf: null, phone: null, email: null };
  try {
    return openMaterializationIdentity(row.protectedEnvelope, {
      companyId: row.companyId,
      integrationId: row.integrationId,
      providerScope: row.providerScope,
      eventId: row.eventId,
      externalLeadId: row.externalLeadId,
    });
  } catch {
    return { name: null, cpf: null, phone: null, email: null };
  }
}

export async function readOpenCreditMaterializationExport(
  db: Db,
  input: { companyId: string; integrationId: string; providerScope: string; since: Date; limit?: number }
): Promise<OpenCreditMaterializationExportRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 5000, 1), 5000);
  const rows = await db.$queryRaw<ExportRow[]>(Prisma.sql`
    SELECT q."companyId", q."integrationId", q."providerScope", q."externalLeadId",
      q."state", q."reviewCode", q."lastErrorCode", q."attempts", q."createdAt", q."updatedAt",
      q."protectedEnvelope", e."eventId", e."receivedAt", q."contactId",
      c."name" AS "contactName", c."cpf" AS "contactCpf", c."phone" AS "contactPhone", c."email" AS "contactEmail",
      h."state" AS "handoffState", h."providerMessageId"
    FROM "OpenCreditLeadMaterialization" q
    JOIN "OpenCreditInboundEvent" e ON e."id" = q."inboundEventId"
      AND e."companyId" = q."companyId" AND e."integrationId" = q."integrationId"
      AND e."providerScope" = q."providerScope" AND e."externalLeadId" = q."externalLeadId"
    LEFT JOIN "Contact" c ON c."companyId" = q."companyId" AND c."id" = q."contactId"
    LEFT JOIN "OpenCreditWhatsappHandoff" h ON h."jobId" = q."id"
      AND h."companyId" = q."companyId" AND h."integrationId" = q."integrationId"
      AND h."providerScope" = q."providerScope"
    WHERE q."companyId" = ${input.companyId}
      AND q."integrationId" = ${input.integrationId}
      AND q."providerScope" = ${input.providerScope}
      AND q."createdAt" >= ${input.since}
    ORDER BY q."createdAt" DESC, q."id" DESC
    LIMIT ${limit}
  `);

  return rows.map(row => {
    const identity = identityFrom(row);
    return {
      receivedAt: row.receivedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      name: identity.name ?? "",
      cpf: identity.cpf ?? "",
      phone: identity.phone ?? "",
      email: identity.email ?? "",
      state: row.state,
      reviewCode: row.reviewCode ?? "",
      lastErrorCode: row.lastErrorCode ?? "",
      attempts: row.attempts,
      contactCreated: row.contactId ? "SIM" : "NAO",
      templateState: row.handoffState ?? "NAO_INICIADO",
      providerAccepted: row.providerMessageId ? "SIM" : "NAO",
    };
  });
}
