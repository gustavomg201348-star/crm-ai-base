import type {
  OpportunityEvidenceType,
  OpportunityPriorityLevel,
  OpportunityProductType,
  OpportunitySummary
} from "@/lib/opportunity-summary-types";
import type { OpportunityQueueContact, OpportunityQueueItem, OpportunityQueueOwner } from "@/lib/opportunity-queue-types";

const PRIORITY_RANK: Record<Exclude<OpportunityPriorityLevel, "NONE">, number> = {
  URGENT: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1
};

const EVIDENCE_RANK: Record<OpportunityEvidenceType, number> = {
  CUSTOMER_REPLIED_RECENTLY: 0,
  UNREAD_MESSAGES: 0,
  RETURN_OVERDUE: 1,
  ACTIVE_PROPOSAL: 2,
  RETURN_SCHEDULED: 3,
  HOT_CONTACT: 4,
  HIGH_RETIREMENT_SCORE: 4,
  RECENT_CLT_SIMULATION: 4,
  RECENT_CAMPAIGN: 4
};

const FALLBACK_INTERACTION_RANK = 5;

export type OpportunityQueueSortMetadata = {
  priorityRank: number;
  evidenceRank: number;
  relevantTimestamp: number;
  conversationId: string;
  contactId: string;
  overdue: boolean;
};

export type RankedOpportunityQueueItem = OpportunityQueueItem & {
  internalSort: OpportunityQueueSortMetadata;
};

export function isActionableOpportunitySummary(summary: OpportunitySummary) {
  if (
    summary.priority.type === "NONE" ||
    summary.commercialState.type === "NO_CLEAR_OPPORTUNITY" ||
    summary.recommendedAction.type === "NO_ACTION"
  ) {
    return false;
  }

  const evidenceTypes = summary.evidences.map((evidence) => evidence.type);
  const onlyRecentCampaign =
    evidenceTypes.length > 0 && evidenceTypes.every((type) => type === "RECENT_CAMPAIGN");
  const onlyWeakUnknownSignals =
    summary.probableProduct.type === "UNKNOWN" &&
    evidenceTypes.length > 0 &&
    evidenceTypes.every((type) => type === "HOT_CONTACT" || type === "RECENT_CAMPAIGN");

  if (onlyRecentCampaign || onlyWeakUnknownSignals) return false;
  if (summary.commercialState.type === "NURTURING" && summary.probableProduct.type === "UNKNOWN") {
    return false;
  }

  return true;
}

export function buildOpportunityQueueReason(summary: OpportunitySummary) {
  if (summary.displayEvidences[0]?.label) {
    return summary.displayEvidences[0].label;
  }

  if (summary.evidences[0]?.label) {
    return summary.evidences[0].label;
  }

  return summary.situationTitle;
}

export function selectOpportunityQueueOwner({
  conversationAgent,
  contactOwner,
  activeProposalOwner
}: {
  conversationAgent?: { id: string; name: string } | null;
  contactOwner?: { id: string; name: string } | null;
  activeProposalOwner?: { id: string; label: string } | null;
}): OpportunityQueueOwner {
  if (conversationAgent) return conversationAgent;
  if (contactOwner) return contactOwner;
  if (activeProposalOwner) {
    return {
      id: activeProposalOwner.id,
      name: activeProposalOwner.label
    };
  }
  return null;
}

function hasEvidence(summary: OpportunitySummary, type: OpportunityEvidenceType) {
  return summary.evidences.some((evidence) => evidence.type === type);
}

function getDominantEvidenceRank(summary: OpportunitySummary) {
  const ranks = summary.evidences.map((evidence) => EVIDENCE_RANK[evidence.type]);
  if (ranks.length === 0) return FALLBACK_INTERACTION_RANK;
  return Math.min(...ranks);
}

function getRelevantTimestamp(summary: OpportunitySummary, fallback: Date) {
  if (summary.pendingReturn?.overdue) {
    return summary.pendingReturn.dueAt.getTime();
  }

  const dates = [
    summary.lastRelevantInteraction.occurredAt,
    summary.pendingReturn?.dueAt,
    summary.activeProposal?.updatedAt,
    ...summary.evidences.map((evidence) => evidence.occurredAt)
  ].filter((date): date is Date => date instanceof Date);

  return dates.sort((a, b) => b.getTime() - a.getTime())[0]?.getTime() ?? fallback.getTime();
}

export function buildOpportunityQueueItem({
  companyId,
  summary,
  contact,
  owner,
  updatedAt
}: {
  companyId: string;
  summary: OpportunitySummary;
  contact: OpportunityQueueContact;
  owner: OpportunityQueueOwner;
  updatedAt: Date;
}): RankedOpportunityQueueItem | null {
  if (!isActionableOpportunitySummary(summary)) return null;

  const priorityType = summary.priority.type;
  if (priorityType === "NONE") return null;

  const evidenceRank = getDominantEvidenceRank(summary);

  return {
    id: summary.conversationId,
    companyId,
    conversationId: summary.conversationId,
    contact,
    owner,
    priority: summary.priority,
    product: summary.probableProduct,
    commercialState: summary.commercialState,
    queueReason: buildOpportunityQueueReason(summary),
    situationTitle: summary.situationTitle,
    situationExplanation: summary.situationExplanation,
    primaryAction: summary.primaryAction,
    displayEvidences: summary.displayEvidences,
    lastRelevantInteraction: summary.lastRelevantInteraction,
    pendingReturn: summary.pendingReturn,
    activeProposal: summary.activeProposal,
    updatedAt,
    internalSort: {
      priorityRank: PRIORITY_RANK[priorityType],
      evidenceRank,
      relevantTimestamp: getRelevantTimestamp(summary, updatedAt),
      conversationId: summary.conversationId,
      contactId: summary.contactId,
      overdue: Boolean(summary.pendingReturn?.overdue)
    }
  };
}

