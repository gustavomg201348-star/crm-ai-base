import type { PrismaClient } from "@prisma/client";
import { normalizeCommercialObserverResult } from "@/lib/commercial-observer-service";
import type {
  CommercialControlAiAttentionItem,
  CommercialControlAiIntelligence,
  CommercialControlAiStaleItem
} from "@/lib/commercial-control-types";
import type {
  CommercialObservationStatus,
  CommercialObserverResultV1
} from "@/lib/commercial-observer-types";

const ATTENTION_LIMIT = 6;
const STALE_ITEM_LIMIT = 5;
const CURRENT_SCAN_LIMIT = 500;
const SENSITIVE_PLACEHOLDER = "[dado removido]";

type CommercialObserverControlRoomDb = Pick<PrismaClient, "commercialObservation">;

type ObservationForControlRoom = {
  id: string;
  status: string;
  analyzedAt: Date | null;
  sourceUpdatedAt: Date | null;
  nextEligibleAt: Date | null;
  structuredResult: string | null;
  conversation: {
    id: string;
    updatedAt: Date;
    status: string;
    contact: { id: string; name: string };
    agent: { id: string; name: string } | null;
  };
};

function toIso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function sanitizeAiText(value: string | null | undefined, fallback = "Nao informado") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, SENSITIVE_PLACEHOLDER)
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, SENSITIVE_PLACEHOLDER)
    .replace(/\+?\d[\d\s().-]{5,}\d/g, SENSITIVE_PLACEHOLDER);

  return normalized || fallback;
}

export function parseCommercialObservationStructuredResult(
  structuredResult: string | null | undefined
): CommercialObserverResultV1 | null {
  if (!structuredResult) return null;

  try {
    const parsed = JSON.parse(structuredResult);
    return normalizeCommercialObserverResult(parsed);
  } catch {
    return null;
  }
}

function riskWeight(value: CommercialObserverResultV1["risk"]["value"]) {
  const weights = { HIGH: 4, MEDIUM: 3, LOW: 2, UNKNOWN: 1, NONE: 0 } as const;
  return weights[value] ?? 0;
}

function interestWeight(value: CommercialObserverResultV1["interest"]["value"]) {
  const weights = { HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 } as const;
  return weights[value] ?? 0;
}

function getPrimaryReason(result: CommercialObserverResultV1) {
  return sanitizeAiText(
    result.risk.reasons[0] ??
      result.nextBestAction.reason ??
      result.interest.evidence[0] ??
      result.stage.evidence[0] ??
      result.summary,
    "Sem motivo principal registrado."
  );
}

function mapAttentionItem(
  observation: ObservationForControlRoom,
  result: CommercialObserverResultV1
): CommercialControlAiAttentionItem {
  return {
    id: observation.id,
    conversationId: observation.conversation.id,
    contact: {
      id: observation.conversation.contact.id,
      name: observation.conversation.contact.name || "Cliente"
    },
    owner: observation.conversation.agent
      ? {
          id: observation.conversation.agent.id,
          name: observation.conversation.agent.name
        }
      : null,
    stage: result.stage.value,
    interest: result.interest.value,
    risk: result.risk.value,
    primaryReason: getPrimaryReason(result),
    nextBestAction: {
      action: result.nextBestAction.action,
      reason: sanitizeAiText(result.nextBestAction.reason, "Sem acao sugerida.")
    },
    confidence: Math.max(
      result.stage.confidence,
      result.interest.confidence,
      result.risk.confidence,
      result.nextBestAction.confidence
    ),
    analyzedAt: toIso(observation.analyzedAt)
  };
}
function mapStaleItem(observation: ObservationForControlRoom): CommercialControlAiStaleItem {
  return {
    id: observation.id,
    conversationId: observation.conversation.id,
    contact: {
      id: observation.conversation.contact.id,
      name: observation.conversation.contact.name || "Cliente"
    },
    owner: observation.conversation.agent
      ? {
          id: observation.conversation.agent.id,
          name: observation.conversation.agent.name
        }
      : null,
    staleSince: toIso(observation.sourceUpdatedAt ?? observation.conversation.updatedAt) ?? observation.conversation.updatedAt.toISOString(),
    status: observation.status as CommercialObservationStatus
  };
}

