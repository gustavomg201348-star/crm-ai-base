import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpportunityQueueItem,
  deduplicateOpportunityQueueByContact,
  encodeOpportunityQueueCursor,
  filterOpportunityQueueItems,
  isActionableOpportunitySummary,
  paginateOpportunityQueueItems,
  selectOpportunityQueueOwner,
  sortOpportunityQueueItems,
  type RankedOpportunityQueueItem
} from "./opportunity-queue-rules";
import { parseOpportunityQueueSearchParams } from "./opportunity-queue-query";
import type { OpportunitySummary } from "./opportunity-summary-types";

const baseDate = new Date("2026-08-04T12:00:00.000Z");
const cursorFilters = {
  ownerId: null,
  priority: null,
  productType: null
};

function summary(overrides: Partial<OpportunitySummary> = {}): OpportunitySummary {
  return {
    contactId: "contact-1",
    conversationId: "conversation-1",
    probableProduct: {
      type: "FGTS",
      label: "FGTS",
      reason: "Produto conhecido"
    },
    commercialState: {
      type: "NURTURING",
      label: "Em acompanhamento"
    },
    lastRelevantInteraction: {
      type: "CUSTOMER_MESSAGE",
      label: "Cliente respondeu",
      occurredAt: baseDate
    },
    pendingReturn: null,
    activeProposal: null,
    recentCampaign: null,
    evidences: [
      {
        type: "HOT_CONTACT",
        label: "Contato quente",
        occurredAt: null,
        sourceType: "contact",
        sourceId: "contact-1"
      }
    ],
    displayEvidences: [],
    recommendedAction: {
      type: "SEND_TEMPLATE",
      label: "Nutrir com template",
      reason: "Existe sinal comercial",
      evidenceTypes: ["HOT_CONTACT"]
    },
    recommendedActionReason: "Existe sinal comercial",
    primaryAction: {
      title: "Enviar template",
      reason: "Existe sinal comercial",
      actionable: true
    },
    situationTitle: "Manter em acompanhamento",
    situationExplanation: "Ha sinais comerciais, mas sem urgencia.",
    priority: {
      type: "HIGH",
      label: "Prioridade alta"
    },
    contextExplanation: "Contexto comercial parcial",
    lastInteractionExplanation: "Cliente respondeu agora.",
    productDisplayLabel: "FGTS",
    contextLevel: "MEDIUM",
    ...overrides
  };
}

function queueItem(overrides: Partial<RankedOpportunityQueueItem> = {}): RankedOpportunityQueueItem {
  return {
    id: "conversation-1",
    companyId: "company-1",
    conversationId: "conversation-1",
    contact: {
      id: "contact-1",
      name: "Cliente 1",
      phone: "559999999"
    },
    owner: {
      id: "user-1",
      name: "Laura"
    },
    priority: {
      type: "HIGH",
      label: "Prioridade alta"
    },
    product: {
      type: "FGTS",
      label: "FGTS",
      reason: "Produto conhecido"
    },
    commercialState: {
      type: "NURTURING",
      label: "Em acompanhamento"
    },
    queueReason: "Contato quente",
    situationTitle: "Manter em acompanhamento",
    situationExplanation: "Ha sinais comerciais.",
    primaryAction: {
      title: "Enviar template",
      reason: "Existe sinal comercial",
      actionable: true
    },
    displayEvidences: [],
    lastRelevantInteraction: {
      type: "CUSTOMER_MESSAGE",
      label: "Cliente respondeu",
      occurredAt: baseDate
    },
    pendingReturn: null,
    activeProposal: null,
    updatedAt: baseDate,
    internalSort: {
      priorityRank: 3,
      evidenceRank: 4,
      relevantTimestamp: baseDate.getTime(),
      conversationId: "conversation-1",
      contactId: "contact-1",
      overdue: false
    },
    ...overrides
  };
}

test("inclui apenas summaries com oportunidade acionavel", () => {
  assert.equal(isActionableOpportunitySummary(summary()), true);
  assert.equal(
    isActionableOpportunitySummary(
      summary({
        priority: { type: "NONE", label: "Sem prioridade" },
        commercialState: { type: "NO_CLEAR_OPPORTUNITY", label: "Sem oportunidade clara" },
        recommendedAction: {
          type: "NO_ACTION",
          label: "Sem acao recomendada",
          reason: "Sem sinal",
          evidenceTypes: []
        }
      })
    ),
    false
  );
});

test("nurturing fraco sem produto fica fora da fila", () => {
  assert.equal(
    isActionableOpportunitySummary(
      summary({
        probableProduct: {
          type: "UNKNOWN",
          label: "Produto nao identificado",
          reason: "Sem produto confiavel"
        },
        productDisplayLabel: "Produto ainda nao identificado"
      })
    ),
    false
  );
});

