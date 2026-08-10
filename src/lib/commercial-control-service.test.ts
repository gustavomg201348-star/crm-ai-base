import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getCommercialControlDateRanges,
  getCommercialControlOverview
} from "@/lib/commercial-control-service";
import type { OpportunityQueueResult } from "@/lib/opportunity-queue-types";

function emptyQueue(): Promise<OpportunityQueueResult> {
  return Promise.resolve({
    items: [],
    nextCursor: null,
    total: 0,
    scanned: 0
  });
}

function createEmptyDb(capturedWhere: unknown[] = []) {
  const count = ({ where }: { where: unknown }) => {
    capturedWhere.push(where);
    return Promise.resolve(0);
  };

  return {
    conversation: {
      count,
      findMany: ({ where }: { where: unknown }) => {
        capturedWhere.push(where);
        return Promise.resolve([]);
      }
    },
    task: {
      count,
      findMany: ({ where }: { where: unknown }) => {
        capturedWhere.push(where);
        return Promise.resolve([]);
      }
    },
    proposal: {
      count,
      groupBy: () => Promise.resolve([]),
      findMany: ({ where }: { where: unknown }) => {
        capturedWhere.push(where);
        return Promise.resolve([]);
      }
    },
    campaign: {
      count,
      findMany: () => Promise.resolve([])
    },
    campaignRecipient: { count },
    contact: {
      groupBy: () => Promise.resolve([])
    },
    pipelineStage: {
      findMany: () => Promise.resolve([])
    }
  };
}

describe("getCommercialControlDateRanges", () => {
  it("calcula hoje e amanha no fuso operacional", () => {
    const ranges = getCommercialControlDateRanges({
      now: new Date("2026-08-07T15:00:00.000Z"),
      timeZone: "America/Sao_Paulo"
    });

    assert.equal(ranges.todayStart.toISOString(), "2026-08-07T03:00:00.000Z");
    assert.equal(ranges.todayEnd.toISOString(), "2026-08-08T03:00:00.000Z");
    assert.equal(ranges.tomorrowStart.toISOString(), "2026-08-08T03:00:00.000Z");
    assert.equal(ranges.tomorrowEnd.toISOString(), "2026-08-09T03:00:00.000Z");
  });
});

