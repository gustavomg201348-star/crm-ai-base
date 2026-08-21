import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  claimOpportunityCandidate,
  claimVisibleOpportunityFromCandidates,
  buildNextBestActionEventSnapshot,
  NEXT_BEST_ACTION_CLAIMED,
  normalizeExcludedConversationIds,
  selectNextOpportunityFromCandidates,
  NextBestActionError,
  type ConversationClaimDb
} from "./opportunity-next-service";
import {
  getSuppressedUntil,
  parseLifecycleAction,
  recordNextBestActionForTest
} from "./next-best-action-lifecycle-service";
import type { OpportunityQueueItem } from "./opportunity-queue-types";

type ClaimDb = Parameters<typeof claimOpportunityCandidate>[0];
type UpdateManyArgs = Parameters<ConversationClaimDb["conversation"]["updateMany"]>[0];
type FindFirstArgs = Parameters<ConversationClaimDb["conversation"]["findFirst"]>[0];
type HistoryCreateArgs = Parameters<ConversationClaimDb["leadAssignmentHistory"]["create"]>[0];
type EventFindUniqueArgs = Parameters<ConversationClaimDb["nextBestActionEvent"]["findUnique"]>[0];
type EventCreateArgs = Parameters<ConversationClaimDb["nextBestActionEvent"]["create"]>[0];

type ConversationState = {
  id: string;
  companyId: string;
  agentId: string | null;
};

const baseDate = new Date("2026-08-20T12:00:00.000Z");

function queueItem(overrides: Partial<OpportunityQueueItem> = {}): OpportunityQueueItem {
  return {
    id: overrides.id ?? "conversation-1",
    companyId: overrides.companyId ?? "company-1",
    conversationId: overrides.conversationId ?? overrides.id ?? "conversation-1",
    contact: overrides.contact ?? {
      id: "contact-1",
      name: "Cliente Teste",
      phone: "5573999999999"
    },
    owner: overrides.owner ?? null,
    priority: overrides.priority ?? { type: "URGENT", label: "Prioridade urgente" },
    product: overrides.product ?? { type: "FGTS", label: "FGTS", reason: "Teste" },
    commercialState: overrides.commercialState ?? { type: "ACTION_REQUIRED", label: "Precisa de acao" },
    queueReason: overrides.queueReason ?? "Cliente aguardando resposta",
    situationTitle: overrides.situationTitle ?? "Cliente aguardando resposta",
    situationExplanation: overrides.situationExplanation ?? "Mensagem recente pendente.",
    primaryAction: overrides.primaryAction ?? {
      title: "Responder agora",
      reason: "Cliente respondeu.",
      actionable: true
    },
    displayEvidences: overrides.displayEvidences ?? [],
    lastRelevantInteraction: overrides.lastRelevantInteraction ?? {
      type: "CUSTOMER_MESSAGE",
      label: "Cliente respondeu",
      occurredAt: baseDate
    },
    pendingReturn: overrides.pendingReturn ?? null,
    activeProposal: overrides.activeProposal ?? null,
    updatedAt: overrides.updatedAt ?? baseDate
  };
}

function cloneConversations(conversations: Map<string, ConversationState>) {
  return new Map(
    Array.from(conversations.entries()).map(([id, conversation]) => [id, { ...conversation }])
  );
}

