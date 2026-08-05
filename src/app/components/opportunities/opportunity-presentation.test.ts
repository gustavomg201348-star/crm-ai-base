import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMissionMessage,
  buildMissionSummary,
  buildTeamSummary,
  getMissionCopy,
  getVisibleOpportunityGroups,
  groupOpportunityItems
} from "@/app/components/opportunities/opportunity-presentation";
import type { OpportunityQueueItem } from "@/app/components/opportunities/types";

function createItem(overrides: Partial<OpportunityQueueItem> = {}): OpportunityQueueItem {
  return {
    id: overrides.id ?? "conversation-1",
    companyId: "company-1",
    conversationId: overrides.conversationId ?? overrides.id ?? "conversation-1",
    contact: overrides.contact ?? {
      id: `contact-${overrides.id ?? "1"}`,
      name: "Cliente Teste",
      phone: null
    },
    owner: overrides.owner ?? null,
    priority: overrides.priority ?? {
      type: "NORMAL",
      label: "Normal"
    },
    product: overrides.product ?? {
      type: "UNKNOWN",
      label: "Produto não identificado",
      reason: "Sem produto provável."
    },
    commercialState: overrides.commercialState ?? {
      type: "FOLLOW_UP",
      label: "Acompanhar"
    },
    queueReason: overrides.queueReason ?? "Motivo de teste",
    situationTitle: overrides.situationTitle ?? "Situação de teste",
    situationExplanation: overrides.situationExplanation ?? "Explicação de teste",
    primaryAction: overrides.primaryAction ?? {
      title: "Ação com texto variável",
      reason: "Motivo da ação",
      actionable: true
    },
    displayEvidences: overrides.displayEvidences ?? [],
    lastRelevantInteraction: overrides.lastRelevantInteraction ?? {
      type: "NONE",
      label: "Sem interação",
      occurredAt: null
    },
    pendingReturn: overrides.pendingReturn ?? null,
    activeProposal: overrides.activeProposal ?? null,
    updatedAt: overrides.updatedAt ?? "2026-08-04T12:00:00.000Z"
  };
}

function getCountByGroup(items: OpportunityQueueItem[], title: string) {
  return groupOpportunityItems(items).find((group) => group.title === title)?.items.length ?? 0;
}

test("mission copy uses complete language when there is no next cursor", () => {
  assert.deepEqual(getMissionCopy(false), {
    title: "Hoje existem oportunidades relevantes.",
    helper: null
  });
});

test("mission copy uses partial language when there is a next cursor", () => {
  assert.deepEqual(getMissionCopy(true), {
    title: "Entre as principais oportunidades carregadas, há trabalho relevante para a equipe.",
    helper: "Existem outras oportunidades além das exibidas nesta visão."
  });
});

test("mission message uses loaded totals and partial language when there is a next cursor", () => {
  const summary = {
    total: 18,
    respondNow: 4,
    returns: 3,
    negotiation: 5
  };

  assert.equal(
    buildMissionMessage(summary, false),
    "Hoje existem 18 oportunidades relevantes. Comece por 4 clientes aguardando resposta, 3 retornos e 5 propostas em andamento."
  );
  assert.equal(
    buildMissionMessage(summary, true),
    "Entre as principais oportunidades carregadas, existem 18 oportunidades relevantes. Comece por 4 clientes aguardando resposta, 3 retornos e 5 propostas em andamento."
  );
});

test("ACTION_REQUIRED enters Responder agora without depending on action text", () => {
  const item = createItem({
    id: "respond",
    commercialState: { type: "ACTION_REQUIRED", label: "Texto qualquer" },
    primaryAction: { title: "Atender cliente", reason: "Texto alterado", actionable: true }
  });

  assert.equal(getCountByGroup([item], "Responder agora"), 1);
});

test("structured inbound evidences enter Responder agora without depending on labels", () => {
  const item = createItem({
    id: "unread",
    displayEvidences: [
      {
        type: "UNREAD_MESSAGES",
        label: "Copy mutável",
        occurredAt: "2026-08-04T11:00:00.000Z" as unknown as Date,
        sourceType: "conversation",
        sourceId: "conversation-1"
      }
    ]
  });

  assert.equal(getCountByGroup([item], "Responder agora"), 1);
});

