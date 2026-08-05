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

export type MissionSummary = {
  total: number;
  respondNow: number;
  returns: number;
  negotiation: number;
};

export type TeamSummaryItem = {
  id: string;
  name: string;
  total: number;
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

export function getVisibleOpportunityGroups({
  groups,
  limit,
  expanded
}: {
  groups: OpportunityGroup[];
  limit: number;
  expanded: boolean;
}): OpportunityGroup[] {
  let remaining = expanded ? Number.POSITIVE_INFINITY : limit;

  return groups.flatMap((group) => {
    if (group.items.length === 0 || remaining <= 0) return [];

    const items = group.items.slice(0, remaining);
    remaining -= items.length;

    return [
      {
        ...group,
        items
      }
    ];
  });
}

export function buildMissionSummary(groups: OpportunityGroup[]): MissionSummary {
  const findGroupTotal = (key: OpportunityGroupKey) =>
    groups.find((group) => group.key === key)?.items.length ?? 0;

  return {
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
    respondNow: findGroupTotal("respond-now"),
    returns: findGroupTotal("returns"),
    negotiation: findGroupTotal("negotiation")
  };
}

export function getMissionCopy(hasMoreItems: boolean): MissionCopy {
  if (!hasMoreItems) {
    return {
      title: "Hoje existem oportunidades relevantes.",
      helper: null
    };
  }

  return {
    title: "Entre as principais oportunidades carregadas, há trabalho relevante para a equipe.",
    helper: "Existem outras oportunidades além das exibidas nesta visão."
  };
}

export function buildMissionMessage(summary: MissionSummary, hasMoreItems: boolean) {
  const prefix = hasMoreItems
    ? `Entre as principais oportunidades carregadas, existem ${summary.total} oportunidades relevantes.`
    : `Hoje existem ${summary.total} oportunidades relevantes.`;

  return `${prefix} Comece por ${summary.respondNow} clientes aguardando resposta, ${summary.returns} retornos e ${summary.negotiation} propostas em andamento.`;
}

export function buildTeamSummary(items: OpportunityQueueItem[]): TeamSummaryItem[] {
  const owners = new Map<string, TeamSummaryItem>();

  for (const item of items) {
    const id = item.owner?.id ?? "unassigned";
    const name = item.owner?.name ?? "Sem responsável";
    const current = owners.get(id) ?? { id, name, total: 0 };

    owners.set(id, {
      ...current,
      total: current.total + 1
    });
  }

  return Array.from(owners.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (a.id === "unassigned") return 1;
    if (b.id === "unassigned") return -1;
    return a.name.localeCompare(b.name);
  });
}