function createDb(initialConversations: ConversationState[], options: { failHistory?: boolean } = {}) {
  const conversations = new Map(initialConversations.map((conversation) => [conversation.id, { ...conversation }]));
  const history: HistoryCreateArgs["data"][] = [];
  const events: EventCreateArgs["data"][] = [];

  const txClient: ConversationClaimDb = {
    conversation: {
      async updateMany(args: UpdateManyArgs) {
        const conversation = conversations.get(args.where.id);

        if (
          conversation &&
          conversation.companyId === args.where.contact.companyId &&
          conversation.agentId === null
        ) {
          conversation.agentId = args.data.agentId;
          return { count: 1 };
        }

        return { count: 0 };
      },
      async findFirst(args: FindFirstArgs) {
        const conversation = conversations.get(args.where.id);

        if (!conversation || conversation.companyId !== args.where.contact.companyId) {
          return null;
        }

        return {
          id: conversation.id,
          agentId: conversation.agentId
        };
      }
    },
    leadAssignmentHistory: {
      async create(args: HistoryCreateArgs) {
        if (options.failHistory) {
          throw new Error("history failed");
        }

        history.push(args.data);
        return { id: `history-${history.length}` };
      }
    },
    nextBestActionEvent: {
      async findUnique(args: EventFindUniqueArgs) {
        const event = events.find(
          (item) =>
            item.companyId === args.where.companyId_idempotencyKey.companyId &&
            item.idempotencyKey === args.where.companyId_idempotencyKey.idempotencyKey
        );

        if (!event) return null;

        return {
          id: `event-${events.indexOf(event) + 1}`,
          action: event.action,
          conversationId: event.conversationId,
          userId: event.userId,
          assignmentHistoryId: event.assignmentHistoryId ?? null
        };
      },
      async create(args: EventCreateArgs) {
        events.push(args.data);
        return args.data;
      }
    }
  };

  const db: ClaimDb = {
    ...txClient,
    async $transaction<T>(fn: (tx: ConversationClaimDb) => Promise<T>) {
      const beforeConversations = cloneConversations(conversations);
      const beforeHistory = [...history];
      const beforeEvents = [...events];

      try {
        return await fn(txClient);
      } catch (error) {
        conversations.clear();
        beforeConversations.forEach((conversation, id) => conversations.set(id, conversation));
        history.splice(0, history.length, ...beforeHistory);
        events.splice(0, events.length, ...beforeEvents);
        throw error;
      }
    }
  };

  return { db, conversations, history, events };
}

type LifecycleEventState = EventCreateArgs["data"] & { id?: string };
type LifecycleAssignmentState = HistoryCreateArgs["data"] & { id: string; createdAt: Date };

