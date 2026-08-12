import assert from "node:assert/strict";
import test from "node:test";
import type { CommercialObserverResultV1 } from "@/lib/commercial-observer-types";
import {
  assertCommercialObservationStatusTransition,
  CommercialObservationPersistenceError,
  getCommercialObservationForConversation,
  isCommercialObservationFresh,
  markCommercialObservationStatus,
  markCommercialObservationStale,
  markLatestCommercialObservationForContactStale,
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
        contactId: "contact-1",
        status: "OPEN",
        lastMessageAt: baseDate,
        createdAt: baseDate,
        updatedAt: baseDate
      }
    ],
    [
      "conversation-2",
      {
        id: "conversation-2",
        companyId: "company-2",
        contactId: "contact-2",
        status: "OPEN",
        lastMessageAt: baseDate,
        createdAt: baseDate,
        updatedAt: baseDate
      }
    ],
    [
      "conversation-3",
      {
        id: "conversation-3",
        companyId: "company-1",
        contactId: "contact-1",
        status: "RESOLVED",
        lastMessageAt: laterDate,
        createdAt: laterDate,
        updatedAt: laterDate
      }
    ]
  ]);

  function cloneObservation(observation: StoredObservation) {
    return { ...observation };
  }

  const db = {
    conversation: {
      findFirst: ({
        where,
        orderBy
      }: {
        where: {
          id?: string;
          contactId?: string;
          status?: { not: string };
          contact: { companyId: string };
          commercialObservation?: { isNot: null };
        };
        orderBy?: unknown;
      }) => {
        const candidates = Array.from(conversations.values()).filter((conversation) => {
          if (where.id && conversation.id !== where.id) return false;
          if (where.contactId && conversation.contactId !== where.contactId) return false;
          if (where.status?.not && conversation.status === where.status.not) return false;
          if (conversation.companyId !== where.contact.companyId) return false;
          if (
            where.commercialObservation?.isNot === null &&
            !observations.has(conversation.id)
          ) {
            return false;
          }
          return true;
        });

        if (orderBy) {
          candidates.sort((a, b) => {
            const aTime = a.lastMessageAt?.getTime() ?? a.updatedAt.getTime();
            const bTime = b.lastMessageAt?.getTime() ?? b.updatedAt.getTime();
            return bTime - aTime;
          });
        }

        const conversation = candidates[0];
        if (!conversation) {
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
      findUniqueOrThrow: ({ where }: { where: { conversationId: string } }) => {
        const observation = observations.get(where.conversationId);
        if (!observation) return Promise.reject(new Error("Not found"));
        return Promise.resolve(cloneObservation(observation));
      },
      update: ({
        where,
        data
      }: {
        where: { conversationId: string };
        data: Partial<StoredObservation>;
      }) => {
        const existing = observations.get(where.conversationId);
        if (!existing) return Promise.reject(new Error("Not found"));
        const next = { ...existing, ...data, updatedAt: laterDate };
        observations.set(where.conversationId, next as StoredObservation);
        return Promise.resolve(cloneObservation(next as StoredObservation));
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

test("CURRENT com evento novo fica STALE e atualiza sourceUpdatedAt", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: baseDate,
    db: db as never
  });

  const result = await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });
  const observation = db.observations.get("conversation-1");

  assert.equal(result.updated, true);
  assert.equal(observation?.status, "STALE");
  assert.equal(observation?.sourceUpdatedAt?.toISOString(), laterDate.toISOString());
  assert.equal(db.observations.size, 1);
});

test("STALE com nova mensagem permanece STALE e avanca sourceUpdatedAt", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: baseDate,
    db: db as never
  });
  await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });

  const newestDate = new Date(laterDate.getTime() + 60_000);
  await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: newestDate,
    db: db as never
  });
  const observation = db.observations.get("conversation-1");

  assert.equal(observation?.status, "STALE");
  assert.equal(observation?.sourceUpdatedAt?.toISOString(), newestDate.toISOString());
  assert.equal(db.observations.size, 1);
});

test("evento sem CommercialObservation nao cria registro vazio", async () => {
  const db = createMockDb();

  const result = await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });

  assert.equal(result.updated, false);
  assert.equal(result.reason, "NO_OBSERVATION");
  assert.equal(db.observations.size, 0);
});

test("evento de outra empresa nao altera observacao", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: baseDate,
    db: db as never
  });

  await assert.rejects(
    markCommercialObservationStale({
      companyId: "company-2",
      conversationId: "conversation-1",
      sourceUpdatedAt: laterDate,
      db: db as never
    }),
    (error) =>
      error instanceof CommercialObservationPersistenceError &&
      error.code === "CONVERSATION_NOT_FOUND"
  );
  assert.equal(db.observations.get("conversation-1")?.status, "CURRENT");
});

test("evento anterior ao source conhecido nao retrocede freshness", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: laterDate,
    sourceUpdatedAt: laterDate,
    db: db as never
  });

  const result = await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: baseDate,
    db: db as never
  });
  const observation = db.observations.get("conversation-1");

  assert.equal(result.updated, false);
  assert.equal(result.reason, "EVENT_NOT_NEWER");
  assert.equal(observation?.status, "CURRENT");
  assert.equal(observation?.sourceUpdatedAt?.toISOString(), laterDate.toISOString());
});

test("evento durante PROCESSING impede resultado antigo de virar CURRENT", async () => {
  const db = createMockDb();
  await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "PROCESSING",
    sourceUpdatedAt: baseDate,
    db: db as never
  });
  await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });

  const stale = db.observations.get("conversation-1");
  const result = await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: laterDate,
    sourceUpdatedAt: baseDate,
    db: db as never
  });

  assert.equal(stale?.status, "STALE");
  assert.equal(result.status, "STALE");
  assert.equal(result.sourceUpdatedAt?.toISOString(), laterDate.toISOString());
});

test("PENDING permanece PENDING em evento novo e avanca sourceUpdatedAt", async () => {
  const db = createMockDb();
  await markCommercialObservationStatus({
    companyId: "company-1",
    conversationId: "conversation-1",
    status: "PENDING",
    sourceUpdatedAt: baseDate,
    db: db as never
  });

  await markCommercialObservationStale({
    companyId: "company-1",
    conversationId: "conversation-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });
  const observation = db.observations.get("conversation-1");

  assert.equal(observation?.status, "PENDING");
  assert.equal(observation?.sourceUpdatedAt?.toISOString(), laterDate.toISOString());
});

test("evento por contato invalida somente conversa observada ativa mais recente", async () => {
  const db = createMockDb();
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-1",
    result: createResult(),
    analyzedAt: baseDate,
    db: db as never
  });
  await upsertCommercialObservationResult({
    companyId: "company-1",
    conversationId: "conversation-3",
    result: createResult(),
    analyzedAt: baseDate,
    db: db as never
  });

  const result = await markLatestCommercialObservationForContactStale({
    companyId: "company-1",
    contactId: "contact-1",
    sourceUpdatedAt: laterDate,
    db: db as never
  });

  assert.equal(result.updated, true);
  assert.equal(db.observations.get("conversation-1")?.status, "STALE");
  assert.equal(db.observations.get("conversation-3")?.status, "CURRENT");
});
