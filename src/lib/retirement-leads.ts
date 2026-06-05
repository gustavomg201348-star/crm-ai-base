import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const retirementInterestLevels = ["NONE", "LOW", "MEDIUM", "HIGH"] as const;
export const retirementJourneyStatuses = [
  "IMPORTED",
  "FIRST_CONTACT",
  "RESPONDED",
  "INTERESTED",
  "NURTURING",
  "PRE_UNLOCK",
  "READY_TO_CONVERT",
  "CONVERTED",
  "LOST"
] as const;

export type RetirementInterestLevel = (typeof retirementInterestLevels)[number];
export type RetirementJourneyStatus = (typeof retirementJourneyStatuses)[number];

export const retirementLeadInclude = {
  contact: {
    include: {
      owner: true,
      tags: { include: { tag: true } }
    }
  },
  events: {
    include: { createdBy: true },
    orderBy: { createdAt: "desc" },
    take: 20
  }
} satisfies Prisma.RetirementLeadInclude;

type RetirementLeadWithRelations = Prisma.RetirementLeadGetPayload<{
  include: typeof retirementLeadInclude;
}>;

export function normalizeRetirementStatus(value?: string | null) {
  return retirementJourneyStatuses.includes(value as RetirementJourneyStatus)
    ? (value as RetirementJourneyStatus)
    : "IMPORTED";
}

export function normalizeInterestLevel(value?: string | null) {
  return retirementInterestLevels.includes(value as RetirementInterestLevel)
    ? (value as RetirementInterestLevel)
    : "NONE";
}

export function calculateEstimatedUnlockDate(grantDate?: Date | null) {
  if (!grantDate) return null;
  const date = new Date(grantDate);
  date.setDate(date.getDate() + 90);
  return date;
}

export function calculateDaysToUnlock(estimatedUnlockDate?: Date | null) {
  if (!estimatedUnlockDate) return null;
  const today = new Date();
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const end = Date.UTC(
    estimatedUnlockDate.getFullYear(),
    estimatedUnlockDate.getMonth(),
    estimatedUnlockDate.getDate()
  );
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

export function recalculateRetirementLeadScore(input: {
  interestLevel?: string | null;
  daysToUnlock?: number | null;
  hasCorrespondent?: boolean | null;
  manualScore?: number | null;
}) {
  if (typeof input.manualScore === "number" && Number.isFinite(input.manualScore)) {
    return Math.max(0, Math.min(100, Math.round(input.manualScore)));
  }

  let score = 0;
  if (input.interestLevel === "HIGH") score += 40;
  if (input.interestLevel === "MEDIUM") score += 25;
  if (input.interestLevel === "LOW") score += 10;
  if (typeof input.daysToUnlock === "number") {
    if (input.daysToUnlock <= 15) score += 35;
    else if (input.daysToUnlock <= 30) score += 25;
    else if (input.daysToUnlock <= 60) score += 15;
    else if (input.daysToUnlock <= 90) score += 8;
  }
  if (input.hasCorrespondent) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function parseOptionalDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalDecimal(value?: string | number | null) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

export function mapRetirementLead(lead: RetirementLeadWithRelations) {
  return {
    id: lead.id,
    companyId: lead.companyId,
    contactId: lead.contactId,
    grantDate: lead.grantDate,
    estimatedUnlockDate: lead.estimatedUnlockDate,
    daysToUnlock: lead.daysToUnlock,
    benefitType: lead.benefitType,
    benefitNumber: lead.benefitNumber,
    state: lead.state,
    city: lead.city,
    desiredAmount: lead.desiredAmount?.toString() ?? null,
    interestLevel: lead.interestLevel,
    hasCorrespondent: lead.hasCorrespondent,
    score: lead.score,
    journeyStatus: lead.journeyStatus,
    nextContactDate: lead.nextContactDate,
    lastContactDate: lead.lastContactDate,
    notes: lead.notes,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
    contact: {
      id: lead.contact.id,
      name: lead.contact.name,
      phone: lead.contact.phone,
      cpf: lead.contact.cpf,
      owner: lead.contact.owner?.name ?? "Sem responsavel",
      tags: lead.contact.tags.map((item) => ({
        id: item.tag.id,
        name: item.tag.name,
        color: item.tag.color,
        textColor: item.tag.textColor
      }))
    },
    events: lead.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      description: event.description,
      createdAt: event.createdAt,
      createdBy: event.createdBy
        ? { id: event.createdBy.id, name: event.createdBy.name, email: event.createdBy.email }
        : null
    }))
  };
}