function createLifecycleDb({
  conversation = { id: "conversation-1", companyId: "company-1", agentId: "user-1", contactId: "contact-1" },
  events = [],
  assignments = []
}: {
  conversation?: ConversationState & { contactId: string };
  events?: LifecycleEventState[];
  assignments?: LifecycleAssignmentState[];
} = {}) {
  const currentConversation = { ...conversation };
  const storedEvents = [...events];
  const storedAssignments = [...assignments];

  const txClient = {
    conversation: {
      async findFirst(args: { where: { id: string; contact: { companyId: string } } }) {
        if (
          currentConversation.id !== args.where.id ||
          currentConversation.companyId !== args.where.contact.companyId
        ) {
          return null;
        }

        return {
          id: currentConversation.id,
          agentId: currentConversation.agentId,
          contact: { id: currentConversation.contactId }
        };
      },
      async updateMany(args: {
        where: { id: string; agentId: string | null; contact: { companyId: string } };
        data: { agentId: string | null; updatedAt: Date };
      }) {
        if (
          currentConversation.id === args.where.id &&
          currentConversation.companyId === args.where.contact.companyId &&
          currentConversation.agentId === args.where.agentId
        ) {
          currentConversation.agentId = args.data.agentId;
          return { count: 1 };
        }

        return { count: 0 };
      }
    },
    leadAssignmentHistory: {
      async findFirst(args: { where: { companyId: string; conversationId: string } }) {
        return (
          storedAssignments
            .filter(
              (assignment) =>
                assignment.companyId === args.where.companyId &&
                assignment.conversationId === args.where.conversationId
            )
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))[0] ??
          null
        );
      },
      async create(args: HistoryCreateArgs) {
        const assignment = {
          ...args.data,
          id: `history-${storedAssignments.length + 1}`,
          createdAt: args.data.createdAt ?? baseDate
        };
        storedAssignments.push(assignment);
        return { id: assignment.id };
      }
    },
    nextBestActionEvent: {
      async findUnique(args: EventFindUniqueArgs) {
        const event = storedEvents.find(
          (item) =>
            item.companyId === args.where.companyId_idempotencyKey.companyId &&
            item.idempotencyKey === args.where.companyId_idempotencyKey.idempotencyKey
        );

        if (!event) return null;

        return {
          id: event.id ?? `event-${storedEvents.indexOf(event) + 1}`,
          action: event.action,
          suppressedUntil: event.suppressedUntil ?? null
        };
      },
      async findFirst(args: {
        where: {
          companyId: string;
          conversationId: string;
          userId?: string;
          action: string | { in: string[] };
          createdAt?: { gt: Date };
        };
      }) {
        const actions =
          typeof args.where.action === "string" ? [args.where.action] : args.where.action.in;

        return (
          storedEvents
            .filter(
              (event) =>
                event.companyId === args.where.companyId &&
                event.conversationId === args.where.conversationId &&
                (!args.where.userId || event.userId === args.where.userId) &&
                actions.includes(event.action) &&
                (!args.where.createdAt?.gt || (event.createdAt ?? baseDate) > args.where.createdAt.gt)
            )
            .sort(
              (a, b) =>
                (b.createdAt ?? baseDate).getTime() - (a.createdAt ?? baseDate).getTime()
            )[0] ?? null
        );
      },
      async create(args: EventCreateArgs) {
        storedEvents.push(args.data);
        return args.data;
      }
    }
  };

  const db = {
    ...txClient,
    async $transaction<T>(fn: (tx: typeof txClient) => Promise<T>) {
      const beforeConversation = { ...currentConversation };
      const beforeEvents = [...storedEvents];
      const beforeAssignments = [...storedAssignments];

      try {
        return await fn(txClient);
      } catch (error) {
        Object.assign(currentConversation, beforeConversation);
        storedEvents.splice(0, storedEvents.length, ...beforeEvents);
        storedAssignments.splice(0, storedAssignments.length, ...beforeAssignments);
        throw error;
      }
    }
  };

  return {
    db,
    conversation: currentConversation,
    events: storedEvents,
    assignments: storedAssignments,
    findQueueCandidate: async () => queueItem()
  };
}

test("abrir NBA e carregar candidata nao altera agentId nem cria historico", () => {
  const { conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  const result = selectNextOpportunityFromCandidates({
    candidates: [queueItem()],
    scanned: 1
  });

  assert.equal(result.opportunity?.conversationId, "conversation-1");
  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(history.length, 0);
});

test("pular antes do claim apenas exclui da rodada local e nao altera agentId", () => {
  const { conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null },
    { id: "conversation-2", companyId: "company-1", agentId: null }
  ]);

  const result = selectNextOpportunityFromCandidates({
    candidates: [
      queueItem({ conversationId: "conversation-1", id: "conversation-1" }),
      queueItem({ conversationId: "conversation-2", id: "conversation-2", contact: { id: "contact-2", name: "Cliente 2", phone: null } })
    ],
    scanned: 2,
    excludeConversationIds: ["conversation-1"]
  });

  assert.equal(result.opportunity?.conversationId, "conversation-2");
  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(conversations.get("conversation-2")?.agentId, null);
  assert.equal(history.length, 0);
});

