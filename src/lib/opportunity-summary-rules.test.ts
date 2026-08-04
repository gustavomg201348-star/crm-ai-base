import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunitySummary } from "./opportunity-summary-rules";
import type { BuildOpportunitySummaryInput } from "./opportunity-summary-types";

const now = new Date("2026-08-04T12:00:00.000Z");

function baseInput(overrides: Partial<BuildOpportunitySummaryInput> = {}): BuildOpportunitySummaryInput {
  return {
    now,
    conversation: {
      id: "conversation-1",
      contactId: "contact-1",
      agentId: "user-1",
      unreadCount: 0,
      lastMessageAt: null,
      lastInboundMessageAt: null,
      lastReadAt: null,
      updatedAt: new Date("2026-08-04T10:00:00.000Z"),
      status: "OPEN",
      contact: {
        id: "contact-1",
        temperature: "WARM",
        stage: null,
        tags: []
      },
      messages: []
    },
    pendingTasks: [],
    proposals: [],
    campaignRecipients: [],
    retirementLead: null,
    recentCltSimulation: null,
    ...overrides
  };
}

test("mensagem inbound recente recomenda responder cliente", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        lastInboundMessageAt: new Date("2026-08-04T11:50:00.000Z"),
        messages: [
          {
            id: "message-1",
            direction: "inbound",
            body: "Quero saber mais",
            createdAt: new Date("2026-08-04T11:50:00.000Z")
          }
        ]
      }
    })
  );

  assert.equal(summary.commercialState.type, "ACTION_REQUIRED");
  assert.equal(summary.recommendedAction.type, "RESPOND_CUSTOMER");
  assert.equal(summary.evidences[0]?.type, "CUSTOMER_REPLIED_RECENTLY");
});

test("retorno vencido recomenda follow-up e exige acao", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      pendingTasks: [
        {
          id: "task-1",
          title: "Retorno: cliente pediu contato",
          dueAt: new Date("2026-08-04T09:00:00.000Z"),
          status: "PENDING",
          assignee: { id: "user-1", name: "Laura" }
        }
      ]
    })
  );

  assert.equal(summary.commercialState.type, "ACTION_REQUIRED");
  assert.equal(summary.recommendedAction.type, "FOLLOW_UP");
  assert.equal(summary.pendingReturn?.overdue, true);
});

test("retorno futuro mantém follow-up e recomenda aguardar", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      pendingTasks: [
        {
          id: "task-1",
          title: "Retorno amanha",
          dueAt: new Date("2026-08-05T12:00:00.000Z"),
          status: "PENDING",
          assignee: null
        }
      ]
    })
  );

  assert.equal(summary.commercialState.type, "FOLLOW_UP");
  assert.equal(summary.recommendedAction.type, "WAIT");
  assert.equal(summary.evidences[0]?.type, "RETURN_SCHEDULED");
});

test("proposta ativa gera estado de proposta e recomenda revisão", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-1",
          product: "CLT",
          status: "FORMALIZING",
          amount: "5800",
          updatedAt: new Date("2026-08-04T08:00:00.000Z"),
          assignedUser: { id: "user-1", name: "Laura" }
        }
      ]
    })
  );

  assert.equal(summary.probableProduct.type, "CLT");
  assert.equal(summary.commercialState.type, "PROPOSAL");
  assert.equal(summary.recommendedAction.type, "REVIEW_PROPOSAL");
});

test("proposta ativa com inbound recente prioriza resposta ao cliente", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        lastInboundMessageAt: new Date("2026-08-04T11:40:00.000Z"),
        messages: [
          {
            id: "message-1",
            direction: "inbound",
            body: "Pode continuar",
            createdAt: new Date("2026-08-04T11:40:00.000Z")
          }
        ]
      },
      proposals: [
        {
          id: "proposal-1",
          product: "FGTS",
          status: "ANALYSIS",
          amount: "1200",
          updatedAt: new Date("2026-08-04T08:00:00.000Z"),
          assignedUser: null
        }
      ]
    })
  );

  assert.equal(summary.commercialState.type, "ACTION_REQUIRED");
  assert.equal(summary.recommendedAction.type, "RESPOND_CUSTOMER");
});

