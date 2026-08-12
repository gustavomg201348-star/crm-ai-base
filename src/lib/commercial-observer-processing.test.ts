import assert from "node:assert/strict";
import test from "node:test";
import type { CommercialObserverResultV1 } from "@/lib/commercial-observer-types";
import { markCommercialObservationStale } from "./commercial-observer-persistence";
import {
  claimCommercialObservationForProcessing,
  normalizeCommercialObserverBatchSize,
  processCommercialObservation,
  processEligibleCommercialObservations,
  promoteEligibleCommercialObservations
} from "./commercial-observer-processing";

const baseDate = new Date("2026-08-12T10:00:00.000Z");
const eligibleDate = new Date("2026-08-12T10:02:00.000Z");
const futureDate = new Date("2026-08-12T10:05:00.000Z");

type Obs = {
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

function result(summary = "Analise atualizada."): CommercialObserverResultV1 {
  return {
    version: 1,
    summary,
    stage: { value: "UNKNOWN", confidence: 0.2, evidence: [] },
    interest: { value: "UNKNOWN", confidence: 0.2, evidence: [] },
    objection: { value: null, confidence: 0, evidence: [] },
    customerNeed: { value: null, confidence: 0, evidence: [] },
    risk: { value: "UNKNOWN", confidence: 0.2, reasons: [] },
    nextBestAction: { action: "NO_ACTION", reason: "Teste.", suggestedAt: null, confidence: 0.2 },
    limitations: ["Mock."]
  };
}

function obs(input: Partial<Obs> & Pick<Obs, "id" | "conversationId" | "status">): Obs {
  return {
    companyId: "company-1",
    version: 1,
    analyzedAt: baseDate,
    sourceUpdatedAt: baseDate,
    nextEligibleAt: eligibleDate,
    model: null,
    structuredResult: null,
    lastError: null,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...input
  };
}

function mockDb() {
  const observations = new Map<string, Obs>();
  const conversations = new Map([
    ["conversation-1", { id: "conversation-1", companyId: "company-1", updatedAt: eligibleDate }],
    ["conversation-2", { id: "conversation-2", companyId: "company-1", updatedAt: eligibleDate }],
    ["conversation-3", { id: "conversation-3", companyId: "company-2", updatedAt: eligibleDate }]
  ]);
  const clone = <T>(value: T): T => (value ? ({ ...(value as object) } as T) : value);
  const match = (item: Obs, where: Record<string, unknown>) => {
    if (where.id && item.id !== where.id) return false;
    if (where.conversationId && item.conversationId !== where.conversationId) return false;
    if (where.companyId && item.companyId !== where.companyId) return false;
    if (where.status && item.status !== where.status) return false;
    const nextEligibleAt = where.nextEligibleAt as { lte?: Date } | undefined;
    return !nextEligibleAt?.lte || (!!item.nextEligibleAt && item.nextEligibleAt <= nextEligibleAt.lte);
  };
  const db = {
    conversation: {
      findFirst: ({ where }: { where: { id?: string; contact: { companyId: string } } }) => {
        const found = Array.from(conversations.values()).find(
          (item) => (!where.id || item.id === where.id) && item.companyId === where.contact.companyId
        );
        return Promise.resolve(found ? clone(found) : null);
      }
    },
    commercialObservation: {
      findMany: ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        Promise.resolve(
          Array.from(observations.values())
            .filter((item) => match(item, where))
            .sort((a, b) => (a.nextEligibleAt?.getTime() ?? 0) - (b.nextEligibleAt?.getTime() ?? 0))
            .slice(0, take ?? observations.size)
            .map(clone)
        ),
      findFirst: ({ where }: { where: { companyId: string; conversationId: string } }) => {
        const found = observations.get(where.conversationId);
        return Promise.resolve(found?.companyId === where.companyId ? clone(found) : null);
      },
      findUnique: ({ where }: { where: { id?: string; conversationId?: string } }) => {
        const found = where.conversationId
          ? observations.get(where.conversationId)
          : Array.from(observations.values()).find((item) => item.id === where.id);
        return Promise.resolve(found ? clone(found) : null);
      },
      findUniqueOrThrow: ({ where }: { where: { conversationId: string } }) => {
        const found = observations.get(where.conversationId);
        return found ? Promise.resolve(clone(found)) : Promise.reject(new Error("Not found"));
      },
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: Partial<Obs> }) => {
        let count = 0;
        for (const item of Array.from(observations.values())) {
          if (!match(item, where)) continue;
          Object.assign(item, data, { updatedAt: eligibleDate });
          count += 1;
        }
        return Promise.resolve({ count });
      },
      update: ({ where, data }: { where: { conversationId: string }; data: Partial<Obs> }) => {
        const found = observations.get(where.conversationId);
        if (!found) return Promise.reject(new Error("Not found"));
        Object.assign(found, data, { updatedAt: eligibleDate });
        return Promise.resolve(clone(found));
      },
      upsert: ({ where, create, update }: { where: { conversationId: string }; create: Partial<Obs>; update: Partial<Obs> }) => {
        const found = observations.get(where.conversationId);
        if (found) {
          Object.assign(found, update, { updatedAt: eligibleDate });
          return Promise.resolve(clone(found));
        }
        const next = obs({
          id: create.id ?? `obs-${observations.size + 1}`,
          companyId: create.companyId ?? "company-1",
          conversationId: create.conversationId ?? where.conversationId,
          status: create.status ?? "PENDING",
          analyzedAt: create.analyzedAt ?? null,
          sourceUpdatedAt: create.sourceUpdatedAt ?? null,
          nextEligibleAt: create.nextEligibleAt ?? null,
          structuredResult: create.structuredResult ?? null,
          lastError: create.lastError ?? null,
          model: create.model ?? null
        });
        observations.set(next.conversationId, next);
        return Promise.resolve(clone(next));
      }
    },
    observations
  };
  return db;
}