test("fechar ou recarregar antes do claim nao exige release", () => {
  const { conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  selectNextOpportunityFromCandidates({ candidates: [queueItem()], scanned: 1 });
  selectNextOpportunityFromCandidates({ candidates: [queueItem()], scanned: 1 });

  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(history.length, 0);
});

test("acao explicita faz claim atomico e cria LeadAssignmentHistory e evento NBA", async () => {
  const { db, conversations, history, events } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  const result = await claimVisibleOpportunityFromCandidates({
    db,
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidates: [queueItem()],
    scanned: 1,
    conversationId: "conversation-1",
    idempotencyKey: "claim-1"
  });

  assert.equal(result.claimed, true);
  assert.equal(result.claimStatus, "CLAIMED");
  assert.equal(result.ownershipCreatedByNba, true);
  assert.equal(result.opportunity?.owner?.id, "user-1");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-1");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.mode, "NEXT_BEST_ACTION");
  assert.equal(history[0]?.action, "CLAIMED");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.action, "CLAIMED");
  assert.equal(events[0]?.assignmentHistoryId, "history-1");
  assert.equal(events[0]?.idempotencyKey, "claim-1");
});

test("falha do historico desfaz assignment e nao deixa claim orfao", async () => {
  const { db, conversations, history } = createDb(
    [{ id: "conversation-1", companyId: "company-1", agentId: null }],
    { failHistory: true }
  );

  await assert.rejects(
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-1",
      requesterName: "Operador 1",
      candidate: queueItem(),
      idempotencyKey: "claim-fail-history"
    }),
    /history failed/
  );

  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(history.length, 0);
});

test("conversa atribuida a outro operador nao e sobrescrita e proxima candidata e apresentada sem claim", async () => {
  const { db, conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "user-2" },
    { id: "conversation-2", companyId: "company-1", agentId: null }
  ]);

  const result = await claimVisibleOpportunityFromCandidates({
    db,
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidates: [
      queueItem({ conversationId: "conversation-1", id: "conversation-1" }),
      queueItem({ conversationId: "conversation-2", id: "conversation-2", contact: { id: "contact-2", name: "Cliente 2", phone: null } })
    ],
    scanned: 2,
    conversationId: "conversation-1",
    idempotencyKey: "claim-taken"
  });

  assert.equal(result.claimed, false);
  assert.equal(result.claimStatus, "TAKEN");
  assert.equal(result.opportunity?.conversationId, "conversation-2");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-2");
  assert.equal(conversations.get("conversation-2")?.agentId, null);
  assert.equal(history.length, 0);
});

test("dois operadores disputando: somente um vence", async () => {
  const { db, conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);
  const candidate = queueItem();

  const [first, second] = await Promise.all([
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-1",
      requesterName: "Operador 1",
      candidate,
      idempotencyKey: "claim-race-1"
    }),
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-2",
      requesterName: "Operador 2",
      candidate,
      idempotencyKey: "claim-race-2"
    })
  ]);

  const winners = [first, second].filter((result) => result.status === "CLAIMED");
  const taken = [first, second].filter((result) => result.status === "TAKEN");

  assert.equal(winners.length, 1);
  assert.equal(taken.length, 1);
  assert.equal(conversations.get("conversation-1")?.agentId, winners[0]?.opportunity?.owner?.id);
  assert.equal(history.length, 1);
});

test("companyId permanece isolado no claim", async () => {
  const { db, conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-2", agentId: null }
  ]);

  const result = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ companyId: "company-2" }),
    idempotencyKey: "claim-company"
  });

  assert.equal(result.status, "MISSING");
  assert.equal(result.opportunity, null);
  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(history.length, 0);
});

test("conversa ja pertencente ao proprio operador cria claim NBA sem historico", async () => {
  const { db, conversations, history, events } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "user-1" }
  ]);

  const result = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } }),
    idempotencyKey: "claim-owned"
  });

  assert.equal(result.status, "ALREADY_OWNED");
  assert.equal(result.ownershipCreatedByNba, false);
  assert.equal(result.opportunity?.conversationId, "conversation-1");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-1");
  assert.equal(history.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.action, "CLAIMED");
  assert.equal(events[0]?.assignmentHistoryId, null);
  assert.equal(events[0]?.idempotencyKey, "claim-owned");
  assert.equal(events[0]?.opportunityReason, "Cliente aguardando resposta");
  assert.equal(events[0]?.recommendedAction, "Responder agora");
  assert.equal(events[0]?.probableProduct, "FGTS");
  assert.equal(events[0]?.priority, "Prioridade urgente");
});