test("pending return enters Retornos", () => {
  const item = createItem({
    id: "return",
    pendingReturn: {
      id: "task-1",
      title: "Retorno",
      dueAt: "2026-08-04T10:00:00.000Z" as unknown as Date,
      overdue: true,
      assignee: null
    }
  });

  assert.equal(getCountByGroup([item], "Retornos"), 1);
});

test("active proposal enters Em negociação", () => {
  const item = createItem({
    id: "proposal",
    activeProposal: {
      id: "proposal-1",
      product: "CLT",
      status: "ACTIVE",
      amount: null,
      assignedUser: null,
      updatedAt: "2026-08-04T10:00:00.000Z" as unknown as Date
    }
  });

  assert.equal(getCountByGroup([item], "Em negociação"), 1);
});

test("WAITING_CUSTOMER enters Aguardando cliente", () => {
  const item = createItem({
    id: "waiting",
    commercialState: { type: "WAITING_CUSTOMER", label: "Aguardando" }
  });

  assert.equal(getCountByGroup([item], "Aguardando cliente"), 1);
});

test("NURTURING enters Voltar a falar", () => {
  const item = createItem({
    id: "nurturing",
    commercialState: { type: "NURTURING", label: "Nutrição" }
  });

  assert.equal(getCountByGroup([item], "Voltar a falar"), 1);
});

test("unmapped item enters Outras oportunidades", () => {
  const item = createItem({
    id: "other",
    commercialState: { type: "FOLLOW_UP", label: "Acompanhar" }
  });

  assert.equal(getCountByGroup([item], "Outras oportunidades"), 1);
});

test("every item appears once and mission counts match group quantities", () => {
  const items = [
    createItem({ id: "a", commercialState: { type: "ACTION_REQUIRED", label: "A" } }),
    createItem({ id: "b", commercialState: { type: "WAITING_CUSTOMER", label: "B" } }),
    createItem({ id: "c", commercialState: { type: "NURTURING", label: "C" } }),
    createItem({ id: "d", commercialState: { type: "FOLLOW_UP", label: "D" } })
  ];

  const groups = groupOpportunityItems(items);
  const groupedIds = groups.flatMap((group) => group.items.map((item) => item.id));
  const uniqueIds = new Set(groupedIds);

  assert.equal(groupedIds.length, items.length);
  assert.equal(uniqueIds.size, items.length);
  assert.equal(
    groups.reduce((total, group) => total + group.items.length, 0),
    items.length
  );
  assert.deepEqual(buildMissionSummary(groups), {
    total: 4,
    respondNow: 1,
    returns: 0,
    negotiation: 0
  });
});

test("changing action title does not change grouping", () => {
  const base = createItem({
    id: "copy-a",
    commercialState: { type: "ACTION_REQUIRED", label: "Ação necessária" },
    primaryAction: { title: "Responder cliente", reason: "Original", actionable: true }
  });
  const changed = createItem({
    ...base,
    id: "copy-b",
    primaryAction: { title: "Atender agora", reason: "Copy alterada", actionable: true }
  });

  assert.equal(getCountByGroup([base], "Responder agora"), 1);
  assert.equal(getCountByGroup([changed], "Responder agora"), 1);
});

test("visible groups hide empty groups and respect the initial list limit", () => {
  const items = [
    createItem({ id: "a", commercialState: { type: "ACTION_REQUIRED", label: "A" } }),
    createItem({ id: "b", commercialState: { type: "WAITING_CUSTOMER", label: "B" } }),
    createItem({ id: "c", commercialState: { type: "NURTURING", label: "C" } })
  ];

  const visibleGroups = getVisibleOpportunityGroups({
    groups: groupOpportunityItems(items),
    limit: 2,
    expanded: false
  });

  assert.deepEqual(
    visibleGroups.map((group) => group.title),
    ["Responder agora", "Aguardando cliente"]
  );
  assert.equal(
    visibleGroups.reduce((total, group) => total + group.items.length, 0),
    2
  );
});

test("team summary groups opportunities by owner and keeps unassigned visible", () => {
  const items = [
    createItem({ id: "a", owner: { id: "owner-1", name: "Ana" } }),
    createItem({ id: "b", owner: { id: "owner-1", name: "Ana" } }),
    createItem({ id: "c", owner: null })
  ];

  assert.deepEqual(buildTeamSummary(items), [
    { id: "owner-1", name: "Ana", total: 2 },
    { id: "unassigned", name: "Sem responsável", total: 1 }
  ]);
});
