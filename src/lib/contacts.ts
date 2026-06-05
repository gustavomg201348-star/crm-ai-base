import type { Prisma } from "@prisma/client";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

export function normalizeContactPhone(phone?: string | null) {
  return phone?.replace(/\D/g, "") ?? "";
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
  if (isMeaningfulContactName(currentName, phone)) {
    return null;
  }

  const nextName = incomingName?.trim().replace(/\s+/g, " ");
  const fallback = normalizeContactPhone(phone);
  const normalizedCurrent = currentName?.trim().replace(/\s+/g, " ") ?? "";
  const candidate = nextName || normalizedCurrent || fallback;

  if (!candidate || candidate === normalizedCurrent) {
    return null;
  }

  return {
    previousName: normalizedCurrent || null,
    nextName: candidate
  };
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
    name: formatContactDisplayName(contact.name),
    phone: contact.phone,
    email: contact.email,
    cpf: contact.cpf,
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
