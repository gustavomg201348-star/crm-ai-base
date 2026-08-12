import { prisma } from "@/lib/db";
import {
  analyzeConversationWithCommercialObserver,
  type CommercialObserverError
} from "@/lib/commercial-observer-service";
import {
  COMMERCIAL_OBSERVER_REANALYSIS_DEBOUNCE_MS,
  markCommercialObservationStatus,
  upsertCommercialObservationResult
} from "@/lib/commercial-observer-persistence";
import type { CommercialObserverResultV1 } from "@/lib/commercial-observer-types";

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 10;
const MAX_ERROR_LENGTH = 240;

type ProcessingDb = Pick<typeof prisma, "commercialObservation" | "conversation">;

type AnalyzeCommercialConversation = (input: {
  companyId: string;
  conversationId: string;
  db?: typeof prisma;
  fetchImpl?: typeof fetch;
}) => Promise<{
  analysis: CommercialObserverResultV1;
  input: { conversation: { updatedAt: Date | string | null } };
}>;

export type CommercialObservationProcessResult = {
  observationId: string;
  conversationId?: string;
  status: "CURRENT" | "STALE" | "ERROR" | "SKIPPED";
  reason: string;
};

export function normalizeCommercialObserverBatchSize(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(value!)));
}

function sanitizeProcessingError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha ao reanalisar conversa.";
  const sanitized = message
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "[dado removido]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[dado removido]")
    .replace(/\+?\d[\d\s().-]{9,}\d/g, "[dado removido]");

  return sanitized.slice(0, MAX_ERROR_LENGTH) || "Falha ao reanalisar conversa.";
}

export async function promoteEligibleCommercialObservations({
  now = new Date(),
  limit = DEFAULT_BATCH_SIZE,
  db = prisma
}: {
  now?: Date;
  limit?: number;
  db?: ProcessingDb;
} = {}) {
  const batchSize = normalizeCommercialObserverBatchSize(limit);
  const candidates = await db.commercialObservation.findMany({
    where: {
      status: "STALE",
      nextEligibleAt: { lte: now }
    },
    select: {
      id: true,
      conversationId: true
    },
    orderBy: [{ nextEligibleAt: "asc" }, { updatedAt: "asc" }],
    take: batchSize
  });

  let promoted = 0;
  for (const candidate of candidates) {
    const result = await db.commercialObservation.updateMany({
      where: {
        id: candidate.id,
        status: "STALE",
        nextEligibleAt: { lte: now }
      },
      data: {
        status: "PENDING",
        lastError: null
      }
    });
    promoted += result.count;
  }

  return {
    scanned: candidates.length,
    promoted,
    skipped: candidates.length - promoted
  };
}

export async function claimCommercialObservationForProcessing({
  observationId,
  db = prisma
}: {
  observationId: string;
  db?: ProcessingDb;
}) {
  const claim = await db.commercialObservation.updateMany({
    where: {
      id: observationId,
      status: "PENDING"
    },
    data: {
      status: "PROCESSING",
      lastError: null
    }
  });

  if (claim.count !== 1) return null;

  return db.commercialObservation.findUnique({
    where: { id: observationId },
    select: {
      id: true,
      companyId: true,
      conversationId: true,
      sourceUpdatedAt: true,
      status: true
    }
  });
}

export async function processCommercialObservation({
  observationId,
  analyze = analyzeConversationWithCommercialObserver as AnalyzeCommercialConversation,
  db = prisma,
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  fetchImpl
}: {
  observationId: string;
  analyze?: AnalyzeCommercialConversation;
  db?: typeof prisma;
  model?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<CommercialObservationProcessResult> {
  const claimed = await claimCommercialObservationForProcessing({ observationId, db });

  if (!claimed) {
    return { observationId, status: "SKIPPED", reason: "CLAIM_SKIPPED" };
  }

  try {
    const { analysis, input } = await analyze({
      companyId: claimed.companyId,
      conversationId: claimed.conversationId,
      db,
      fetchImpl
    });

    const observation = await upsertCommercialObservationResult({
      companyId: claimed.companyId,
      conversationId: claimed.conversationId,
      result: analysis,
      model,
      sourceUpdatedAt: input.conversation.updatedAt,
      db
    });

    return {
      observationId: claimed.id,
      conversationId: claimed.conversationId,
      status: observation.status === "CURRENT" ? "CURRENT" : "STALE",
      reason: observation.status === "CURRENT" ? "PROCESSED" : "CONTEXT_CHANGED"
    };
  } catch (error) {
    const marked = await db.commercialObservation.updateMany({
      where: {
        id: claimed.id,
        status: "PROCESSING"
      },
      data: {
        status: "ERROR",
        lastError: sanitizeProcessingError(error),
        nextEligibleAt: null
      }
    });

    return {
      observationId: claimed.id,
      conversationId: claimed.conversationId,
      status: marked.count === 1 ? "ERROR" : "STALE",
      reason: marked.count === 1 ? "PROCESSING_ERROR" : "ERROR_AFTER_CONTEXT_CHANGED"
    };
  }
}

export async function processEligibleCommercialObservations({
  now = new Date(),
  limit = DEFAULT_BATCH_SIZE,
  analyze = analyzeConversationWithCommercialObserver as AnalyzeCommercialConversation,
  db = prisma,
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  fetchImpl
}: {
  now?: Date;
  limit?: number;
  analyze?: AnalyzeCommercialConversation;
  db?: typeof prisma;
  model?: string | null;
  fetchImpl?: typeof fetch;
} = {}) {
  const batchSize = normalizeCommercialObserverBatchSize(limit);
  const promoted = await promoteEligibleCommercialObservations({ now, limit: batchSize, db });
  const candidates = await db.commercialObservation.findMany({
    where: {
      status: "PENDING",
      nextEligibleAt: { lte: now }
    },
    select: {
      id: true
    },
    orderBy: [{ nextEligibleAt: "asc" }, { updatedAt: "asc" }],
    take: batchSize
  });

  const results: CommercialObservationProcessResult[] = [];
  for (const candidate of candidates) {
    results.push(
      await processCommercialObservation({
        observationId: candidate.id,
        analyze,
        db,
        model,
        fetchImpl
      })
    );
  }

  return {
    promoted,
    batchSize,
    processed: results.length,
    results,
    debounceMs: COMMERCIAL_OBSERVER_REANALYSIS_DEBOUNCE_MS
  };
}
