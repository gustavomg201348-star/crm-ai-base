import type {
  BuildOpportunitySummaryInput,
  OpportunityActiveProposal,
  OpportunityCommercialState,
  OpportunityContextLevel,
  OpportunityEvidence,
  OpportunityEvidenceType,
  OpportunityLastRelevantInteraction,
  OpportunityPendingReturn,
  OpportunityProductType,
  OpportunityRecentCampaign,
  OpportunityRecommendedAction,
  OpportunitySummary,
  OpportunitySummaryProposalInput
} from "@/lib/opportunity-summary-types";

const ACTIVE_PROPOSAL_STATUSES = new Set([
  "NEW",
  "TYPED",
  "ANALYSIS",
  "PENDING",
  "APPROVED",
  "DRAFT",
  "FORMALIZING",
  "REWORK"
]);

const CLOSED_PROPOSAL_STATUSES = new Set(["PAID", "CANCELED", "REJECTED"]);
const INACTIVE_RETIREMENT_LEAD_STATUSES = new Set(["CONVERTED", "LOST"]);

const PRODUCT_LABELS: Record<OpportunityProductType, string> = {
  UNKNOWN: "Produto nao identificado",
  FGTS: "FGTS",
  CLT: "CLT",
  INSS: "INSS",
  MULTICRED: "Multicred",
  PORTABILITY: "Portabilidade",
  INSURANCE: "Seguro",
  OTHER: "Outro produto"
};

const COMMERCIAL_STATE_LABELS: Record<OpportunityCommercialState, string> = {
  ACTION_REQUIRED: "Precisa de acao",
  WAITING_CUSTOMER: "Aguardando cliente",
  FOLLOW_UP: "Retorno programado",
  PROPOSAL: "Em proposta",
  NURTURING: "Nutrir",
  NO_CLEAR_OPPORTUNITY: "Sem oportunidade clara"
};

export function isActiveProposalStatus(status: string) {
  return ACTIVE_PROPOSAL_STATUSES.has(status.toUpperCase());
}

export function isClosedProposalStatus(status: string) {
  return CLOSED_PROPOSAL_STATUSES.has(status.toUpperCase());
}

function isActiveRetirementLead(
  input: BuildOpportunitySummaryInput["retirementLead"]
): input is NonNullable<BuildOpportunitySummaryInput["retirementLead"]> {
  if (!input) return false;
  return !INACTIVE_RETIREMENT_LEAD_STATUSES.has(input.journeyStatus.toUpperCase());
}

function parseProductType(value?: string | null): OpportunityProductType {
  const normalized = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  if (normalized.includes("FGTS")) return "FGTS";
  if (normalized.includes("CLT")) return "CLT";
  if (normalized.includes("INSS") || normalized.includes("APOSENT")) return "INSS";
  if (normalized.includes("MULTICRED")) return "MULTICRED";
  if (normalized.includes("PORTABIL")) return "PORTABILITY";
  if (normalized.includes("SEGURO")) return "INSURANCE";
  return "OTHER";
}

function getAmountString(amount: OpportunitySummaryProposalInput["amount"]) {
  if (amount === null || amount === undefined) return null;
  return amount.toString();
}

function isInboundWaitingForResponse(input: BuildOpportunitySummaryInput) {
  const lastInboundAt = input.conversation.lastInboundMessageAt;
  if (!lastInboundAt) return false;

  const lastOutbound = [...input.conversation.messages]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .find((message) => message.direction === "outbound");

  if (!lastOutbound) return true;
  return lastInboundAt.getTime() > lastOutbound.createdAt.getTime();
}

function isRecent(date: Date | null | undefined, now: Date, hours: number) {
  if (!date) return false;
  return now.getTime() - date.getTime() <= hours * 60 * 60 * 1000;
}

function selectPendingReturn(input: BuildOpportunitySummaryInput): OpportunityPendingReturn | null {
  const now = input.now ?? new Date();
  const pendingTask = input.pendingTasks
    .filter((task) => task.status === "PENDING")
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0];

  if (!pendingTask) return null;

  return {
    id: pendingTask.id,
    title: pendingTask.title,
    dueAt: pendingTask.dueAt,
    overdue: pendingTask.dueAt.getTime() <= now.getTime(),
    assignee: pendingTask.assignee
      ? { id: pendingTask.assignee.id, label: pendingTask.assignee.name }
      : null
  };
}