export function sortOpportunityQueueItems<T extends RankedOpportunityQueueItem>(items: T[]) {
  return [...items].sort((a, b) => {
    if (b.internalSort.priorityRank !== a.internalSort.priorityRank) {
      return b.internalSort.priorityRank - a.internalSort.priorityRank;
    }
    if (a.internalSort.evidenceRank !== b.internalSort.evidenceRank) {
      return a.internalSort.evidenceRank - b.internalSort.evidenceRank;
    }
    if (a.internalSort.relevantTimestamp !== b.internalSort.relevantTimestamp) {
      if (a.internalSort.overdue && b.internalSort.overdue) {
        return a.internalSort.relevantTimestamp - b.internalSort.relevantTimestamp;
      }
      return b.internalSort.relevantTimestamp - a.internalSort.relevantTimestamp;
    }
    if (b.updatedAt.getTime() !== a.updatedAt.getTime()) {
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    }
    return a.conversationId.localeCompare(b.conversationId);
  });
}

export function filterOpportunityQueueItems(
  items: RankedOpportunityQueueItem[],
  filters: {
    priority?: OpportunityPriorityLevel | null;
    productType?: OpportunityProductType | null;
    ownerId?: string | null;
  }
) {
  return items.filter((item) => {
    if (filters.priority && item.priority.type !== filters.priority) return false;
    if (filters.productType && item.product.type !== filters.productType) return false;
    if (filters.ownerId && item.owner?.id !== filters.ownerId) return false;
    return true;
  });
}

export function deduplicateOpportunityQueueByContact<T extends RankedOpportunityQueueItem>(items: T[]) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    if (seen.has(item.contact.id)) continue;
    seen.add(item.contact.id);
    result.push(item);
  }

  return result;
}

export type OpportunityQueueCursorFilters = {
  ownerId: string | null;
  priority: OpportunityPriorityLevel | null;
  productType: OpportunityProductType | null;
};

export type OpportunityQueueCursorPayload = {
  v: 1;
  filters: OpportunityQueueCursorFilters;
  sort: OpportunityQueueSortMetadata;
};

export function encodeOpportunityQueueCursor(payload: OpportunityQueueCursorPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeOpportunityQueueCursor(value: string): OpportunityQueueCursorPayload | null {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<OpportunityQueueCursorPayload>;

    if (
      decoded.v !== 1 ||
      !decoded.filters ||
      !decoded.sort ||
      typeof decoded.sort.conversationId !== "string" ||
      typeof decoded.sort.contactId !== "string" ||
      typeof decoded.sort.priorityRank !== "number" ||
      typeof decoded.sort.evidenceRank !== "number" ||
      typeof decoded.sort.relevantTimestamp !== "number" ||
      typeof decoded.sort.overdue !== "boolean"
    ) {
      return null;
    }

    return decoded as OpportunityQueueCursorPayload;
  } catch {
    return null;
  }
}

function sameCursorFilters(a: OpportunityQueueCursorFilters, b: OpportunityQueueCursorFilters) {
  return a.ownerId === b.ownerId && a.priority === b.priority && a.productType === b.productType;
}

function toPublicQueueItem(item: RankedOpportunityQueueItem): OpportunityQueueItem {
  const { internalSort: _internalSort, ...publicItem } = item;
  return publicItem;
}

export function paginateOpportunityQueueItems(
  items: RankedOpportunityQueueItem[],
  {
    cursor,
    limit,
    filters
  }: {
    cursor?: OpportunityQueueCursorPayload | null;
    limit: number;
    filters: OpportunityQueueCursorFilters;
  }
) {
  if (cursor && !sameCursorFilters(cursor.filters, filters)) {
    return { ok: false as const, reason: "CURSOR_FILTER_MISMATCH" };
  }

  const startIndex = cursor
    ? items.findIndex(
        (item) =>
          item.conversationId === cursor.sort.conversationId &&
          item.contact.id === cursor.sort.contactId
      ) + 1
    : 0;

  if (cursor && startIndex === 0) {
    return { ok: false as const, reason: "CURSOR_NOT_FOUND" };
  }

  const page = items.slice(startIndex, startIndex + limit);
  const nextItem = items[startIndex + limit];

  return {
    ok: true as const,
    items: page.map(toPublicQueueItem),
    nextCursor:
      nextItem && page[page.length - 1]
        ? encodeOpportunityQueueCursor({
            v: 1,
            filters,
            sort: page[page.length - 1].internalSort
          })
        : null
  };
}
