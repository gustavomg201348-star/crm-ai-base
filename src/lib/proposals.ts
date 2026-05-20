import type { Prisma } from "@prisma/client";

export type ProposalStatus = "DRAFT" | "FORMALIZING" | "PAID" | "CANCELED" | "REWORK";

export const proposalStatuses: ProposalStatus[] = [
  "DRAFT",
  "FORMALIZING",
  "PAID",
  "CANCELED",
  "REWORK"
];

export const proposalInclude = {
  contact: {
    include: {
      owner: true,
      origin: true,
      stage: true,
      tags: { include: { tag: true } }
    }
  }
} satisfies Prisma.ProposalInclude;

export type ProposalWithRelations = Prisma.ProposalGetPayload<{
  include: typeof proposalInclude;
}>;

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && proposalStatuses.includes(value as ProposalStatus);
}

export function mapProposal(proposal: ProposalWithRelations) {
  return {
    id: proposal.id,
    contactId: proposal.contactId,
    bank: proposal.bank,
    agreement: proposal.agreement,
    product: proposal.product,
    amount: proposal.amount.toString(),
    commission: proposal.commission.toString(),
    status: proposal.status as ProposalStatus,
    createdAt: proposal.createdAt,
    contact: {
      id: proposal.contact.id,
      name: proposal.contact.name,
      phone: proposal.contact.phone,
      email: proposal.contact.email,
      cpf: proposal.contact.cpf,
      origin: proposal.contact.origin?.name ?? "Sem origem",
      stage: proposal.contact.stage?.name ?? "Sem etapa",
      temperature: proposal.contact.temperature,
      owner: proposal.contact.owner?.name ?? "Sem responsavel",
      lastMessage: proposal.contact.lastMessage,
      tags: proposal.contact.tags.map((item) => ({
        id: item.tag.id,
        name: item.tag.name,
        color: item.tag.color
      }))
    }
  };
}