test("contato quente sem proposta mantém evidência HOT", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        contact: {
          ...baseInput().conversation.contact,
          temperature: "HOT",
          tags: [{ tag: { id: "tag-1", name: "FGTS" } }]
        }
      }
    })
  );

  assert.equal(summary.probableProduct.type, "FGTS");
  assert.equal(summary.commercialState.type, "NURTURING");
  assert.equal(summary.evidences.some((evidence) => evidence.type === "HOT_CONTACT"), true);
  assert.equal(summary.recommendedAction.type, "SEND_TEMPLATE");
});

test("contato quente com produto CLT recomenda simulaÃ§Ã£o CLT", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        contact: {
          ...baseInput().conversation.contact,
          temperature: "HOT",
          tags: [{ tag: { id: "tag-1", name: "CLT" } }]
        }
      }
    })
  );

  assert.equal(summary.probableProduct.type, "CLT");
  assert.equal(summary.recommendedAction.type, "SIMULATE_CLT");
});

test("contato quente com produto nÃ£o CLT nÃ£o recomenda simulaÃ§Ã£o CLT", () => {
  const products = [
    { tag: "FGTS", expected: "FGTS" },
    { tag: "INSS", expected: "INSS" },
    { tag: "Multicred", expected: "MULTICRED" },
    { tag: "Portabilidade", expected: "PORTABILITY" },
    { tag: "Seguro", expected: "INSURANCE" }
  ] as const;

  for (const product of products) {
    const summary = buildOpportunitySummary(
      baseInput({
        conversation: {
          ...baseInput().conversation,
          contact: {
            ...baseInput().conversation.contact,
            temperature: "HOT",
            tags: [{ tag: { id: "tag-1", name: product.tag } }]
          }
        }
      })
    );

    assert.equal(summary.probableProduct.type, product.expected);
    assert.notEqual(summary.recommendedAction.type, "SIMULATE_CLT");
  }
});

test("sem dados suficientes retorna sem oportunidade clara e sem acao", () => {
  const summary = buildOpportunitySummary(baseInput());

  assert.equal(summary.probableProduct.type, "UNKNOWN");
  assert.equal(summary.commercialState.type, "NO_CLEAR_OPPORTUNITY");
  assert.equal(summary.recommendedAction.type, "NO_ACTION");
  assert.equal(summary.contextLevel, "LOW");
});

test("produto desconhecido permanece UNKNOWN quando não há evidência confiável", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        contact: {
          ...baseInput().conversation.contact,
          stage: { name: "Qualificacao" },
          tags: [{ tag: { id: "tag-1", name: "Prioridade" } }]
        }
      }
    })
  );

  assert.equal(summary.probableProduct.type, "UNKNOWN");
});

test("proposta paga sem outro sinal nÃ£o define produto atual", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-1",
          product: "FGTS",
          status: "PAID",
          amount: "1200",
          updatedAt: new Date("2026-07-10T10:00:00.000Z"),
          assignedUser: null
        }
      ]
    })
  );

  assert.equal(summary.probableProduct.type, "UNKNOWN");
  assert.equal(summary.commercialState.type, "NO_CLEAR_OPPORTUNITY");
});

test("proposta rejeitada sem outro sinal nÃ£o define produto atual", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-1",
          product: "CLT",
          status: "REJECTED",
          amount: "5800",
          updatedAt: new Date("2026-07-10T10:00:00.000Z"),
          assignedUser: null
        }
      ]
    })
  );

  assert.equal(summary.probableProduct.type, "UNKNOWN");
  assert.equal(summary.commercialState.type, "NO_CLEAR_OPPORTUNITY");
});