test("campanha recente sozinha fica fora da fila principal", () => {
  assert.equal(
    isActionableOpportunitySummary(
      summary({
        probableProduct: {
          type: "UNKNOWN",
          label: "Produto nao identificado",
          reason: "Sem produto confiavel"
        },
        evidences: [
          {
            type: "RECENT_CAMPAIGN",
            label: "Campanha recente",
            occurredAt: baseDate,
            sourceType: "campaign",
            sourceId: "campaign-1"
          }
        ]
      })
    ),
    false
  );
});

test("monta item sem score no contrato publico", () => {
  const item = buildOpportunityQueueItem({
    companyId: "company-1",
    summary: summary(),
    contact: {
      id: "contact-1",
      name: "Cliente 1",
      phone: "559999999"
    },
    owner: {
      id: "user-1",
      name: "Laura"
    },
    updatedAt: baseDate
  });

  assert.equal(item?.companyId, "company-1");
  assert.equal(item?.conversationId, "conversation-1");
  assert.equal(item?.contact.name, "Cliente 1");
  assert.equal(item?.owner?.id, "user-1");
  assert.equal(item?.queueReason, "Contato quente");
  assert.equal("score" in (item ?? {}), false);
});

test("ordena por prioridade, evidencia dominante e desempate estavel", () => {
  const sorted = sortOpportunityQueueItems([
    queueItem({
      conversationId: "c-low",
      id: "c-low",
      priority: { type: "LOW", label: "Baixa" },
      internalSort: {
        priorityRank: 1,
        evidenceRank: 4,
        relevantTimestamp: baseDate.getTime(),
        conversationId: "c-low",
        contactId: "contact-low",
        overdue: false
      }
    }),
    queueItem({
      conversationId: "c-urgent-b",
      id: "c-urgent-b",
      priority: { type: "URGENT", label: "Urgente" },
      internalSort: {
        priorityRank: 4,
        evidenceRank: 0,
        relevantTimestamp: baseDate.getTime(),
        conversationId: "c-urgent-b",
        contactId: "contact-b",
        overdue: false
      }
    }),
    queueItem({
      conversationId: "c-urgent-a",
      id: "c-urgent-a",
      priority: { type: "URGENT", label: "Urgente" },
      internalSort: {
        priorityRank: 4,
        evidenceRank: 0,
        relevantTimestamp: baseDate.getTime(),
        conversationId: "c-urgent-a",
        contactId: "contact-a",
        overdue: false
      }
    })
  ]);

  assert.deepEqual(
    sorted.map((item) => item.conversationId),
    ["c-urgent-a", "c-urgent-b", "c-low"]
  );
});

test("retorno mais vencido vem antes de retorno vencido recente", () => {
  const sorted = sortOpportunityQueueItems([
    queueItem({
      conversationId: "c-recent-overdue",
      internalSort: {
        priorityRank: 4,
        evidenceRank: 1,
        relevantTimestamp: new Date("2026-08-04T10:00:00.000Z").getTime(),
        conversationId: "c-recent-overdue",
        contactId: "contact-2",
        overdue: true
      }
    }),
    queueItem({
      conversationId: "c-old-overdue",
      internalSort: {
        priorityRank: 4,
        evidenceRank: 1,
        relevantTimestamp: new Date("2026-08-01T10:00:00.000Z").getTime(),
        conversationId: "c-old-overdue",
        contactId: "contact-1",
        overdue: true
      }
    })
  ]);

  assert.equal(sorted[0]?.conversationId, "c-old-overdue");
});

test("deduplica por contactId preservando conversa mais prioritaria", () => {
  const sorted = sortOpportunityQueueItems([
    queueItem({
      conversationId: "c-old",
      contact: { id: "same-contact", name: "Cliente", phone: null },
      internalSort: {
        priorityRank: 2,
        evidenceRank: 3,
        relevantTimestamp: baseDate.getTime(),
        conversationId: "c-old",
        contactId: "same-contact",
        overdue: false
      }
    }),
    queueItem({
      conversationId: "c-inbound",
      contact: { id: "same-contact", name: "Cliente", phone: null },
      internalSort: {
        priorityRank: 4,
        evidenceRank: 0,
        relevantTimestamp: baseDate.getTime(),
        conversationId: "c-inbound",
        contactId: "same-contact",
        overdue: false
      }
    })
  ]);

  const deduped = deduplicateOpportunityQueueByContact(sorted);

  assert.deepEqual(
    deduped.map((item) => item.conversationId),
    ["c-inbound"]
  );
});