describe("getCommercialControlOverview", () => {
  it("retorna zeros para empresa sem dados", async () => {
    const overview = await getCommercialControlOverview({
      companyId: "company-empty",
      requesterId: "user-1",
      requesterRole: "ADMIN",
      now: new Date("2026-08-07T15:00:00.000Z"),
      db: createEmptyDb() as never,
      opportunityQueue: emptyQueue as never
    });

    assert.equal(overview.today.activeOrMovedConversations, 0);
    assert.equal(overview.agenda.today.total, 0);
    assert.equal(overview.proposals.createdToday, 0);
    assert.equal(overview.campaigns.todayTotal, 0);
    assert.equal(overview.opportunities.total, 0);
    assert.equal(overview.operationalControl.forgottenClients.total, 0);
    assert.equal(overview.operationalControl.overdueNextActions.total, 0);
    assert.equal(overview.operationalControl.overdueAppointments.total, 0);
    assert.equal(overview.operationalControl.riskyNegotiations.total, 0);
    assert.deepEqual(overview.pipeline.stages, []);
  });

  it("inclui companyId nas consultas agregadas", async () => {
    const capturedWhere: unknown[] = [];

    await getCommercialControlOverview({
      companyId: "company-1",
      requesterId: "user-1",
      requesterRole: "SUPERVISOR",
      now: new Date("2026-08-07T15:00:00.000Z"),
      db: createEmptyDb(capturedWhere) as never,
      opportunityQueue: emptyQueue as never
    });

    assert.ok(
      capturedWhere.every((where) => JSON.stringify(where).includes("company-1")),
      "todas as consultas de contagem precisam carregar companyId"
    );
  });

  it("calcula agenda, propostas, campanhas, oportunidades e funil com dados existentes", async () => {
    const now = new Date("2026-08-07T15:00:00.000Z");
    const dueToday = new Date("2026-08-07T18:00:00.000Z");
    const dueTomorrow = new Date("2026-08-08T18:00:00.000Z");
    const dueOverdue = new Date("2026-08-07T12:00:00.000Z");
    const forgottenUpdatedAt = new Date("2026-08-07T09:00:00.000Z");
    const countValues = [5, 2, 1, 3, 4, 6, 2, 7, 2, 1, 9, 1, 1, 1, 2];
    const nextCount = () => Promise.resolve(countValues.shift() ?? 0);
    let taskFindManyCalls = 0;
    const queue: OpportunityQueueResult = {
      nextCursor: null,
      scanned: 20,
      total: 2,
      items: [
        {
          id: "item-1",
          companyId: "company-1",
          conversationId: "conversation-1",
          contact: { id: "contact-1", name: "Maria", phone: null },
          owner: { id: "user-1", name: "Laura" },
          priority: { type: "URGENT", label: "Urgente" },
          product: { type: "CLT", label: "CLT", reason: "Simulacao recente" },
          commercialState: { type: "ACTION_REQUIRED", label: "Acao necessaria" },
          queueReason: "Cliente respondeu recentemente",
          situationTitle: "Responder agora",
          situationExplanation: "Cliente aguarda retorno.",
          primaryAction: { title: "Enviar template", reason: "Continuar atendimento.", actionable: true },
          displayEvidences: [],
          lastRelevantInteraction: { type: "CUSTOMER_MESSAGE", label: "ha pouco", occurredAt: now },
          pendingReturn: null,
          activeProposal: null,
          updatedAt: now
        },
        {
          id: "item-2",
          companyId: "company-1",
          conversationId: "conversation-2",
          contact: { id: "contact-2", name: "Joao", phone: null },
          owner: null,
          priority: { type: "HIGH", label: "Alta" },
          product: { type: "FGTS", label: "FGTS", reason: "Campanha" },
          commercialState: { type: "NURTURING", label: "Nutrir" },
          queueReason: "Retorno pendente",
          situationTitle: "Retorno",
          situationExplanation: "Retorno exige acao.",
          primaryAction: { title: "Ligar", reason: "Fazer contato.", actionable: true },
          displayEvidences: [],
          lastRelevantInteraction: { type: "OPERATOR_MESSAGE", label: "hoje", occurredAt: now },
          pendingReturn: null,
          activeProposal: null,
          updatedAt: now
        }
      ]
    };
    const db = {
      conversation: {
        count: nextCount,
        findMany: () =>
          Promise.resolve([
            {
              id: "conversation-forgotten",
              updatedAt: forgottenUpdatedAt,
              lastMessageAt: null,
              contact: { id: "contact-forgotten", name: "Carlos", phone: null },
              agent: { id: "user-2", name: "Bruna" }
            }
          ])
      },
      task: {
        count: nextCount,
        findMany: () => {
          taskFindManyCalls += 1;

          if (taskFindManyCalls === 1) {
            return Promise.resolve([
              {
                id: "task-overdue",
                title: "Retornar cliente",
                dueAt: dueOverdue,
                contact: { id: "contact-1", name: "Maria", phone: "553399999999" },
                assignee: { id: "user-1", name: "Laura" }
              },
              {
                id: "task-today",
                title: "Conferir proposta",
                dueAt: dueToday,
                contact: { id: "contact-2", name: "Joao", phone: null },
                assignee: null
              },
              {
                id: "task-tomorrow",
                title: "Ligar amanha",
                dueAt: dueTomorrow,
                contact: { id: "contact-3", name: "Ana", phone: null },
                assignee: null
              }
            ]);
          }

          return Promise.resolve([
            {
              id: "task-action-overdue",
              title: "Conferir margem",
              dueAt: dueOverdue,
              contact: { id: "contact-4", name: "Helena", phone: null },
              assignee: null
            },
            {
              id: "task-appointment-overdue",
              title: "Retorno: cliente pediu ligacao",
              dueAt: dueOverdue,
              contact: { id: "contact-5", name: "Rafael", phone: null },
              assignee: { id: "user-3", name: "Diego" }
            }
          ]);
        }
      },
      proposal: {
        count: nextCount,
        groupBy: () =>
          Promise.resolve([
            { status: "PAID", _count: { _all: 2 } },
            { status: "PENDING", _count: { _all: 5 } }
          ]),
        findMany: () =>
          Promise.resolve([
            {
              id: "proposal-risk-1",
              product: "FGTS",
              status: "PENDING",
              updatedAt: now,
              assignedUser: null,
              contact: {
                id: "contact-risk",
                name: "Risco Um",
                phone: null,
                tasks: [
                  {
                    id: "task-risk-1",
                    title: "Retorno: negociar proposta",
                    dueAt: dueOverdue,
                    assignee: { id: "user-4", name: "Nina" }
                  }
                ]
              }
            },
            {
              id: "proposal-risk-2",
              product: "FGTS",
              status: "ANALYSIS",
              updatedAt: now,
              assignedUser: null,
              contact: {
                id: "contact-risk",
                name: "Risco Um",
                phone: null,
                tasks: [
                  {
                    id: "task-risk-2",
                    title: "Conferir documento",
                    dueAt: dueOverdue,
                    assignee: null
                  }
                ]
              }
            }
          ])
      },
      campaign: {
        count: nextCount,
        findMany: () =>
          Promise.resolve([
            {
              id: "campaign-1",
              name: "FGTS agosto",
              status: "SENDING",
              total: 100,
              sent: 40,
              failed: 2,
              updatedAt: now
            }
          ])
      },
      campaignRecipient: { count: nextCount },
      pipelineStage: {
        findMany: () =>
          Promise.resolve([
            { id: "stage-1", name: "Interesse", color: "blue", position: 1 }
          ])
      },
      contact: {
        groupBy: () =>
          Promise.resolve([
            { stageId: "stage-1", _count: { _all: 12 } },
            { stageId: null, _count: { _all: 3 } }
          ])
      }
    };

    const overview = await getCommercialControlOverview({
      companyId: "company-1",
      requesterId: "user-1",
      requesterRole: "ADMIN",
      now,
      db: db as never,
      opportunityQueue: (() => Promise.resolve(queue)) as never
    });

    assert.equal(overview.today.activeOrMovedConversations, 5);
    assert.equal(overview.today.pendingConversations, 2);
    assert.equal(overview.agenda.overdue.total, 1);
    assert.equal(overview.agenda.today.total, 3);
    assert.equal(overview.agenda.tomorrow.total, 4);
    assert.equal(overview.proposals.createdToday, 6);
    assert.equal(overview.proposals.contractsToday, 2);
    assert.equal(overview.campaigns.todayTotal, 2);
    assert.equal(overview.campaigns.sentToday, 9);
    assert.equal(overview.opportunities.total, 2);
    assert.equal(overview.attention.forgottenClients, 1);
    assert.equal(overview.attention.overdueNextActions, 1);
    assert.equal(overview.attention.overdueAppointments, 1);
    assert.equal(overview.attention.riskyNegotiations, 2);
    assert.equal(overview.operationalControl.forgottenClients.items[0]?.contact.name, "Carlos");
    assert.equal(overview.operationalControl.overdueNextActions.items[0]?.sourceId, "task-action-overdue");
    assert.equal(overview.operationalControl.overdueAppointments.items[0]?.sourceId, "task-appointment-overdue");
    assert.equal(overview.operationalControl.riskyNegotiations.total, 2);
    assert.equal(overview.operationalControl.riskyNegotiations.items.length, 1);
    assert.equal(overview.pipeline.totalContacts, 15);
    assert.equal(overview.pipeline.stages.at(-1)?.name, "Sem etapa");
  });
});