test("simulaÃ§Ã£o CLT recente tem precedÃªncia sobre proposta fechada antiga", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-1",
          product: "FGTS",
          status: "CANCELED",
          amount: "1200",
          updatedAt: new Date("2026-07-10T10:00:00.000Z"),
          assignedUser: null
        }
      ],
      recentCltSimulation: {
        id: "clt-1",
        status: "SUCCESS",
        createdAt: new Date("2026-08-04T09:00:00.000Z"),
      }
    })
  );

  assert.equal(summary.probableProduct.type, "CLT");
});

test("retirement lead ativo tem precedÃªncia sobre proposta fechada antiga", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-1",
          product: "CLT",
          status: "PAID",
          amount: "5800",
          updatedAt: new Date("2026-07-10T10:00:00.000Z"),
          assignedUser: null
        }
      ],
      retirementLead: {
        id: "retirement-1",
        score: 75,
        interestLevel: "HIGH",
        journeyStatus: "READY_TO_CONVERT",
        updatedAt: new Date("2026-08-04T09:00:00.000Z")
      }
    })
  );

  assert.equal(summary.probableProduct.type, "INSS");
});

test("retirement lead encerrado nÃ£o domina produto provÃ¡vel", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      retirementLead: {
        id: "retirement-1",
        score: 90,
        interestLevel: "HIGH",
        journeyStatus: "LOST",
        updatedAt: new Date("2026-08-04T09:00:00.000Z")
      }
    })
  );

  assert.equal(summary.probableProduct.type, "UNKNOWN");
  assert.equal(
    summary.evidences.some((evidence) => evidence.type === "HIGH_RETIREMENT_SCORE"),
    false
  );
});

test("proposta ativa tem precedÃªncia sobre propostas encerradas", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      proposals: [
        {
          id: "proposal-closed",
          product: "FGTS",
          status: "PAID",
          amount: "1200",
          updatedAt: new Date("2026-08-04T10:00:00.000Z"),
          assignedUser: null
        },
        {
          id: "proposal-active",
          product: "CLT",
          status: "ANALYSIS",
          amount: "5800",
          updatedAt: new Date("2026-08-03T10:00:00.000Z"),
          assignedUser: null
        }
      ]
    })
  );

  assert.equal(summary.probableProduct.type, "CLT");
  assert.equal(summary.activeProposal?.id, "proposal-active");
});

test("contexto sobe para alto quando produto, proposta, interação recente e responsável existem", () => {
  const summary = buildOpportunitySummary(
    baseInput({
      conversation: {
        ...baseInput().conversation,
        agentId: "user-1",
        lastInboundMessageAt: new Date("2026-08-04T11:50:00.000Z"),
        messages: [
          {
            id: "message-1",
            direction: "inbound",
            body: "Pode formalizar",
            createdAt: new Date("2026-08-04T11:50:00.000Z")
          }
        ]
      },
      proposals: [
        {
          id: "proposal-1",
          product: "CLT",
          status: "APPROVED",
          amount: "9000",
          updatedAt: new Date("2026-08-04T10:00:00.000Z"),
          assignedUser: { id: "user-1", name: "Laura" }
        }
      ],
      pendingTasks: [
        {
          id: "task-1",
          title: "Conferir documento",
          dueAt: new Date("2026-08-05T12:00:00.000Z"),
          status: "PENDING",
          assignee: { id: "user-1", name: "Laura" }
        }
      ]
    })
  );

  assert.equal(summary.contextLevel, "HIGH");
});

test("montagem do resumo não cria tarefa nem persiste oportunidade", () => {
  const input = baseInput({
    pendingTasks: [
      {
        id: "task-1",
        title: "Retorno existente",
        dueAt: new Date("2026-08-05T12:00:00.000Z"),
        status: "PENDING",
        assignee: null
      }
    ]
  });
  const beforeTasks = input.pendingTasks.length;
  const summary = buildOpportunitySummary(input);

  assert.equal(input.pendingTasks.length, beforeTasks);
  assert.equal(summary.pendingReturn?.id, "task-1");
  assert.equal("id" in summary && summary.contactId === "contact-1", true);
});