test("fluxo local nunca usa agentId null para release inseguro", async () => {
  const { db, conversations } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "user-1" }
  ]);

  selectNextOpportunityFromCandidates({
    candidates: [queueItem({ owner: { id: "user-1", name: "Operador 1" } })],
    scanned: 1,
    excludeConversationIds: ["conversation-1"]
  });

  const result = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } }),
    idempotencyKey: "claim-no-release"
  });

  assert.equal(result.status, "ALREADY_OWNED");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-1");
});

test("claim de conversa ja propria e idempotente e nao duplica evento", async () => {
  const { db, history, events } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "user-1" }
  ]);

  const first = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } }),
    idempotencyKey: "claim-owned-idempotent"
  });
  const second = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } }),
    idempotencyKey: "claim-owned-idempotent"
  });

  assert.equal(first.status, "ALREADY_OWNED");
  assert.equal(first.ownershipCreatedByNba, false);
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(second.ownershipCreatedByNba, false);
  assert.equal(history.length, 0);
  assert.equal(events.length, 1);
});

test("fila vazia retorna resposta apropriada sem mutation", () => {
  const result = selectNextOpportunityFromCandidates({
    candidates: [],
    scanned: 0
  });

  assert.equal(result.opportunity, null);
  assert.equal(result.scanned, 0);
  assert.equal(result.skipped, 0);
});

test("normaliza exclusoes removendo vazio e duplicidade", () => {
  assert.deepEqual(
    normalizeExcludedConversationIds([" conversation-1 ", "", "conversation-1", "conversation-2"]),
    ["conversation-1", "conversation-2"]
  );
});

test("claim repetido com mesma chave idempotente nao duplica historico nem evento", async () => {
  const { db, history, events } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  const first = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem(),
    idempotencyKey: "claim-idempotent"
  });
  const second = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem(),
    idempotencyKey: "claim-idempotent"
  });

  assert.equal(first.status, "CLAIMED");
  assert.equal(first.ownershipCreatedByNba, true);
  assert.equal(second.status, "IDEMPOTENT");
  assert.equal(second.ownershipCreatedByNba, true);
  assert.equal(history.length, 1);
  assert.equal(events.length, 1);
});

test("claim com chave idempotente usada em outra conversa e bloqueado", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null },
    { id: "conversation-2", companyId: "company-1", agentId: null }
  ]);

  await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ conversationId: "conversation-1", id: "conversation-1" }),
    idempotencyKey: "claim-conflict"
  });

  await assert.rejects(
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-1",
      requesterName: "Operador 1",
      candidate: queueItem({ conversationId: "conversation-2", id: "conversation-2" }),
      idempotencyKey: "claim-conflict"
    }),
    (error) => error instanceof NextBestActionError && error.code === "IDEMPOTENCY_CONFLICT"
  );
});

test("claim exige chave de idempotencia", async () => {
  const { db } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  await assert.rejects(
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-1",
      requesterName: "Operador 1",
      candidate: queueItem(),
      idempotencyKey: " "
    }),
    (error) => error instanceof NextBestActionError && error.code === "IDEMPOTENCY_KEY_REQUIRED"
  );
});

test("snapshot do evento preserva motivo, acao recomendada, produto e prioridade", () => {
  const snapshot = buildNextBestActionEventSnapshot(queueItem());

  assert.equal(snapshot.opportunityReason, "Cliente aguardando resposta");
  assert.equal(snapshot.recommendedAction, "Responder agora");
  assert.equal(snapshot.probableProduct, "FGTS");
  assert.equal(snapshot.priority, "Prioridade urgente");
});

test("parseLifecycleAction aceita completed", () => {
  assert.equal(parseLifecycleAction("COMPLETED"), "COMPLETED");
});