function selectActiveProposal(input: BuildOpportunitySummaryInput): OpportunityActiveProposal | null {
  const proposal = input.proposals
    .filter((item) => isActiveProposalStatus(item.status))
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];

  if (!proposal) return null;

  return {
    id: proposal.id,
    product: proposal.product,
    status: proposal.status,
    amount: getAmountString(proposal.amount),
    assignedUser: proposal.assignedUser
      ? { id: proposal.assignedUser.id, label: proposal.assignedUser.name }
      : null,
    updatedAt: proposal.updatedAt
  };
}

function selectRecentCampaign(input: BuildOpportunitySummaryInput): OpportunityRecentCampaign | null {
  const recipient = input.campaignRecipients
    .sort((a, b) => {
      const aDate = a.sentAt ?? a.deliveredAt ?? a.createdAt;
      const bDate = b.sentAt ?? b.deliveredAt ?? b.createdAt;
      return bDate.getTime() - aDate.getTime();
    })[0];

  if (!recipient) return null;

  return {
    id: recipient.campaign.id,
    name: recipient.campaign.name,
    status: recipient.status,
    templateName: recipient.campaign.templateName ?? null,
    channel: recipient.campaign.channel?.name ?? null,
    occurredAt: recipient.sentAt ?? recipient.deliveredAt ?? recipient.createdAt
  };
}

function detectProbableProduct(input: BuildOpportunitySummaryInput, activeProposal: OpportunityActiveProposal | null) {
  if (activeProposal) {
    const type = parseProductType(activeProposal.product);
    return {
      type,
      label: type === "OTHER" ? activeProposal.product : PRODUCT_LABELS[type],
      reason: "Identificado a partir da proposta ativa."
    };
  }

  if (isActiveRetirementLead(input.retirementLead)) {
    return {
      type: "INSS" as const,
      label: PRODUCT_LABELS.INSS,
      reason: "Identificado a partir da base de recem-aposentados."
    };
  }

  if (input.recentCltSimulation) {
    return {
      type: "CLT" as const,
      label: PRODUCT_LABELS.CLT,
      reason: "Identificado por simulacao CLT recente."
    };
  }

  const tags = input.conversation.contact.tags ?? [];
  const stageName = input.conversation.contact.stage?.name ?? "";
  const candidates = [...tags.map((item) => item.tag.name), stageName];

  for (const candidate of candidates) {
    const type = parseProductType(candidate);
    if (type !== "OTHER") {
      return {
        type,
        label: PRODUCT_LABELS[type],
        reason: "Identificado por tag ou etapa comercial."
      };
    }
  }

  return {
    type: "UNKNOWN" as const,
    label: PRODUCT_LABELS.UNKNOWN,
    reason: "Ainda nao ha evidencias confiaveis de produto."
  };
}

function buildLastRelevantInteraction(input: BuildOpportunitySummaryInput): OpportunityLastRelevantInteraction {
  const lastMessage = [...input.conversation.messages].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )[0];

  if (lastMessage) {
    return {
      type: lastMessage.direction === "inbound" ? "CUSTOMER_MESSAGE" : "OPERATOR_MESSAGE",
      label: lastMessage.direction === "inbound" ? "Cliente respondeu" : "Empresa respondeu",
      occurredAt: lastMessage.createdAt
    };
  }

  return {
    type: "NONE",
    label: "Sem interacao registrada",
    occurredAt: null
  };
}

function addEvidence(
  evidences: OpportunityEvidence[],
  evidence: OpportunityEvidence
) {
  if (evidences.some((item) => item.type === evidence.type && item.sourceId === evidence.sourceId)) {
    return;
  }
  evidences.push(evidence);
}