export function buildRetirementLeadWhere({
  companyId,
  searchParams
}: {
  companyId: string;
  searchParams: URLSearchParams;
}): Prisma.RetirementLeadWhereInput {
  const state = searchParams.get("state")?.trim();
  const city = searchParams.get("city")?.trim();
  const interestLevel = searchParams.get("interestLevel")?.trim();
  const journeyStatus = searchParams.get("journeyStatus")?.trim();
  const hasCorrespondent = searchParams.get("hasCorrespondent");
  const minScore = Number(searchParams.get("minScore") ?? "");
  const maxDaysToUnlock = Number(searchParams.get("maxDaysToUnlock") ?? "");
  const nextAction = searchParams.get("nextAction")?.trim();
  const search = searchParams.get("search")?.trim();

  return {
    companyId,
    ...(state ? { state: { contains: state } } : {}),
    ...(city ? { city: { contains: city } } : {}),
    ...(interestLevel ? { interestLevel } : {}),
    ...(journeyStatus ? { journeyStatus } : {}),
    ...(hasCorrespondent === "true" ? { hasCorrespondent: true } : {}),
    ...(hasCorrespondent === "false" ? { hasCorrespondent: false } : {}),
    ...(Number.isFinite(minScore) ? { score: { gte: minScore } } : {}),
    ...(Number.isFinite(maxDaysToUnlock)
      ? { daysToUnlock: { lte: maxDaysToUnlock } }
      : {}),
    ...(nextAction === "due"
      ? { nextContactDate: { lte: new Date() } }
      : nextAction === "scheduled"
        ? { nextContactDate: { not: null } }
        : {}),
    ...(search
      ? {
          OR: [
            { benefitNumber: { contains: search } },
            { contact: { name: { contains: search } } },
            { contact: { phone: { contains: search } } },
            { contact: { cpf: { contains: search } } }
          ]
        }
      : {})
  };
}