test("parseLifecycleAction aceita skipped", () => {
  assert.equal(parseLifecycleAction("SKIPPED"), "SKIPPED");
});

test("parseLifecycleAction aceita returned", () => {
  assert.equal(parseLifecycleAction("RETURNED"), "RETURNED");
});

test("parseLifecycleAction rejeita claimed em rota de lifecycle", () => {
  assert.equal(parseLifecycleAction(NEXT_BEST_ACTION_CLAIMED), null);
});

test("parseLifecycleAction rejeita valores desconhecidos", () => {
  assert.equal(parseLifecycleAction("PEEK"), null);
});

test("completed suprime globalmente por 24 horas", () => {
  const suppressedUntil = getSuppressedUntil("COMPLETED", baseDate);

  assert.equal(suppressedUntil?.toISOString(), "2026-08-21T12:00:00.000Z");
});

test("skipped suprime usuario por 4 horas", () => {
  const suppressedUntil = getSuppressedUntil("SKIPPED", baseDate);

  assert.equal(suppressedUntil?.toISOString(), "2026-08-20T16:00:00.000Z");
});

test("returned suprime usuario por 4 horas", () => {
  const suppressedUntil = getSuppressedUntil("RETURNED", baseDate);

  assert.equal(suppressedUntil?.toISOString(), "2026-08-20T16:00:00.000Z");
});

test("claimed nao cria janela de supressao", () => {
  assert.equal(getSuppressedUntil("CLAIMED", baseDate), null);
});

test("completed apos claim de ownership preexistente funciona e mantem agentId", async () => {
  const { db, conversation, events, findQueueCandidate } = createLifecycleDb({
    events: [
      {
        id: "event-claim-owned",
        companyId: "company-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        userId: "user-1",
        assignmentHistoryId: null,
        action: "CLAIMED",
        idempotencyKey: "claim-owned",
        createdAt: baseDate
      }
    ]
  });

  const result = await recordNextBestActionForTest(
    { db: db as never, findQueueCandidate },
    {
      companyId: "company-1",
      requesterId: "user-1",
      requesterRole: "ADMIN",
      conversationId: "conversation-1",
      action: "COMPLETED",
      idempotencyKey: "complete-owned",
      outcome: "Cliente respondeu",
      now: baseDate
    }
  );

  assert.equal(result.action, "COMPLETED");
  assert.equal(result.suppressedUntil?.toISOString(), "2026-08-21T12:00:00.000Z");
  assert.equal(conversation.agentId, "user-1");
  assert.equal(events.at(-1)?.action, "COMPLETED");
  assert.equal(events.at(-1)?.outcome, "Cliente respondeu");
});

test("returned apos claim de ownership preexistente e bloqueado sem alterar agentId", async () => {
  const { db, conversation, events, findQueueCandidate } = createLifecycleDb({
    events: [
      {
        id: "event-claim-owned",
        companyId: "company-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        userId: "user-1",
        assignmentHistoryId: null,
        action: "CLAIMED",
        idempotencyKey: "claim-owned-return",
        createdAt: baseDate
      }
    ]
  });

  await assert.rejects(
    recordNextBestActionForTest(
      { db: db as never, findQueueCandidate },
      {
        companyId: "company-1",
        requesterId: "user-1",
        requesterRole: "ADMIN",
        conversationId: "conversation-1",
        action: "RETURNED",
        idempotencyKey: "return-owned",
        reason: "Nao devo atender agora",
        now: baseDate
      }
    ),
    (error) => error instanceof NextBestActionError && error.code === "NBA_PREEXISTING_OWNERSHIP"
  );

  assert.equal(conversation.agentId, "user-1");
  assert.equal(events.length, 1);
});