function buildEvidences(input: BuildOpportunitySummaryInput, {
  activeProposal,
  pendingReturn,
  recentCampaign
}: {
  activeProposal: OpportunityActiveProposal | null;
  pendingReturn: OpportunityPendingReturn | null;
  recentCampaign: OpportunityRecentCampaign | null;
}) {
  const now = input.now ?? new Date();
  const evidences: OpportunityEvidence[] = [];

  if (isInboundWaitingForResponse(input) && isRecent(input.conversation.lastInboundMessageAt, now, 72)) {
    addEvidence(evidences, {
      type: "CUSTOMER_REPLIED_RECENTLY",
      label: "Cliente respondeu recentemente",
      occurredAt: input.conversation.lastInboundMessageAt ?? null,
      sourceType: "conversation",
      sourceId: input.conversation.id
    });
  }

  if (pendingReturn?.overdue) {
    addEvidence(evidences, {
      type: "RETURN_OVERDUE",
      label: "Retorno vencido",
      occurredAt: pendingReturn.dueAt,
      sourceType: "task",
      sourceId: pendingReturn.id
    });
  } else if (pendingReturn) {
    addEvidence(evidences, {
      type: "RETURN_SCHEDULED",
      label: "Retorno programado",
      occurredAt: pendingReturn.dueAt,
      sourceType: "task",
      sourceId: pendingReturn.id
    });
  }

  if (activeProposal) {
    addEvidence(evidences, {
      type: "ACTIVE_PROPOSAL",
      label: "Proposta ativa",
      occurredAt: activeProposal.updatedAt,
      sourceType: "proposal",
      sourceId: activeProposal.id
    });
  }

  if (String(input.conversation.contact.temperature ?? "").toUpperCase() === "HOT") {
    addEvidence(evidences, {
      type: "HOT_CONTACT",
      label: "Contato marcado como quente",
      occurredAt: null,
      sourceType: "contact",
      sourceId: input.conversation.contact.id
    });
  }

  if ((input.conversation.unreadCount ?? 0) > 0) {
    addEvidence(evidences, {
      type: "UNREAD_MESSAGES",
      label: "Mensagens nao lidas",
      occurredAt: input.conversation.lastInboundMessageAt ?? input.conversation.updatedAt,
      sourceType: "conversation",
      sourceId: input.conversation.id
    });
  }

  if (recentCampaign && isRecent(recentCampaign.occurredAt, now, 14 * 24)) {
    addEvidence(evidences, {
      type: "RECENT_CAMPAIGN",
      label: "Campanha recente",
      occurredAt: recentCampaign.occurredAt,
      sourceType: "campaign",
      sourceId: recentCampaign.id
    });
  }

  const activeRetirementLead = isActiveRetirementLead(input.retirementLead)
    ? input.retirementLead
    : null;

  if (
    activeRetirementLead &&
    (activeRetirementLead.score >= 70 || activeRetirementLead.interestLevel === "HIGH")
  ) {
    addEvidence(evidences, {
      type: "HIGH_RETIREMENT_SCORE",
      label: "Recem-aposentado com sinal forte",
      occurredAt: activeRetirementLead.updatedAt,
      sourceType: "retirementLead",
      sourceId: activeRetirementLead.id
    });
  }

  if (input.recentCltSimulation && isRecent(input.recentCltSimulation.createdAt, now, 30 * 24)) {
    addEvidence(evidences, {
      type: "RECENT_CLT_SIMULATION",
      label: "Simulacao CLT recente",
      occurredAt: input.recentCltSimulation.createdAt,
      sourceType: "cltSimulation",
      sourceId: input.recentCltSimulation.id
    });
  }

  return evidences
    .sort((a, b) => {
      const priority = [
        "CUSTOMER_REPLIED_RECENTLY",
        "RETURN_OVERDUE",
        "ACTIVE_PROPOSAL",
        "UNREAD_MESSAGES",
        "RETURN_SCHEDULED",
        "HOT_CONTACT",
        "HIGH_RETIREMENT_SCORE",
        "RECENT_CLT_SIMULATION",
        "RECENT_CAMPAIGN"
      ];
      return priority.indexOf(a.type) - priority.indexOf(b.type);
    })
    .slice(0, 6);
}

function hasEvidence(evidences: OpportunityEvidence[], type: OpportunityEvidenceType) {
  return evidences.some((evidence) => evidence.type === type);
}

function determineCommercialState({
  evidences,
  activeProposal,
  pendingReturn,
  probableProductType,
  lastRelevantInteraction
}: {
  evidences: OpportunityEvidence[];
  activeProposal: OpportunityActiveProposal | null;
  pendingReturn: OpportunityPendingReturn | null;
  probableProductType: OpportunityProductType;
  lastRelevantInteraction: OpportunityLastRelevantInteraction;
}): OpportunityCommercialState {
  if (
    hasEvidence(evidences, "CUSTOMER_REPLIED_RECENTLY") ||
    hasEvidence(evidences, "UNREAD_MESSAGES") ||
    hasEvidence(evidences, "RETURN_OVERDUE")
  ) {
    return "ACTION_REQUIRED";
  }

  if (pendingReturn) return "FOLLOW_UP";
  if (activeProposal) return "PROPOSAL";
  if (lastRelevantInteraction.type === "OPERATOR_MESSAGE") return "WAITING_CUSTOMER";
  if (probableProductType !== "UNKNOWN" || evidences.length > 0) return "NURTURING";
  return "NO_CLEAR_OPPORTUNITY";
}