export async function listRetirementLeads({
  companyId,
  searchParams
}: {
  companyId: string;
  searchParams: URLSearchParams;
}) {
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    100,
    Math.max(10, Number(searchParams.get("pageSize") ?? "25") || 25)
  );
  const where = buildRetirementLeadWhere({ companyId, searchParams });

  const [total, leads, dashboard] = await Promise.all([
    prisma.retirementLead.count({ where }),
    prisma.retirementLead.findMany({
      where,
      include: retirementLeadInclude,
      orderBy: [{ nextContactDate: "asc" }, { estimatedUnlockDate: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    getRetirementLeadDashboard(companyId)
  ]);

  return {
    leads: leads.map(mapRetirementLead),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    dashboard
  };
}

export async function getRetirementLeadDashboard(companyId: string) {
  const baseWhere = { companyId };
  const [
    totalImported,
    until90,
    until60,
    until30,
    until15,
    readyToConvert,
    hotLeads,
    coldLeads
  ] = await Promise.all([
    prisma.retirementLead.count({ where: baseWhere }),
    prisma.retirementLead.count({ where: { ...baseWhere, daysToUnlock: { lte: 90 } } }),
    prisma.retirementLead.count({ where: { ...baseWhere, daysToUnlock: { lte: 60 } } }),
    prisma.retirementLead.count({ where: { ...baseWhere, daysToUnlock: { lte: 30 } } }),
    prisma.retirementLead.count({ where: { ...baseWhere, daysToUnlock: { lte: 15 } } }),
    prisma.retirementLead.count({
      where: { ...baseWhere, journeyStatus: "READY_TO_CONVERT" }
    }),
    prisma.retirementLead.count({
      where: { ...baseWhere, OR: [{ interestLevel: "HIGH" }, { score: { gte: 70 } }] }
    }),
    prisma.retirementLead.count({
      where: { ...baseWhere, OR: [{ interestLevel: "LOW" }, { score: { lte: 20 } }] }
    })
  ]);

  return {
    totalImported,
    until90,
    until60,
    until30,
    until15,
    readyToConvert,
    hotLeads,
    coldLeads
  };
}

export async function getRetirementLead(companyId: string, id: string) {
  const lead = await prisma.retirementLead.findFirst({
    where: { id, companyId },
    include: retirementLeadInclude
  });
  return lead ? mapRetirementLead(lead) : null;
}

export async function upsertRetirementLeadForContact({
  db,
  companyId,
  contactId,
  userId,
  data,
  eventDescription = "Lead importado para jornada de recem-aposentados."
}: {
  db: DbClient;
  companyId: string;
  contactId: string;
  userId?: string | null;
  data: {
    grantDate?: string | Date | null;
    benefitType?: string | null;
    benefitNumber?: string | null;
    state?: string | null;
    city?: string | null;
    desiredAmount?: string | number | null;
    interestLevel?: string | null;
    hasCorrespondent?: boolean | null;
    score?: number | null;
    journeyStatus?: string | null;
    nextContactDate?: string | Date | null;
    lastContactDate?: string | Date | null;
    notes?: string | null;
  };
  eventDescription?: string;
}) {
  const grantDate = parseOptionalDate(data.grantDate);
  const estimatedUnlockDate = calculateEstimatedUnlockDate(grantDate);
  const daysToUnlock = calculateDaysToUnlock(estimatedUnlockDate);
  const interestLevel = normalizeInterestLevel(data.interestLevel);
  const journeyStatus = normalizeRetirementStatus(data.journeyStatus);
  const score = recalculateRetirementLeadScore({
    interestLevel,
    daysToUnlock,
    hasCorrespondent: data.hasCorrespondent,
    manualScore: data.score
  });

  const payload = {
    grantDate,
    estimatedUnlockDate,
    daysToUnlock,
    benefitType: data.benefitType?.trim() || null,
    benefitNumber: data.benefitNumber?.trim() || null,
    state: data.state?.trim().toUpperCase() || null,
    city: data.city?.trim() || null,
    desiredAmount: parseOptionalDecimal(data.desiredAmount),
    interestLevel,
    hasCorrespondent: data.hasCorrespondent ?? false,
    score,
    journeyStatus,
    nextContactDate: parseOptionalDate(data.nextContactDate),
    lastContactDate: parseOptionalDate(data.lastContactDate),
    notes: data.notes?.trim() || null
  };

  const lead = await db.retirementLead.upsert({
    where: { companyId_contactId: { companyId, contactId } },
    update: payload,
    create: {
      companyId,
      contactId,
      ...payload
    }
  });

  await db.retirementLeadEvent.create({
    data: {
      retirementLeadId: lead.id,
      eventType: "IMPORTED",
      description: eventDescription,
      createdByUserId: userId ?? null
    }
  });

  return lead;
}

export async function createRetirementLead({
  companyId,
  userId,
  contactId,
  data
}: {
  companyId: string;
  userId: string;
  contactId: string;
  data: Parameters<typeof upsertRetirementLeadForContact>[0]["data"];
}) {
  return prisma.$transaction(async (tx) => {
    const contact = await tx.contact.findFirst({ where: { id: contactId, companyId } });
    if (!contact) throw new Error("Contato nao encontrado para esta empresa.");
    return upsertRetirementLeadForContact({
      db: tx,
      companyId,
      contactId,
      userId,
      data,
      eventDescription: "Lead criado manualmente."
    });
  });
}

export async function updateRetirementLead({
  companyId,
  userId,
  id,
  data
}: {
  companyId: string;
  userId: string;
  id: string;
  data: Partial<Parameters<typeof upsertRetirementLeadForContact>[0]["data"]>;
}) {
  const current = await prisma.retirementLead.findFirst({ where: { id, companyId } });
  if (!current) return null;

  const grantDate = data.grantDate !== undefined ? parseOptionalDate(data.grantDate) : current.grantDate;
  const estimatedUnlockDate = calculateEstimatedUnlockDate(grantDate);
  const daysToUnlock = calculateDaysToUnlock(estimatedUnlockDate);
  const interestLevel =
    data.interestLevel !== undefined
      ? normalizeInterestLevel(data.interestLevel)
      : current.interestLevel;
  const journeyStatus =
    data.journeyStatus !== undefined
      ? normalizeRetirementStatus(data.journeyStatus)
      : current.journeyStatus;
  const score = recalculateRetirementLeadScore({
    interestLevel,
    daysToUnlock,
    hasCorrespondent:
      data.hasCorrespondent !== undefined ? data.hasCorrespondent : current.hasCorrespondent,
    manualScore: data.score !== undefined ? data.score : current.score
  });
  const statusChanged = journeyStatus !== current.journeyStatus;

  const lead = await prisma.$transaction(async (tx) => {
    const updated = await tx.retirementLead.update({
      where: { id },
      data: {
        ...(data.grantDate !== undefined ? { grantDate, estimatedUnlockDate, daysToUnlock } : {}),
        ...(data.benefitType !== undefined ? { benefitType: data.benefitType?.trim() || null } : {}),
        ...(data.benefitNumber !== undefined
          ? { benefitNumber: data.benefitNumber?.trim() || null }
          : {}),
        ...(data.state !== undefined ? { state: data.state?.trim().toUpperCase() || null } : {}),
        ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
        ...(data.desiredAmount !== undefined
          ? { desiredAmount: parseOptionalDecimal(data.desiredAmount) }
          : {}),
        ...(data.interestLevel !== undefined ? { interestLevel } : {}),
        ...(data.hasCorrespondent !== undefined
          ? { hasCorrespondent: data.hasCorrespondent ?? false }
          : {}),
        score,
        ...(data.journeyStatus !== undefined ? { journeyStatus } : {}),
        ...(data.nextContactDate !== undefined
          ? { nextContactDate: parseOptionalDate(data.nextContactDate) }
          : {}),
        ...(data.lastContactDate !== undefined
          ? { lastContactDate: parseOptionalDate(data.lastContactDate) }
          : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {})
      },
      include: retirementLeadInclude
    });

    if (statusChanged) {
      await tx.retirementLeadEvent.create({
        data: {
          retirementLeadId: id,
          eventType: journeyStatus,
          description: `Status alterado de ${current.journeyStatus} para ${journeyStatus}.`,
          createdByUserId: userId
        }
      });
    }

    return updated;
  });

  return mapRetirementLead(lead);
}

export async function listRetirementLeadEvents(companyId: string, retirementLeadId: string) {
  const lead = await prisma.retirementLead.findFirst({
    where: { id: retirementLeadId, companyId },
    select: { id: true }
  });
  if (!lead) return null;

  return prisma.retirementLeadEvent.findMany({
    where: { retirementLeadId },
    include: { createdBy: true },
    orderBy: { createdAt: "desc" }
  });
}

export async function createRetirementLeadEvent({
  companyId,
  userId,
  retirementLeadId,
  eventType,
  description
}: {
  companyId: string;
  userId: string;
  retirementLeadId: string;
  eventType: string;
  description?: string | null;
}) {
  const lead = await prisma.retirementLead.findFirst({
    where: { id: retirementLeadId, companyId },
    select: { id: true }
  });
  if (!lead) return null;

  return prisma.retirementLeadEvent.create({
    data: {
      retirementLeadId,
      eventType: eventType.trim() || "NOTE",
      description: description?.trim() || null,
      createdByUserId: userId
    },
    include: { createdBy: true }
  });
}
