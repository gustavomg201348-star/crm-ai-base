import { prisma } from "@/lib/db";
import {
  COMMERCIAL_OBSERVATION_STATUS_VALUES,
  type CommercialObservationStatus,
  type CommercialObserverResultV1
} from "@/lib/commercial-observer-types";
import { normalizeCommercialObserverResult } from "@/lib/commercial-observer-service";

type CommercialObservationDb = Pick<typeof prisma, "commercialObservation" | "conversation">;

type CommercialObservationFreshnessInput = {
  observation:
    | {
        status: string;
        analyzedAt: Date | string | null;
        sourceUpdatedAt: Date | string | null;
      }
    | null
    | undefined;
  conversationSourceUpdatedAt: Date | string | null;
};

const COMMERCIAL_OBSERVER_RESULT_VERSION = 1;
const MAX_STORED_TEXT_LENGTH = 700;
const MAX_STORED_LIST_LENGTH = 5;
const SENSITIVE_PLACEHOLDER = "[dado removido]";

const allowedTransitions: Record<CommercialObservationStatus, CommercialObservationStatus[]> = {
  PENDING: ["PROCESSING", "STALE", "ERROR"],
  PROCESSING: ["CURRENT", "ERROR"],
  CURRENT: ["STALE", "PENDING", "PROCESSING", "ERROR"],
  STALE: ["PENDING", "PROCESSING", "ERROR"],
  ERROR: ["PENDING", "PROCESSING", "STALE"]
};

export class CommercialObservationPersistenceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_STATUS"
      | "INVALID_TRANSITION"
      | "INVALID_RESULT"
      | "CONVERSATION_NOT_FOUND"
  ) {
    super(message);
    this.name = "CommercialObservationPersistenceError";
  }
}

export function isCommercialObservationStatus(
  status: string
): status is CommercialObservationStatus {
  return COMMERCIAL_OBSERVATION_STATUS_VALUES.includes(
    status as CommercialObservationStatus
  );
}

export function canTransitionCommercialObservationStatus({
  from,
  to
}: {
  from: CommercialObservationStatus;
  to: CommercialObservationStatus;
}) {
  if (from === to) return true;
  return allowedTransitions[from].includes(to);
}

export function assertCommercialObservationStatusTransition({
  from,
  to
}: {
  from: CommercialObservationStatus;
  to: CommercialObservationStatus;
}) {
  if (!canTransitionCommercialObservationStatus({ from, to })) {
    throw new CommercialObservationPersistenceError(
      `Transicao de status invalida: ${from} -> ${to}.`,
      "INVALID_TRANSITION"
    );
  }
}

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isCommercialObservationFresh({
  observation,
  conversationSourceUpdatedAt
}: CommercialObservationFreshnessInput) {
  if (!observation || observation.status !== "CURRENT") return false;

  const analyzedAt = toDate(observation.analyzedAt);
  const observedSourceUpdatedAt = toDate(observation.sourceUpdatedAt);
  const currentSourceUpdatedAt = toDate(conversationSourceUpdatedAt);

  if (!analyzedAt || !currentSourceUpdatedAt) return false;

  const representedSourceUpdatedAt = observedSourceUpdatedAt ?? analyzedAt;

  return (
    analyzedAt.getTime() >= representedSourceUpdatedAt.getTime() &&
    representedSourceUpdatedAt.getTime() >= currentSourceUpdatedAt.getTime()
  );
}

