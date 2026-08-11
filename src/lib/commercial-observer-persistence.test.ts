import assert from "node:assert/strict";
import test from "node:test";
import type { CommercialObserverResultV1 } from "@/lib/commercial-observer-types";
import {
  assertCommercialObservationStatusTransition,
  CommercialObservationPersistenceError,
  getCommercialObservationForConversation,
  isCommercialObservationFresh,
  markCommercialObservationStatus,
  parsePersistedCommercialObserverResult,
  serializeCommercialObserverResultForPersistence,
  upsertCommercialObservationResult
} from "./commercial-observer-persistence";

const baseDate = new Date("2026-08-11T12:00:00.000Z");
const laterDate = new Date("2026-08-11T12:10:00.000Z");

type StoredObservation = {
  id: string;
  companyId: string;
  conversationId: string;
  status: string;
  version: number;
  analyzedAt: Date | null;
  sourceUpdatedAt: Date | null;
  nextEligibleAt: Date | null;
  model: string | null;
  structuredResult: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createResult(overrides: Partial<CommercialObserverResultV1> = {}): CommercialObserverResultV1 {
  return {
    version: 1,
    summary: "Cliente demonstra interesse em seguir com a simulacao.",
    stage: {
      value: "SIMULATION",
      confidence: 0.8,
      evidence: ["Cliente perguntou quanto libera."]
    },
    interest: {
      value: "HIGH",
      confidence: 0.82,
      evidence: ["Cliente pediu detalhes da parcela."]
    },
    objection: {
      value: "Parcela ficou alta.",
      confidence: 0.7,
      evidence: ["Cliente questionou valor da parcela."]
    },
    customerNeed: {
      value: "Reduzir parcela.",
      confidence: 0.7,
      evidence: ["Cliente comparou alternativas."]
    },
    risk: {
      value: "MEDIUM",
      confidence: 0.65,
      reasons: ["Ha objecao sobre parcela."]
    },
    nextBestAction: {
      action: "RESPOND",
      reason: "Responder explicando alternativas.",
      suggestedAt: null,
      confidence: 0.7
    },
    limitations: ["Analise limitada as mensagens recentes."],
    ...overrides
  };
}

function createMockDb() {
  const observations = new Map<string, StoredObservation>();
  const conversations = new Map([
    [
      "conversation-1",
      {
        id: "conversation-1",
        companyId: "company-1",
        updatedAt: baseDate
      }
    ],
    [
      "conversation-2",
      {
        id: "conversation-2",
        companyId: "company-2",
        updatedAt: baseDate
      }
    ]
  ]);

  function cloneObservation(observation: StoredObservation) {
    return { ...observation };
  }

  const db = {
    conversation: {
      findFirst: ({ where }: { where: { id: string; contact: { companyId: string } } }) => {
        const conversation = conversations.get(where.id);
        if (!conversation || conversation.companyId !== where.contact.companyId) {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          id: conversation.id,
          updatedAt: conversation.updatedAt
        });
      }
    },
    commercialObservation: {
      findFirst: ({ where }: { where: { companyId: string; conversationId: string } }) => {
        const observation = observations.get(where.conversationId);
        if (!observation || observation.companyId !== where.companyId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(cloneObservation(observation));
      },
      findUnique: ({ where }: { where: { conversationId: string } }) => {
        const observation = observations.get(where.conversationId);
        return Promise.resolve(observation ? cloneObservation(observation) : null);
      },
      upsert: ({
        where,
        create,
        update
      }: {
        where: { conversationId: string };
        create: Partial<StoredObservation>;
        update: Partial<StoredObservation>;
      }) => {
        const existing = observations.get(where.conversationId);
        const now = laterDate;
        const next = existing
          ? {
              ...existing,
              ...update,
              updatedAt: now
            }
          : {
              id: `observation-${observations.size + 1}`,
              companyId: create.companyId!,
              conversationId: create.conversationId!,
              status: create.status ?? "PENDING",
              version: create.version ?? 1,
              analyzedAt: create.analyzedAt ?? null,
              sourceUpdatedAt: create.sourceUpdatedAt ?? null,
              nextEligibleAt: create.nextEligibleAt ?? null,
              model: create.model ?? null,
              structuredResult: create.structuredResult ?? null,
              lastError: create.lastError ?? null,
              createdAt: now,
              updatedAt: now
            };
        observations.set(where.conversationId, next as StoredObservation);
        return Promise.resolve(cloneObservation(next as StoredObservation));
      }
    },
    observations
  };

  return db;
}

test("cria a primeira observacao e persiste structuredResult sanitizado", async () => {
  const db = createMockDb();
  const observation = await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult({
      summary: "Cliente 000.000.000-00 pediu retorno pelo +55 47 99999-1234."
    }),
    model: "test-model",
    analyzedAt: laterDate,
    db: db as never
  });

  assert.equal(observation.status, "CURRENT");
  assert.equal(observation.version, 1);
  assert.equal(observation.model, "test-model");
  assert.equal(db.observations.size, 1);
  assert.equal(observation.structuredResult?.includes("000.000.000-00"), false);
  assert.equal(observation.structuredResult?.includes("99999-1234"), false);
  assert.ok(parsePersistedCommercialObserverResult(observation.structuredResult));
});

