import type { Prisma } from "@prisma/client";

export type ProposalStatus =
  | "NEW"
  | "TYPED"
  | "ANALYSIS"
  | "PENDING"
  | "APPROVED"
  | "PAID"
  | "CANCELED"
  | "REJECTED"
  | "DRAFT"
  | "FORMALIZING"
  | "REWORK";

export const proposalStatuses: ProposalStatus[] = [
  "NEW",
  "TYPED",
  "ANALYSIS",
  "PENDING",
  "APPROVED",
  "DRAFT",
  "FORMALIZING",
  "PAID",
  "CANCELED",
  "REJECTED",
  "REWORK"
];

export const proposalInclude = {
  multicredClient: true,
  assignedUser: {
    select: { id: true, name: true, email: true, role: true }
  },
  history: {
    orderBy: { createdAt: "desc" },
    take: 12,
    include: {
      user: {
        select: { id: true, name: true, email: true }
      }
    }
  },
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
    multicredClientId: proposal.multicredClientId,
    assignedUserId: proposal.assignedUserId,
    bank: proposal.bank,
    agreement: proposal.agreement,
    product: proposal.product,
    operation: proposal.operation,
    proposalNumber: proposal.proposalNumber,
    contractNumber: proposal.contractNumber,
    amount: proposal.amount.toString(),
    financedAmount: proposal.financedAmount?.toString() ?? null,
    releasedAmount: proposal.releasedAmount?.toString() ?? null,
    installmentAmount: proposal.installmentAmount?.toString() ?? null,
    term: proposal.term,
    commission: proposal.commission.toString(),
    commissionReceived: proposal.commissionReceived?.toString() ?? null,
    notes: proposal.notes,
    status: proposal.status as ProposalStatus,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
    assignedUser: proposal.assignedUser
      ? {
          id: proposal.assignedUser.id,
          name: proposal.assignedUser.name,
          email: proposal.assignedUser.email,
          role: proposal.assignedUser.role
        }
      : null,
    history: proposal.history.map((event) => ({
      id: event.id,
      action: event.action,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt,
      user: event.user
        ? {
            id: event.user.id,
            name: event.user.name,
            email: event.user.email
          }
        : null
    })),
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
    },
    multicredClient: proposal.multicredClient
      ? {
          id: proposal.multicredClient.id,
          name: proposal.multicredClient.name,
          cpf: proposal.multicredClient.cpf,
          phone: proposal.multicredClient.phone,
          whatsapp: proposal.multicredClient.whatsapp,
          bank: proposal.multicredClient.bank,
          agency: proposal.multicredClient.agency,
          account: proposal.multicredClient.account,
          pixKey: proposal.multicredClient.pixKey
        }
      : null
  };
}