function truncateStoredText(value: string | null | undefined, maxLength = MAX_STORED_TEXT_LENGTH) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trim()}...`;
}

function sanitizeStoredText(value: string | null | undefined) {
  return truncateStoredText(value)
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, SENSITIVE_PLACEHOLDER)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, SENSITIVE_PLACEHOLDER)
    .replace(/\+?\d[\d\s().-]{9,}\d/g, SENSITIVE_PLACEHOLDER);
}

function sanitizeStoredList(values: string[]) {
  return values
    .map((value) => sanitizeStoredText(value))
    .filter(Boolean)
    .slice(0, MAX_STORED_LIST_LENGTH);
}

export function sanitizeCommercialObserverResultForPersistence(
  result: CommercialObserverResultV1
): CommercialObserverResultV1 {
  return {
    version: COMMERCIAL_OBSERVER_RESULT_VERSION,
    summary: sanitizeStoredText(result.summary),
    stage: {
      ...result.stage,
      evidence: sanitizeStoredList(result.stage.evidence)
    },
    interest: {
      ...result.interest,
      evidence: sanitizeStoredList(result.interest.evidence)
    },
    objection: {
      ...result.objection,
      value: result.objection.value ? sanitizeStoredText(result.objection.value) : null,
      evidence: sanitizeStoredList(result.objection.evidence)
    },
    customerNeed: {
      ...result.customerNeed,
      value: result.customerNeed.value ? sanitizeStoredText(result.customerNeed.value) : null,
      evidence: sanitizeStoredList(result.customerNeed.evidence)
    },
    risk: {
      ...result.risk,
      reasons: sanitizeStoredList(result.risk.reasons)
    },
    nextBestAction: {
      ...result.nextBestAction,
      reason: sanitizeStoredText(result.nextBestAction.reason),
      suggestedAt: result.nextBestAction.suggestedAt
        ? sanitizeStoredText(result.nextBestAction.suggestedAt)
        : null
    },
    limitations: sanitizeStoredList(result.limitations).slice(0, 8)
  };
}

export function serializeCommercialObserverResultForPersistence(value: unknown) {
  const normalized = normalizeCommercialObserverResult(value);
  if (!normalized) {
    throw new CommercialObservationPersistenceError(
      "Resultado estruturado invalido.",
      "INVALID_RESULT"
    );
  }

  return JSON.stringify(sanitizeCommercialObserverResultForPersistence(normalized));
}

export function parsePersistedCommercialObserverResult(value: string | null | undefined) {
  if (!value) return null;

  try {
    return normalizeCommercialObserverResult(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeErrorMessage(message: string | null | undefined) {
  const sanitized = sanitizeStoredText(message);
  return sanitized || null;
}

export async function getCommercialObservationForConversation({
  companyId,
  conversationId,
  db = prisma
}: {
  companyId: string;
  conversationId: string;
  db?: CommercialObservationDb;
}) {
  return db.commercialObservation.findFirst({
    where: {
      companyId,
      conversationId
    }
  });
}

export async function upsertCommercialObservationResult({
  companyId,
  conversationId,
  result,
  model,
  sourceUpdatedAt,
  analyzedAt = new Date(),
  db = prisma
}: {
  companyId: string;
  conversationId: string;
  result: CommercialObserverResultV1;
  model?: string | null;
  sourceUpdatedAt?: Date | string | null;
  analyzedAt?: Date;
  db?: CommercialObservationDb;
}) {
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId }
    },
    select: {
      id: true,
      updatedAt: true
    }
  });

  if (!conversation) {
    throw new CommercialObservationPersistenceError(
      "Conversa nao encontrada.",
      "CONVERSATION_NOT_FOUND"
    );
  }

  const structuredResult = serializeCommercialObserverResultForPersistence(result);
  const representedSourceUpdatedAt =
    toDate(sourceUpdatedAt) ?? toDate(conversation.updatedAt) ?? analyzedAt;
  const existing = await db.commercialObservation.findUnique({
    where: { conversationId },
    select: {
      status: true,
      sourceUpdatedAt: true
    }
  });

  if (
    existing?.sourceUpdatedAt &&
    representedSourceUpdatedAt &&
    existing.sourceUpdatedAt.getTime() > representedSourceUpdatedAt.getTime()
  ) {
    return db.commercialObservation.findUniqueOrThrow({
      where: { conversationId }
    });
  }

  return db.commercialObservation.upsert({
    where: { conversationId },
    create: {
      companyId,
      conversationId,
      status: "CURRENT",
      version: COMMERCIAL_OBSERVER_RESULT_VERSION,
      analyzedAt,
      sourceUpdatedAt: representedSourceUpdatedAt,
      model: model ?? null,
      structuredResult,
      lastError: null
    },
    update: {
      status: "CURRENT",
      version: COMMERCIAL_OBSERVER_RESULT_VERSION,
      analyzedAt,
      sourceUpdatedAt: representedSourceUpdatedAt,
      model: model ?? null,
      structuredResult,
      lastError: null
    }
  });
}

export async function markCommercialObservationStale({
  companyId,
  conversationId,
  sourceUpdatedAt,
  nextEligibleAt,
  db = prisma
}: {
  companyId: string;
  conversationId: string;
  sourceUpdatedAt?: Date | string | null;
  nextEligibleAt?: Date | string | null;
  db?: CommercialObservationDb;
}) {
  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId }
    },
    select: {
      id: true,
      updatedAt: true
    }
  });

  if (!conversation) {
    throw new CommercialObservationPersistenceError(
      "Conversa nao encontrada.",
      "CONVERSATION_NOT_FOUND"
    );
  }

  const existing = await db.commercialObservation.findUnique({
    where: { conversationId },
    select: {
      id: true,
      status: true,
      sourceUpdatedAt: true
    }
  });

  if (!existing) {
    return { updated: false, reason: "NO_OBSERVATION" as const };
  }

  const eventSourceUpdatedAt =
    toDate(sourceUpdatedAt) ?? toDate(conversation.updatedAt) ?? new Date();
  const currentSourceUpdatedAt = toDate(existing.sourceUpdatedAt);

  if (
    currentSourceUpdatedAt &&
    eventSourceUpdatedAt.getTime() <= currentSourceUpdatedAt.getTime()
  ) {
    return {
      updated: false,
      reason: "EVENT_NOT_NEWER" as const,
      observationId: existing.id
    };
  }

  const nextStatus: CommercialObservationStatus =
    existing.status === "PENDING" ? "PENDING" : "STALE";

  const updated = await db.commercialObservation.update({
    where: { conversationId },
    data: {
      status: nextStatus,
      sourceUpdatedAt: eventSourceUpdatedAt,
      nextEligibleAt: toDate(nextEligibleAt),
      lastError: null
    }
  });

  return {
    updated: true,
    reason: "MARKED_STALE" as const,
    observation: updated
  };
}

export async function markLatestCommercialObservationForContactStale({
  companyId,
  contactId,
  sourceUpdatedAt,
  nextEligibleAt,
  db = prisma
}: {
  companyId: string;
  contactId: string;
  sourceUpdatedAt?: Date | string | null;
  nextEligibleAt?: Date | string | null;
  db?: CommercialObservationDb;
}) {
  const conversation = await db.conversation.findFirst({
    where: {
      contactId,
      status: { not: "RESOLVED" },
      contact: { companyId },
      commercialObservation: { isNot: null }
    },
    select: { id: true },
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { updatedAt: "desc" },
      { createdAt: "desc" }
    ]
  });

  if (!conversation) {
    return { updated: false, reason: "NO_OBSERVED_CONVERSATION" as const };
  }

  return markCommercialObservationStale({
    companyId,
    conversationId: conversation.id,
    sourceUpdatedAt,
    nextEligibleAt,
    db
  });
}

export async function markCommercialObservationStatus({
  companyId,
  conversationId,
  status,
  sourceUpdatedAt,
  nextEligibleAt,
  lastError,
  db = prisma
}: {
  companyId: string;
  conversationId: string;
  status: CommercialObservationStatus;
  sourceUpdatedAt?: Date | string | null;
  nextEligibleAt?: Date | string | null;
  lastError?: string | null;
  db?: CommercialObservationDb;
}) {
  if (!isCommercialObservationStatus(status)) {
    throw new CommercialObservationPersistenceError("Status invalido.", "INVALID_STATUS");
  }

  const conversation = await db.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId }
    },
    select: {
      id: true,
      updatedAt: true
    }
  });

  if (!conversation) {
    throw new CommercialObservationPersistenceError(
      "Conversa nao encontrada.",
      "CONVERSATION_NOT_FOUND"
    );
  }

  const existing = await db.commercialObservation.findUnique({
    where: { conversationId },
    select: { status: true }
  });

  if (existing?.status && isCommercialObservationStatus(existing.status)) {
    assertCommercialObservationStatusTransition({ from: existing.status, to: status });
  }

  return db.commercialObservation.upsert({
    where: { conversationId },
    create: {
      companyId,
      conversationId,
      status,
      version: COMMERCIAL_OBSERVER_RESULT_VERSION,
      sourceUpdatedAt: toDate(sourceUpdatedAt) ?? toDate(conversation.updatedAt),
      nextEligibleAt: toDate(nextEligibleAt),
      lastError: safeErrorMessage(lastError)
    },
    update: {
      status,
      sourceUpdatedAt: toDate(sourceUpdatedAt) ?? toDate(conversation.updatedAt),
      nextEligibleAt: toDate(nextEligibleAt),
      lastError: safeErrorMessage(lastError)
    }
  });
}