test("returned apos claim NBA normal continua liberando ownership", async () => {
  const { db, conversation, events, assignments, findQueueCandidate } = createLifecycleDb({
    events: [
      {
        id: "event-claim",
        companyId: "company-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        userId: "user-1",
        assignmentHistoryId: "history-1",
        action: "CLAIMED",
        idempotencyKey: "claim-normal",
        createdAt: baseDate
      }
    ],
    assignments: [
      {
        id: "history-1",
        companyId: "company-1",
        conversationId: "conversation-1",
        assignedToUserId: "user-1",
        assignedByUserId: "user-1",
        mode: "NEXT_BEST_ACTION",
        action: "CLAIMED",
        createdAt: baseDate
      }
    ]
  });

  const result = await recordNextBestActionForTest(
    { db: db as never, findQueueCandidate },
    {
      companyId: "company-1",
      requesterId: "user-1",
      requesterRole: "ADMIN",
      conversationId: "conversation-1",
      action: "RETURNED",
      idempotencyKey: "return-normal",
      reason: "Sem prioridade agora",
      now: baseDate
    }
  );

  assert.equal(result.action, "RETURNED");
  assert.equal(conversation.agentId, null);
  assert.equal(assignments.length, 2);
  assert.equal(assignments[1]?.action, "RETURNED");
  assert.equal(events.at(-1)?.action, "RETURNED");
});

test("transferencia posterior ao claim preexistente gera stale ownership", async () => {
  const { db, findQueueCandidate } = createLifecycleDb({
    events: [
      {
        id: "event-claim-owned",
        companyId: "company-1",
        conversationId: "conversation-1",
        contactId: "contact-1",
        userId: "user-1",
        assignmentHistoryId: null,
        action: "CLAIMED",
        idempotencyKey: "claim-owned-stale",
        createdAt: baseDate
      }
    ],
    assignments: [
      {
        id: "history-later",
        companyId: "company-1",
        conversationId: "conversation-1",
        assignedToUserId: "user-1",
        assignedByUserId: "user-2",
        mode: "MANUAL",
        action: "ASSIGNED",
        createdAt: new Date(baseDate.getTime() + 60 * 1000)
      }
    ]
  });

  await assert.rejects(
    recordNextBestActionForTest(
      { db: db as never, findQueueCandidate },
      {
        companyId: "company-1",
        requesterId: "user-1",
        requesterRole: "ADMIN",
        conversationId: "conversation-1",
        action: "COMPLETED",
        idempotencyKey: "complete-stale",
        outcome: "Cliente respondeu",
        now: baseDate
      }
    ),
    (error) => error instanceof NextBestActionError && error.code === "STALE_OWNERSHIP"
  );
});

test("lifecycle permanece isolado por companyId", async () => {
  const { db, findQueueCandidate } = createLifecycleDb({
    conversation: {
      id: "conversation-1",
      companyId: "company-2",
      agentId: "user-1",
      contactId: "contact-1"
    }
  });

  await assert.rejects(
    recordNextBestActionForTest(
      { db: db as never, findQueueCandidate },
      {
        companyId: "company-1",
        requesterId: "user-1",
        requesterRole: "ADMIN",
        conversationId: "conversation-1",
        action: "COMPLETED",
        idempotencyKey: "complete-company",
        outcome: "Cliente respondeu",
        now: baseDate
      }
    ),
    (error) => error instanceof NextBestActionError && error.code === "OPPORTUNITY_NOT_FOUND"
  );
});

test("frontend oculta voltar para fila quando ownership nao foi criado pela NBA", () => {
  const source = readFileSync(
    new URL("../app/components/opportunities/NextBestActionPage.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /const canReturnCurrentOpportunity = isCurrentClaimed && claimedOwnershipCreatedByNba/);
  assert.match(source, /\{canReturnCurrentOpportunity && \(/);
});

test("frontend usa origem do ownership retornada pelo backend", () => {
  const source = readFileSync(
    new URL("../app/components/opportunities/NextBestActionPage.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /ownershipCreatedByNba\?: boolean/);
  assert.match(source, /setClaimedOwnershipCreatedByNba\(Boolean\(data\.ownershipCreatedByNba\)\)/);
});
