import { Prisma, type PrismaClient } from "@prisma/client";
import { classifyPhoneNormalization } from "@/lib/phone-normalization.service";
import { safeLogWarn } from "@/lib/safe-logger";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

type ContactLookupDbClient = Prisma.TransactionClient | PrismaClient;

export function normalizeContactPhone(phone?: string | null) {
  return phone?.replace(/\D/g, "") ?? "";
}

export function getContactNormalizedPhone(phone?: string | null) {
  return classifyPhoneNormalization(phone).normalizedPhone;
}

export function normalizeContactCpf(cpf?: string | null) {
  return cpf?.replace(/\D/g, "") ?? "";
}

export function formatContactDisplayName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");

  if (!trimmed) {
    return trimmed;
  }

  return trimmed
    .toLocaleLowerCase("pt-BR")
    .replace(/(^|[\s'-])(\S)/g, (_match, prefix: string, letter: string) => {
      return `${prefix}${letter.toLocaleUpperCase("pt-BR")}`;
    });
}

export function isMeaningfulContactName(name?: string | null, phone?: string | null) {
  const trimmed = name?.trim();
  const normalizedPhone = normalizeContactPhone(phone);

  return Boolean(trimmed && trimmed !== normalizedPhone);
}

export function getAutomaticContactNameUpdate({
  currentName,
  incomingName,
  phone
}: {
  currentName?: string | null;
  incomingName?: string | null;
  phone?: string | null;
}) {
  const normalizedCurrent = currentName?.trim().replace(/\s+/g, " ") ?? "";

  if (normalizedCurrent) {
    return null;
  }

  const nextName = incomingName?.trim().replace(/\s+/g, " ");
  const candidate = nextName || "";

  if (!candidate || candidate === normalizedCurrent) {
    return null;
  }

  return {
    previousName: normalizedCurrent || null,
    nextName: candidate
  };
}

export async function findContactByNormalizedPhone(
  db: ContactLookupDbClient,
  {
    companyId,
    phone,
    archived = false
  }: {
    companyId: string;
    phone?: string | null;
    archived?: boolean;
  }
) {
  const normalizedPhone = normalizeContactPhone(phone);
  const contactNormalizedPhone = getContactNormalizedPhone(phone);

  if (!normalizedPhone && !contactNormalizedPhone) {
    return null;
  }

  if (contactNormalizedPhone) {
    const contact = await db.contact.findFirst({
      where: {
        companyId,
        normalizedPhone: contactNormalizedPhone,
        ...(archived ? {} : { archivedAt: null })
      },
      orderBy: { updatedAt: "desc" }
    });

    if (contact) {
      return contact;
    }
  }

  if (!normalizedPhone) {
    return null;
  }

  const phoneWithoutCountryCode =
    normalizedPhone.startsWith("55") && normalizedPhone.length > 11
      ? normalizedPhone.slice(2)
      : "";

  const matches = await db.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Contact"
    WHERE "companyId" = ${companyId}
      ${archived ? Prisma.empty : Prisma.sql`AND "archivedAt" IS NULL`}
      AND (
        regexp_replace("phone", '\\D', '', 'g') = ${normalizedPhone}
        ${
          phoneWithoutCountryCode
            ? Prisma.sql`OR regexp_replace("phone", '\\D', '', 'g') = ${phoneWithoutCountryCode}`
            : Prisma.empty
        }
      )
    ORDER BY
      CASE
        WHEN NULLIF(trim(COALESCE("cpf", '')), '') IS NOT NULL THEN -1
        WHEN NULLIF(trim("name"), '') IS NULL THEN 2
        WHEN trim("name") = regexp_replace("phone", '\\D', '', 'g') THEN 1
        ELSE 0
      END ASC,
      CASE WHEN regexp_replace("phone", '\\D', '', 'g') = ${normalizedPhone} THEN 0 ELSE 1 END ASC,
      "updatedAt" DESC
    LIMIT 1
  `;

  if (matches[0]?.id) {
    return db.contact.findUnique({ where: { id: matches[0].id } });
  }

  return null;
}

export function logContactNameMutationAttempt(input: {
  origin: string;
  file: string;
  functionName: string;
  contactId?: string | null;
  phone?: string | null;
  oldName?: string | null;
  newName?: string | null;
  reason: string;
  allowed: boolean;
}) {
  const { origin, contactId, phone, oldName, newName, allowed } = input;
  const normalizedOld = oldName?.trim() ?? "";
  const normalizedNew = newName?.trim() ?? "";

  if (normalizedOld === normalizedNew) {
    return;
  }

  safeLogWarn("contact-name-audit", "contact name mutation attempt", {
    contactId: contactId ?? null,
    hasPhone: Boolean(normalizeContactPhone(phone)),
    oldNamePresent: Boolean(normalizedOld),
    newNamePresent: Boolean(normalizedNew),
    origin,
    allowed
  });
}

export const contactInclude = {
  owner: true,
  origin: true,
  stage: true,
  tags: { include: { tag: true } },
  conversations: {
    include: { messages: true },
    orderBy: { updatedAt: "desc" },
    take: 3
  },
  proposals: {
    orderBy: { createdAt: "desc" },
    take: 5
  }
} satisfies Prisma.ContactInclude;

export type ContactWithRelations = Prisma.ContactGetPayload<{
  include: typeof contactInclude;
}>;

export function mapContact(contact: ContactWithRelations) {
  return {
    id: contact.id,
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    cpf: contact.cpf,
    internalNote: contact.internalNote,
    temperature: contact.temperature as LeadTemperature,
    lastMessage: contact.lastMessage,
    archivedAt: contact.archivedAt,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt,
    owner: contact.owner?.name ?? "Sem responsavel",
    origin: contact.origin?.name ?? "Sem origem",
    stage: contact.stage?.name ?? "Sem etapa",
    ownerId: contact.ownerId,
    originId: contact.originId,
    stageId: contact.stageId,
    tags: contact.tags.map((item) => ({
      id: item.tag.id,
      name: item.tag.name,
      color: item.tag.color
    })),
    conversations: contact.conversations.map((conversation) => ({
      id: conversation.id,
      status: conversation.status,
      channelId: conversation.channelId,
      channel: conversation.channel,
      summary: conversation.summary,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((message) => ({
        id: message.id,
        direction: message.direction,
        body: message.body,
        createdAt: message.createdAt
      }))
    })),
    proposals: contact.proposals.map((proposal) => ({
      id: proposal.id,
      bank: proposal.bank,
      agreement: proposal.agreement,
      product: proposal.product,
      amount: proposal.amount.toString(),
      commission: proposal.commission.toString(),
      status: proposal.status,
      createdAt: proposal.createdAt
    }))
  };
}