test("aplica filtros de prioridade, produto e responsavel", () => {
  const items = [
    queueItem({ conversationId: "c-1", product: { type: "FGTS", label: "FGTS", reason: "" } }),
    queueItem({
      conversationId: "c-2",
      owner: { id: "user-2", name: "Joao" },
      priority: { type: "NORMAL", label: "Normal" },
      product: { type: "CLT", label: "CLT", reason: "" }
    })
  ];

  assert.deepEqual(
    filterOpportunityQueueItems(items, { priority: "NORMAL", productType: "CLT", ownerId: "user-2" })
      .map((item) => item.conversationId),
    ["c-2"]
  );
});

test("seleciona responsavel por agent, owner do contato e proposta ativa", () => {
  assert.deepEqual(
    selectOpportunityQueueOwner({
      conversationAgent: { id: "agent-1", name: "Agente" },
      contactOwner: { id: "owner-1", name: "Owner" },
      activeProposalOwner: { id: "proposal-owner-1", label: "Proposta" }
    }),
    { id: "agent-1", name: "Agente" }
  );
  assert.deepEqual(
    selectOpportunityQueueOwner({
      conversationAgent: null,
      contactOwner: { id: "owner-1", name: "Owner" },
      activeProposalOwner: { id: "proposal-owner-1", label: "Proposta" }
    }),
    { id: "owner-1", name: "Owner" }
  );
  assert.deepEqual(
    selectOpportunityQueueOwner({
      conversationAgent: null,
      contactOwner: null,
      activeProposalOwner: { id: "proposal-owner-1", label: "Proposta" }
    }),
    { id: "proposal-owner-1", name: "Proposta" }
  );
});

test("paginacao usa cursor opaco sem repeticao", () => {
  const items = [
    queueItem({ conversationId: "c-1", internalSort: { ...queueItem().internalSort, conversationId: "c-1" } }),
    queueItem({ conversationId: "c-2", internalSort: { ...queueItem().internalSort, conversationId: "c-2" } }),
    queueItem({ conversationId: "c-3", internalSort: { ...queueItem().internalSort, conversationId: "c-3" } })
  ];

  const firstPage = paginateOpportunityQueueItems(items, {
    limit: 2,
    cursor: null,
    filters: cursorFilters
  });
  assert.equal(firstPage.ok, true);

  if (!firstPage.ok) throw new Error("Primeira pagina deveria ser valida.");

  const secondPage = paginateOpportunityQueueItems(items, {
    limit: 2,
    cursor: firstPage.nextCursor
      ? {
          v: 1,
          filters: cursorFilters,
          sort: items[1].internalSort
        }
      : null,
    filters: cursorFilters
  });

  assert.equal(secondPage.ok, true);
  if (!secondPage.ok) throw new Error("Segunda pagina deveria ser valida.");

  assert.deepEqual(firstPage.items.map((item) => item.conversationId), ["c-1", "c-2"]);
  assert.equal(typeof firstPage.nextCursor, "string");
  assert.deepEqual(secondPage.items.map((item) => item.conversationId), ["c-3"]);
  assert.equal(secondPage.nextCursor, null);
});

test("cursor com filtros diferentes e rejeitado", () => {
  const encoded = encodeOpportunityQueueCursor({
    v: 1,
    filters: cursorFilters,
    sort: queueItem().internalSort
  });
  const decodedCursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const result = paginateOpportunityQueueItems([queueItem()], {
    limit: 1,
    cursor: decodedCursor,
    filters: {
      ...cursorFilters,
      priority: "HIGH"
    }
  });

  assert.equal(result.ok, false);
});

test("filtros invalidos retornam erro de validacao", () => {
  assert.throws(() => parseOpportunityQueueSearchParams(new URLSearchParams("priority=BAD")));
  assert.throws(() => parseOpportunityQueueSearchParams(new URLSearchParams("productType=BAD")));
  assert.throws(() => parseOpportunityQueueSearchParams(new URLSearchParams("limit=zero")));
  assert.throws(() => parseOpportunityQueueSearchParams(new URLSearchParams("limit=0")));
  assert.throws(() => parseOpportunityQueueSearchParams(new URLSearchParams("cursor=not-a-cursor")));
});

test("limit maior que maximo e normalizado para 100", () => {
  const parsed = parseOpportunityQueueSearchParams(new URLSearchParams("limit=200"));

  assert.equal(parsed.limit, 100);
});

test("lista vazia pagina com seguranca", () => {
  const page = paginateOpportunityQueueItems([], {
    limit: 10,
    cursor: null,
    filters: cursorFilters
  });

  assert.equal(page.ok, true);
  if (!page.ok) throw new Error("Pagina vazia deveria ser valida.");
  assert.deepEqual(page.items, []);
  assert.equal(page.nextCursor, null);
});
