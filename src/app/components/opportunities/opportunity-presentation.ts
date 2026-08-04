import type {
  OpportunityGroup,
  OpportunityGroupKey,
  OpportunityQueueItem
} from "@/app/components/opportunities/types";

export const OPPORTUNITY_GROUP_DEFINITIONS: Array<Omit<OpportunityGroup, "items">> = [
  {
    key: "respond-now",
    title: "Responder agora",
    description: "Clientes com sinal recente que merecem uma ação imediata."
  },
  {
    key: "returns",
    title: "Retornos",
    description: "Compromissos comerciais vencidos ou próximos que precisam ser retomados."
  },
  {
    key: "negotiation",
    title: "Em negociação",
    description: "Clientes com proposta ativa ou avanço comercial em andamento."
  },
  {
    key: "waiting-customer",
    title: "Aguardando cliente",
    description: "Conversas em que a próxima decisão depende do retorno do cliente."
  },
  {
    key: "follow-up",
    title: "Voltar a falar",
    description: "Oportunidades úteis para reacender a conversa sem desperdiçar esforço."
  },
  {
    key: "other",
    title: "Outras oportunidades",
    description: "Oportunidades acionáveis que não se encaixam nos blocos principais."
  }
];

export type MissionCopy = {
  title: string;
  helper: string | null;
};

function hasEvidence(
  item: OpportunityQueueItem,
  evidenceType: "CUSTOMER_REPLIED_RECENTLY" | "UNREAD_MESSAGES"
) {
  return item.displayEvidences.some((evidence) => evidence.type === evidenceType);
}

export function getOpportunityGroupKey(item: OpportunityQueueItem): OpportunityGroupKey {
  if (
    item.commercialState.type === "ACTION_REQUIRED" ||
    hasEvidence(item, "CUSTOMER_REPLIED_RECENTLY") ||
    hasEvidence(item, "UNREAD_MESSAGES")
  ) {
    return "respond-now";
  }

  if (item.pendingReturn) return "returns";

  if (item.activeProposal || item.commercialState.type === "PROPOSAL") {
    return "negotiation";
  }

  if (item.commercialState.type === "WAITING_CUSTOMER") {
    return "waiting-customer";
  }

  if (item.commercialState.type === "NURTURING") {
    return "follow-up";
  }

  return "other";
}

export function groupOpportunityItems(items: OpportunityQueueItem[]): OpportunityGroup[] {
  const grouped = new Map<OpportunityGroupKey, OpportunityQueueItem[]>(
    OPPORTUNITY_GROUP_DEFINITIONS.map((group) => [group.key, []])
  );

  for (const item of items) {
    grouped.get(getOpportunityGroupKey(item))?.push(item);
  }

  return OPPORTUNITY_GROUP_DEFINITIONS.map((group) => ({
    ...group,
    items: grouped.get(group.key) ?? []
  }));
}

export function getMissionCopy(hasMoreItems: boolean): MissionCopy {
  if (!hasMoreItems) {
    return {
      title: "Hoje existem:",
      helper: null
    };
  }

  return {
    title: "Entre as principais oportunidades carregadas:",
    helper: "Existem outras oportunidades além das exibidas nesta visão."
  };
}
