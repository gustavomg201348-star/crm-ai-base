import assert from "node:assert/strict";
import test from "node:test";
import {
  claimOpportunityCandidate,
  claimVisibleOpportunityFromCandidates,
  normalizeExcludedConversationIds,
  selectNextOpportunityFromCandidates,
  type ConversationClaimDb
} from "./opportunity-next-service";
import type { OpportunityQueueItem } from "./opportunity-queue-types";

type ClaimDb = Parameters<typeof claimOpportunityCandidate>[0];
type UpdateManyArgs = Parameters<ConversationClaimDb["conversation"]["updateMany"]>[0];
type FindFirstArgs = Parameters<ConversationClaimDb["conversation"]["findFirst"]>[0];
type HistoryCreateArgs = Parameters<ConversationClaimDb["leadAssignmentHistory"]["create"]>[0];

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
        return args.data;
      }
    }
  };

  const db: ClaimDb = {
    ...txClient,
    async $transaction<T>(fn: (tx: ConversationClaimDb) => Promise<T>) {
      const beforeConversations = cloneConversations(conversations);
      const beforeHistory = [...history];

      try {
        return await fn(txClient);
      } catch (error) {
        conversations.clear();
        beforeConversations.forEach((conversation, id) => conversations.set(id, conversation));
        history.splice(0, history.length, ...beforeHistory);
        throw error;
      }
    }
  };

  return { db, conversations, history };
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

test("acao explicita faz claim atomico e cria LeadAssignmentHistory", async () => {
  const { db, conversations, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: null }
  ]);

  const result = await claimVisibleOpportunityFromCandidates({
    db,
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidates: [queueItem()],
    scanned: 1,
    conversationId: "conversation-1"
  });

  assert.equal(result.claimed, true);
  assert.equal(result.claimStatus, "CLAIMED");
  assert.equal(result.opportunity?.owner?.id, "user-1");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-1");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.mode, "NEXT_BEST_ACTION");
  assert.equal(history[0]?.action, "CLAIMED");
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
      candidate: queueItem()
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
    conversationId: "conversation-1"
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
      candidate
    }),
    claimOpportunityCandidate(db, {
      companyId: "company-1",
      requesterId: "user-2",
      requesterName: "Operador 2",
      candidate
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
    candidate: queueItem({ companyId: "company-2" })
  });

  assert.equal(result.status, "MISSING");
  assert.equal(result.opportunity, null);
  assert.equal(conversations.get("conversation-1")?.agentId, null);
  assert.equal(history.length, 0);
});

test("conversa ja pertencente legitimamente ao proprio operador e tratada como propria", async () => {
  const { db, history } = createDb([
    { id: "conversation-1", companyId: "company-1", agentId: "user-1" }
  ]);

  const result = await claimOpportunityCandidate(db, {
    companyId: "company-1",
    requesterId: "user-1",
    requesterName: "Operador 1",
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } })
  });

  assert.equal(result.status, "ALREADY_OWNED");
  assert.equal(result.opportunity?.conversationId, "conversation-1");
  assert.equal(history.length, 0);
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
    candidate: queueItem({ owner: { id: "user-1", name: "Operador 1" } })
  });

  assert.equal(result.status, "ALREADY_OWNED");
  assert.equal(conversations.get("conversation-1")?.agentId, "user-1");
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