test("atualiza observacao existente da mesma Conversation sem duplicar", async () => {
  const db = createMockDb();

  const first = await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult({ summary: "Primeira analise." }),
    analyzedAt: baseDate,
    db: db as never
  });
  const second = await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult({ summary: "Segunda analise." }),
    analyzedAt: laterDate,
    db: db as never
  });

  assert.equal(first.id, second.id);
  assert.equal(db.observations.size, 1);
  assert.equal(second.analyzedAt?.toISOString(), laterDate.toISOString());
  assert.equal(second.structuredResult?.includes("Segunda analise."), true);
});

test("respeita isolamento por companyId e rejeita conversa de outra empresa", async () => {
  const db = createMockDb();

  await assert.rejects(
    upsertCommercialObservationResult({
      companyId: "company-1",
      conversationId: "conversation-2",
      result: createResult(),
      db: db as never
    }),
    (error) =>
      error instanceof CommercialObservationPersistenceError &&
      error.code === "CONVERSATION_NOT_FOUND"
  );
});

test("getCommercialObservationForConversation filtra por companyId", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    db: db as never
  });

  const visible = await getCommercialObservationForConversation({
    companyId: "company-1",
    conversationId: "conversation-1",
    db: db as never
  });
  const hidden = await getCommercialObservationForConversation({
    companyId: "company-2",
    conversationId: "conversation-1",
    db: db as never
  });

  assert.ok(visible);
  assert.equal(hidden, null);
});

test("freshness depende da versao de contexto representada", () => {
  assert.equal(
    isCommercialObservationFresh({
      observation: {
        status: "CURRENT",
        analyzedAt: laterDate,
        sourceUpdatedAt: baseDate
      },
      conversationSourceUpdatedAt: baseDate
    }),
    true
  );
  assert.equal(
    isCommercialObservationFresh({
      observation: {
        status: "CURRENT",
        analyzedAt: baseDate,
        sourceUpdatedAt: baseDate
      },
      conversationSourceUpdatedAt: laterDate
    }),
    false
  );
  assert.equal(
    isCommercialObservationFresh({
      observation: {
        status: "PENDING",
        analyzedAt: laterDate,
        sourceUpdatedAt: laterDate
      },
      conversationSourceUpdatedAt: laterDate
    }),
    false
  );
});

test("status PENDING PROCESSING CURRENT STALE ERROR possuem transicoes controladas", async () => {
  const db = createMockDb();

  const pending = await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "PENDING",
    nextEligibleAt: laterDate,
    db: db as never
  });
  assert.equal(pending.status, "PENDING");

  const processing = await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "PROCESSING",
    db: db as never
  });
  assert.equal(processing.status, "PROCESSING");

  const current = await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    db: db as never
  });
  assert.equal(current.status, "CURRENT");

  const stale = await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "STALE",
    db: db as never
  });
  assert.equal(stale.status, "STALE");

  const error = await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "ERROR",
    lastError: "Falha com cpf 000.000.000-00",
    db: db as never
  });
  assert.equal(error.status, "ERROR");
  assert.equal(error.lastError?.includes("000.000.000-00"), false);
});

test("rejeita transicao invalida e structuredResult invalido", () => {
  assert.throws(
    () => assertCommercialObservationStatusTransition({ from: "PENDING", to: "CURRENT" }),
    CommercialObservationPersistenceError
  );
  assert.throws(
    () => serializeCommercialObserverResultForPersistence({ version: 2 }),
    CommercialObservationPersistenceError
  );
});

test("rejeita Conversation inexistente", async () => {
  const db = createMockDb();

  await assert.rejects(
    markCommercialObservationStatus({
      companyId: "company-1",
      conversationId: "missing",
      status: "PENDING",
      db: db as never
    }),
    (error) =>
      error instanceof CommercialObservationPersistenceError &&
      error.code === "CONVERSATION_NOT_FOUND"
  );
});
