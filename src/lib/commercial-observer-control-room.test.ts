import assert from "node:assert/strict";
import test from "node:test";
import { getCommercialControlAiIntelligence } from "./commercial-observer-control-room";
import type { CommercialObserverResultV1 } from "@/lib/commercial-observer-types";

const baseDate = new Date("2026-08-12T10:00:00.000Z");
const laterDate = new Date("2026-08-12T10:20:00.000Z");

type MockObservation = {
  id: string;
  companyId: string;
  status: string;
  analyzedAt: Date | null;
  sourceUpdatedAt: Date | null;
  nextEligibleAt: Date | null;
  updatedAt: Date;
  structuredResult: string | null;
  conversation: {
    id: string;
    updatedAt: Date;
    status: string;
    contact: { id: string; name: string };
    agent: { id: string; name: string } | null;
  };
};

function observerResult(input: Partial<CommercialObserverResultV1> = {}): CommercialObserverResultV1 {
  return {
    version: 1,
    summary: "Cliente demonstrou interesse e precisa de retorno consultivo.",
    stage: { value: "INTEREST", confidence: 0.7, evidence: ["Cliente pediu detalhes."] },
    interest: { value: "MEDIUM", confidence: 0.65, evidence: ["Quer entender condicoes."] },
    objection: { value: null, confidence: 0, evidence: [] },
    customerNeed: { value: "Entender parcela.", confidence: 0.6, evidence: [] },
    risk: { value: "LOW", confidence: 0.4, reasons: ["Sem urgencia critica."] },
    nextBestAction: { action: "RESPOND", reason: "Responder com orientacao clara.", suggestedAt: null, confidence: 0.75 },
    limitations: [],
    ...input
  };
}

function observation(input: Partial<MockObservation> & Pick<MockObservation, "id" | "companyId" | "status">): MockObservation {
  const result = observerResult();
  return {
    analyzedAt: baseDate,
    sourceUpdatedAt: baseDate,
    nextEligibleAt: null,
    updatedAt: baseDate,
    structuredResult: JSON.stringify(result),
    conversation: {
      id: `conversation-${input.id}`,
      updatedAt: baseDate,
      status: "OPEN",
      contact: { id: `contact-${input.id}`, name: `Cliente ${input.id}` },
      agent: { id: "user-1", name: "Laura" }
    },
    ...input
  };
}

function mockDb(observations: MockObservation[]) {
  return {
    commercialObservation: {
      groupBy: ({ where }: { where: { companyId: string } }) => {
        const counts = new Map<string, number>();
        for (const item of observations.filter((observation) => observation.companyId === where.companyId)) {
          counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
        }
        return Promise.resolve(
          Array.from(counts.entries()).map(([status, count]) => ({
            status,
            _count: { _all: count }
          }))
        );
      },
      findMany: ({ where, take }: { where: { companyId: string; status?: string | { in: string[] } }; take: number }) => {
        const statusFilter = where.status;
        const allowedStatuses = typeof statusFilter === "string" ? [statusFilter] : statusFilter?.in;
        return Promise.resolve(
          observations
            .filter((item) => item.companyId === where.companyId)
            .filter((item) => !allowedStatuses || allowedStatuses.includes(item.status))
            .slice(0, take)
        );
      }
    }
  };
}

test("empresa sem observacoes retorna estado vazio", async () => {
  const ai = await getCommercialControlAiIntelligence({ companyId: "company-1", db: mockDb([]) as never });

  assert.equal(ai.current, 0);
  assert.equal(ai.stale, 0);
  assert.equal(ai.pending, 0);
  assert.equal(ai.processing, 0);
  assert.equal(ai.errors, 0);
  assert.equal(ai.highInterest, 0);
  assert.equal(ai.atRisk, 0);
  assert.deepEqual(ai.attention, []);
  assert.deepEqual(ai.staleItems, []);
});

