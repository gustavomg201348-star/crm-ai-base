import type { Prisma } from "@prisma/client";

export type LeadTemperature = "HOT" | "WARM" | "COLD";

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