export async function getCommercialControlAiIntelligence({
  companyId,
  db
}: {
  companyId: string;
  db: CommercialObserverControlRoomDb;
}): Promise<CommercialControlAiIntelligence> {
  const baseWhere = { companyId };
  const [statusCounts, currentObservations, staleItems] = await Promise.all([
    db.commercialObservation.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true }
    }),
    db.commercialObservation.findMany({
      where: { ...baseWhere, status: "CURRENT" },
      orderBy: { analyzedAt: "desc" },
      take: CURRENT_SCAN_LIMIT,
      select: {
        id: true,
        status: true,
        analyzedAt: true,
        sourceUpdatedAt: true,
        nextEligibleAt: true,
        structuredResult: true,
        conversation: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            contact: { select: { id: true, name: true } },
            agent: { select: { id: true, name: true } }
          }
        }
      }
    }),
    db.commercialObservation.findMany({
      where: { ...baseWhere, status: { in: ["STALE", "PENDING", "PROCESSING", "ERROR"] } },
      orderBy: [{ sourceUpdatedAt: "desc" }, { updatedAt: "desc" }],
      take: STALE_ITEM_LIMIT,
      select: {
        id: true,
        status: true,
        analyzedAt: true,
        sourceUpdatedAt: true,
        nextEligibleAt: true,
        structuredResult: true,
        conversation: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            contact: { select: { id: true, name: true } },
            agent: { select: { id: true, name: true } }
          }
        }
      }
    })
  ]);

  const counts = new Map(statusCounts.map((item) => [item.status, item._count._all]));
  const parsedCurrent = currentObservations
    .map((observation) => ({
      observation,
      result: parseCommercialObservationStructuredResult(observation.structuredResult)
    }))
    .filter((item): item is { observation: ObservationForControlRoom; result: CommercialObserverResultV1 } => Boolean(item.result));

  const highInterest = parsedCurrent.filter((item) => item.result.interest.value === "HIGH").length;
  const atRisk = parsedCurrent.filter((item) => ["MEDIUM", "HIGH"].includes(item.result.risk.value)).length;
  const attention = parsedCurrent
    .filter(
      (item) =>
        item.result.risk.value === "HIGH" ||
        item.result.risk.value === "MEDIUM" ||
        item.result.interest.value === "HIGH"
    )
    .sort((a, b) => {
      const riskDiff = riskWeight(b.result.risk.value) - riskWeight(a.result.risk.value);
      if (riskDiff !== 0) return riskDiff;

      const interestDiff = interestWeight(b.result.interest.value) - interestWeight(a.result.interest.value);
      if (interestDiff !== 0) return interestDiff;

      return (b.observation.analyzedAt?.getTime() ?? 0) - (a.observation.analyzedAt?.getTime() ?? 0);
    })
    .slice(0, ATTENTION_LIMIT)
    .map((item) => mapAttentionItem(item.observation, item.result));

  return {
    current: counts.get("CURRENT") ?? 0,
    stale: counts.get("STALE") ?? 0,
    pending: counts.get("PENDING") ?? 0,
    processing: counts.get("PROCESSING") ?? 0,
    errors: counts.get("ERROR") ?? 0,
    highInterest,
    atRisk,
    attention,
    staleItems: staleItems.map(mapStaleItem),
    limitation:
      currentObservations.length >= CURRENT_SCAN_LIMIT
        ? `Indicadores de interesse/risco limitados as ${CURRENT_SCAN_LIMIT} analises atuais mais recentes.`
        : null
  };
}