test("conta status e usa somente CURRENT para risco e interesse atuais", async () => {
  const observations = [
    observation({
      id: "current-high-risk",
      companyId: "company-1",
      status: "CURRENT",
      structuredResult: JSON.stringify(observerResult({
        interest: { value: "HIGH", confidence: 0.9, evidence: ["Quer contratar."] },
        risk: { value: "HIGH", confidence: 0.85, reasons: ["Cliente pode abandonar se nao houver retorno."] },
        nextBestAction: { action: "CALL", reason: "Ligar para destravar a duvida.", suggestedAt: null, confidence: 0.8 }
      }))
    }),
    observation({
      id: "stale-high-risk",
      companyId: "company-1",
      status: "STALE",
      structuredResult: JSON.stringify(observerResult({
        interest: { value: "HIGH", confidence: 1, evidence: [] },
        risk: { value: "HIGH", confidence: 1, reasons: ["Antigo."] }
      }))
    }),
    observation({ id: "pending", companyId: "company-1", status: "PENDING" }),
    observation({ id: "processing", companyId: "company-1", status: "PROCESSING" }),
    observation({ id: "error", companyId: "company-1", status: "ERROR" }),
    observation({ id: "other-company", companyId: "company-2", status: "CURRENT" })
  ];

  const ai = await getCommercialControlAiIntelligence({ companyId: "company-1", db: mockDb(observations) as never });

  assert.equal(ai.current, 1);
  assert.equal(ai.stale, 1);
  assert.equal(ai.pending, 1);
  assert.equal(ai.processing, 1);
  assert.equal(ai.errors, 1);
  assert.equal(ai.highInterest, 1);
  assert.equal(ai.atRisk, 1);
  assert.equal(ai.attention.length, 1);
  assert.equal(ai.attention[0]?.conversationId, "conversation-current-high-risk");
  assert.equal(ai.staleItems.length, 4);
});

test("structuredResult invalido nao quebra e nao entra em indicadores interpretados", async () => {
  const ai = await getCommercialControlAiIntelligence({
    companyId: "company-1",
    db: mockDb([
      observation({ id: "invalid", companyId: "company-1", status: "CURRENT", structuredResult: "{invalido" })
    ]) as never
  });

  assert.equal(ai.current, 1);
  assert.equal(ai.highInterest, 0);
  assert.equal(ai.atRisk, 0);
  assert.deepEqual(ai.attention, []);
});

test("prioriza risco alto, risco medio, interesse alto e analise recente", async () => {
  const highInterest = observation({
    id: "interest",
    companyId: "company-1",
    status: "CURRENT",
    analyzedAt: laterDate,
    structuredResult: JSON.stringify(observerResult({
      interest: { value: "HIGH", confidence: 0.8, evidence: [] },
      risk: { value: "LOW", confidence: 0.2, reasons: [] }
    }))
  });
  const mediumRisk = observation({
    id: "medium-risk",
    companyId: "company-1",
    status: "CURRENT",
    analyzedAt: baseDate,
    structuredResult: JSON.stringify(observerResult({
      interest: { value: "LOW", confidence: 0.2, evidence: [] },
      risk: { value: "MEDIUM", confidence: 0.7, reasons: ["Pode esfriar."] }
    }))
  });
  const highRisk = observation({
    id: "high-risk",
    companyId: "company-1",
    status: "CURRENT",
    analyzedAt: baseDate,
    structuredResult: JSON.stringify(observerResult({
      interest: { value: "LOW", confidence: 0.2, evidence: [] },
      risk: { value: "HIGH", confidence: 0.8, reasons: ["Cliente sem resposta recente."] }
    }))
  });

  const ai = await getCommercialControlAiIntelligence({ companyId: "company-1", db: mockDb([highInterest, mediumRisk, highRisk]) as never });

  assert.deepEqual(ai.attention.map((item) => item.conversationId), [
    "conversation-high-risk",
    "conversation-medium-risk",
    "conversation-interest"
  ]);
});

test("limita listas sem duplicar itens", async () => {
  const current = Array.from({ length: 8 }, (_, index) =>
    observation({
      id: `risk-${index}`,
      companyId: "company-1",
      status: "CURRENT",
      structuredResult: JSON.stringify(observerResult({ risk: { value: "HIGH", confidence: 0.8, reasons: ["Risco."] } }))
    })
  );
  const stale = Array.from({ length: 8 }, (_, index) =>
    observation({ id: `stale-${index}`, companyId: "company-1", status: "STALE" })
  );

  const ai = await getCommercialControlAiIntelligence({ companyId: "company-1", db: mockDb([...current, ...stale]) as never });

  assert.equal(ai.attention.length, 6);
  assert.equal(new Set(ai.attention.map((item) => item.id)).size, 6);
  assert.equal(ai.staleItems.length, 5);
});