function determineRecommendedAction({
  evidences,
  pendingReturn,
  activeProposal,
  probableProductType,
  commercialState
}: {
  evidences: OpportunityEvidence[];
  pendingReturn: OpportunityPendingReturn | null;
  activeProposal: OpportunityActiveProposal | null;
  probableProductType: OpportunityProductType;
  commercialState: OpportunityCommercialState;
}): OpportunityRecommendedAction {
  if (hasEvidence(evidences, "CUSTOMER_REPLIED_RECENTLY") || hasEvidence(evidences, "UNREAD_MESSAGES")) {
    return {
      type: "RESPOND_CUSTOMER",
      label: "Responder cliente",
      reason: "O cliente enviou mensagem e ainda precisa de resposta.",
      evidenceTypes: evidences
        .filter((item) => ["CUSTOMER_REPLIED_RECENTLY", "UNREAD_MESSAGES"].includes(item.type))
        .map((item) => item.type)
    };
  }

  if (pendingReturn?.overdue) {
    return {
      type: "FOLLOW_UP",
      label: "Fazer retorno",
      reason: "Existe retorno vencido para este contato.",
      evidenceTypes: ["RETURN_OVERDUE"]
    };
  }

  if (activeProposal) {
    return {
      type: "REVIEW_PROPOSAL",
      label: "Revisar proposta",
      reason: "Existe proposta ativa que pode exigir acompanhamento.",
      evidenceTypes: ["ACTIVE_PROPOSAL"]
    };
  }

  if (pendingReturn) {
    return {
      type: "WAIT",
      label: "Aguardar retorno",
      reason: "Ja existe um retorno futuro programado.",
      evidenceTypes: ["RETURN_SCHEDULED"]
    };
  }

  if (probableProductType === "CLT" && hasEvidence(evidences, "HOT_CONTACT")) {
    return {
      type: "SIMULATE_CLT",
      label: "Simular CLT",
      reason: "O contato esta quente e o produto provavel e CLT.",
      evidenceTypes: ["HOT_CONTACT"]
    };
  }

  if (commercialState === "NURTURING") {
    return {
      type: "SEND_TEMPLATE",
      label: "Nutrir com template",
      reason: "Ha sinais comerciais, mas sem urgencia para atendimento imediato.",
      evidenceTypes: evidences.map((item) => item.type).slice(0, 2)
    };
  }

  return {
    type: "NO_ACTION",
    label: "Sem acao recomendada",
    reason: "Nao ha sinais comerciais suficientes neste momento.",
    evidenceTypes: []
  };
}

function determineContextLevel({
  probableProductType,
  activeProposal,
  pendingReturn,
  evidences,
  hasOwner
}: {
  probableProductType: OpportunityProductType;
  activeProposal: OpportunityActiveProposal | null;
  pendingReturn: OpportunityPendingReturn | null;
  evidences: OpportunityEvidence[];
  hasOwner: boolean;
}): OpportunityContextLevel {
  const hasProduct = probableProductType !== "UNKNOWN";
  const hasRecentInteraction = hasEvidence(evidences, "CUSTOMER_REPLIED_RECENTLY");

  if (hasProduct && (activeProposal || pendingReturn) && hasRecentInteraction && hasOwner) {
    return "HIGH";
  }

  if (hasProduct || activeProposal || pendingReturn || evidences.length >= 2) {
    return "MEDIUM";
  }

  return "LOW";
}

export function buildOpportunitySummary(input: BuildOpportunitySummaryInput): OpportunitySummary {
  const pendingReturn = selectPendingReturn(input);
  const activeProposal = selectActiveProposal(input);
  const recentCampaign = selectRecentCampaign(input);
  const probableProduct = detectProbableProduct(input, activeProposal);
  const lastRelevantInteraction = buildLastRelevantInteraction(input);
  const evidences = buildEvidences(input, {
    activeProposal,
    pendingReturn,
    recentCampaign
  });
  const commercialStateType = determineCommercialState({
    evidences,
    activeProposal,
    pendingReturn,
    probableProductType: probableProduct.type,
    lastRelevantInteraction
  });
  const recommendedAction = determineRecommendedAction({
    evidences,
    activeProposal,
    pendingReturn,
    probableProductType: probableProduct.type,
    commercialState: commercialStateType
  });
  const contextLevel = determineContextLevel({
    probableProductType: probableProduct.type,
    activeProposal,
    pendingReturn,
    evidences,
    hasOwner: Boolean(input.conversation.agentId)
  });

  return {
    contactId: input.conversation.contactId,
    conversationId: input.conversation.id,
    probableProduct,
    commercialState: {
      type: commercialStateType,
      label: COMMERCIAL_STATE_LABELS[commercialStateType]
    },
    lastRelevantInteraction,
    pendingReturn,
    activeProposal,
    recentCampaign,
    evidences,
    recommendedAction,
    recommendedActionReason: recommendedAction.reason,
    contextLevel
  };
}