test("debounce empurra nextEligibleAt e lote e limitado", async () => {
  const db = mockDb();
  db.observations.set("conversation-1", obs({ id: "obs-1", conversationId: "conversation-1", status: "CURRENT" }));
  const eventAt = new Date("2026-08-12T10:10:00.000Z");

  await markCommercialObservationStale({ companyId: "company-1", conversationId: "conversation-1", sourceUpdatedAt: eventAt, db: db as never });
  assert.equal(db.observations.get("conversation-1")?.nextEligibleAt?.toISOString(), "2026-08-12T10:11:00.000Z");
  assert.equal(normalizeCommercialObserverBatchSize(50), 10);
});

test("STALE antes da janela nao promove; elegivel vira PENDING", async () => {
  const db = mockDb();
  db.observations.set("conversation-1", obs({ id: "obs-1", conversationId: "conversation-1", status: "STALE", nextEligibleAt: futureDate }));
  assert.equal((await promoteEligibleCommercialObservations({ now: eligibleDate, db: db as never })).promoted, 0);
  assert.equal(db.observations.get("conversation-1")?.status, "STALE");
  assert.equal((await promoteEligibleCommercialObservations({ now: futureDate, db: db as never })).promoted, 1);
  assert.equal(db.observations.get("conversation-1")?.status, "PENDING");
});

test("claim impede duplicidade e processamento finaliza CURRENT", async () => {
  const db = mockDb();
  db.observations.set("conversation-1", obs({ id: "obs-1", conversationId: "conversation-1", status: "PENDING" }));
  assert.equal((await claimCommercialObservationForProcessing({ observationId: "obs-1", db: db as never }))?.status, "PROCESSING");
  assert.equal(await claimCommercialObservationForProcessing({ observationId: "obs-1", db: db as never }), null);
  db.observations.get("conversation-1")!.status = "PENDING";
  const processed = await processCommercialObservation({ observationId: "obs-1", db: db as never, analyze: async () => ({ analysis: result(), input: { conversation: { updatedAt: eligibleDate } } }) });
  assert.equal(processed.status, "CURRENT");
  assert.equal(db.observations.size, 1);
});

test("erro em item nao aborta lote", async () => {
  const db = mockDb();
  db.observations.set("conversation-1", obs({ id: "obs-1", conversationId: "conversation-1", status: "PENDING" }));
  db.observations.set("conversation-2", obs({ id: "obs-2", conversationId: "conversation-2", status: "PENDING" }));
  const output = await processEligibleCommercialObservations({
    now: futureDate,
    db: db as never,
    analyze: async ({ conversationId }) => {
      if (conversationId === "conversation-1") throw new Error("Falha com CPF 000.000.000-00");
      return { analysis: result("ok"), input: { conversation: { updatedAt: eligibleDate } } };
    }
  });
  assert.equal(output.processed, 2);
  assert.equal(db.observations.get("conversation-1")?.status, "ERROR");
  assert.equal(db.observations.get("conversation-1")?.lastError?.includes("000.000.000-00"), false);
  assert.equal(db.observations.get("conversation-2")?.status, "CURRENT");
});

test("contexto muda durante PROCESSING e resultado antigo nao vira CURRENT", async () => {
  const db = mockDb();
  db.observations.set("conversation-1", obs({ id: "obs-1", conversationId: "conversation-1", status: "PENDING" }));
  const newer = new Date("2026-08-12T10:04:00.000Z");
  const output = await processCommercialObservation({
    observationId: "obs-1",
    db: db as never,
    analyze: async () => {
      Object.assign(db.observations.get("conversation-1")!, { status: "STALE", sourceUpdatedAt: newer, nextEligibleAt: new Date(newer.getTime() + 60_000) });
      return { analysis: result("antigo"), input: { conversation: { updatedAt: eligibleDate } } };
    }
  });
  assert.equal(output.status, "STALE");
  assert.equal(db.observations.get("conversation-1")?.status, "STALE");
  assert.equal(db.observations.get("conversation-1")?.sourceUpdatedAt?.toISOString(), newer.toISOString());
});