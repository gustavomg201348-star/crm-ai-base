import { prisma } from "@/lib/db";
import { listOpportunityQueue } from "@/lib/opportunity-queue-service";
import type { OpportunityQueueItem } from "@/lib/opportunity-queue-types";

const DEFAULT_NEXT_ACTION_CANDIDATE_LIMIT = 50;
const MAX_EXCLUDED_CONVERSATIONS = 100;

export const NEXT_BEST_ACTION_CLAIMED = "CLAIMED";
export const NEXT_BEST_ACTION_COMPLETED = "COMPLETED";
export const NEXT_BEST_ACTION_SKIPPED = "SKIPPED";
export const NEXT_BEST_ACTION_RETURNED = "RETURNED";

export type NextBestActionEventAction =
  | typeof NEXT_BEST_ACTION_CLAIMED
  | typeof NEXT_BEST_ACTION_COMPLETED
  | typeof NEXT_BEST_ACTION_SKIPPED
  | typeof NEXT_BEST_ACTION_RETURNED;

export type OpportunityClaimStatus =
  | "CLAIMED"
  | "ALREADY_OWNED"
  | "TAKEN"
  | "MISSING"
  | "IDEMPOTENT";

export class NextBestActionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "NextBestActionError";
  }
}

export type NextBestActionEventCreateData = {
  companyId: string;
  conversationId: string;
  contactId: string;
  userId: string;
  assignmentHistoryId?: string | null;
  action: NextBestActionEventAction;
  reason?: string | null;
  outcome?: string | null;
  opportunityReason?: string | null;
  recommendedAction?: string | null;
  probableProduct?: string | null;
  priority?: string | null;
  idempotencyKey: string;
  suppressedUntil?: Date | null;
  createdAt?: Date;
};

export type ConversationClaimDb = {
  conversation: {
    updateMany(args: {
      where: {
        id: string;
        agentId: null;
        contact: { companyId: string };
      };
      data: { agentId: string; updatedAt: Date };
    }): Promise<{ count: number }>;
    findFirst(args: {
      where: { id: string; contact: { companyId: string } };
      select: { id: true; agentId: true };
    }): Promise<{ id: string; agentId: string | null } | null>;
  };
  leadAssignmentHistory: {
    create(args: {
      data: {
        companyId: string;
        conversationId: string;
        assignedToUserId: string | null;
        assignedByUserId: string | null;
        mode: string;
        action: string;
        createdAt?: Date;
      };
      select?: { id: true };
    }): Promise<{ id: string }>;
  };
  nextBestActionEvent: {
    findUnique(args: {
      where: { companyId_idempotencyKey: { companyId: string; idempotencyKey: string } };
      select: {
        id: true;
        action: true;
        conversationId: true;
        userId: true;
      };
    }): Promise<{
      id: string;
      action: string;
      conversationId: string;
      userId: string;
    } | null>;
    create(args: {
      data: NextBestActionEventCreateData;
    }): Promise<unknown>;
  };
};

type OpportunityNextDb = ConversationClaimDb & {
  $transaction<T>(fn: (tx: ConversationClaimDb) => Promise<T>): Promise<T>;
};

export type ClaimOpportunityCandidateInput = {
  companyId: string;
  requesterId: string;
  requesterName: string;
  candidate: OpportunityQueueItem;
  idempotencyKey: string;
  now?: Date;
};

export type ClaimOpportunityCandidateResult = {
  status: OpportunityClaimStatus;
  opportunity: OpportunityQueueItem | null;
};

export type GetNextOpportunityInput = {
  companyId: string;
  requesterId: string;
  requesterName: string;
  requesterRole: string;
  excludeConversationIds?: string[];
};

export type ClaimVisibleOpportunityInput = GetNextOpportunityInput & {
  conversationId: string;
  idempotencyKey: string;
};

export type SelectNextOpportunityFromCandidatesInput = {
  candidates: OpportunityQueueItem[];
  scanned: number;
  excludeConversationIds?: string[];
};

export type ClaimVisibleOpportunityFromCandidatesInput = {
  db: OpportunityNextDb;
  companyId: string;
  requesterId: string;
  requesterName: string;
  candidates: OpportunityQueueItem[];
  scanned: number;
  conversationId: string;
  idempotencyKey: string;
  excludeConversationIds?: string[];
};

export type GetNextOpportunityResult = {
  opportunity: OpportunityQueueItem | null;
  scanned: number;
  skipped: number;
};

export type ClaimVisibleOpportunityResult = GetNextOpportunityResult & {
  claimed: boolean;
  claimStatus: OpportunityClaimStatus;
};

export function buildNextBestActionEventSnapshot(
  candidate: OpportunityQueueItem
): Pick<
  NextBestActionEventCreateData,
  "opportunityReason" | "recommendedAction" | "probableProduct" | "priority"
> {
  return {
    opportunityReason: candidate.queueReason,
    recommendedAction: candidate.primaryAction.title,
    probableProduct: candidate.product.label,
    priority: candidate.priority.label
  };
}

function withClaimedOwner(item: OpportunityQueueItem, owner: { id: string; name: string }) {
  return {
    ...item,
    owner
  };
}

function buildClaimHistory({
  companyId,
  conversationId,
  requesterId,
  now
}: {
  companyId: string;
  conversationId: string;
  requesterId: string;
  now: Date;
}) {
  return {
    companyId,
    conversationId,
    assignedToUserId: requesterId,
    assignedByUserId: requesterId,
    mode: "NEXT_BEST_ACTION",
    action: NEXT_BEST_ACTION_CLAIMED,
    createdAt: now
  };
}

function requireIdempotencyKey(idempotencyKey: string) {
  const normalized = idempotencyKey.trim();

  if (!normalized) {
    throw new NextBestActionError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Informe a chave de idempotencia."
    );
  }

  return normalized;
}

async function claimOpportunityCandidateInTransaction(
  db: ConversationClaimDb,
  {
    companyId,
    requesterId,
    requesterName,
    candidate,
    idempotencyKey,
    now = new Date()
  }: ClaimOpportunityCandidateInput
): Promise<ClaimOpportunityCandidateResult> {
  const normalizedIdempotencyKey = requireIdempotencyKey(idempotencyKey);
  const existingEvent = await db.nextBestActionEvent.findUnique({
    where: {
      companyId_idempotencyKey: {
        companyId,
        idempotencyKey: normalizedIdempotencyKey
      }
    },
    select: {
      id: true,
      action: true,
      conversationId: true,
      userId: true
    }
  });

  if (existingEvent) {
    if (
      existingEvent.action === NEXT_BEST_ACTION_CLAIMED &&
      existingEvent.conversationId === candidate.conversationId &&
      existingEvent.userId === requesterId
    ) {
      return {
        status: "IDEMPOTENT",
        opportunity: withClaimedOwner(candidate, { id: requesterId, name: requesterName })
      };
    }

    throw new NextBestActionError(
      "IDEMPOTENCY_CONFLICT",
      409,
      "Esta acao ja foi registrada para outra oportunidade."
    );
  }

  const claimed = await db.conversation.updateMany({
    where: {
      id: candidate.conversationId,
      agentId: null,
      contact: { companyId }
    },
    data: {
      agentId: requesterId,
      updatedAt: now
    }
  });

  if (claimed.count === 1) {
    const assignment = await db.leadAssignmentHistory.create({
      data: buildClaimHistory({
        companyId,
        conversationId: candidate.conversationId,
        requesterId,
        now
      }),
      select: { id: true }
    });

    await db.nextBestActionEvent.create({
      data: {
        companyId,
        conversationId: candidate.conversationId,
        contactId: candidate.contact.id,
        userId: requesterId,
        assignmentHistoryId: assignment.id,
        action: NEXT_BEST_ACTION_CLAIMED,
        idempotencyKey: normalizedIdempotencyKey,
        createdAt: now,
        ...buildNextBestActionEventSnapshot(candidate)
      }
    });

    return {
      status: "CLAIMED",
      opportunity: withClaimedOwner(candidate, { id: requesterId, name: requesterName })
    };
  }

  const current = await db.conversation.findFirst({
    where: {
      id: candidate.conversationId,
      contact: { companyId }
    },
    select: { id: true, agentId: true }
  });

  if (!current) {
    return { status: "MISSING", opportunity: null };
  }

  if (current.agentId === requesterId) {
    return {
      status: "ALREADY_OWNED",
      opportunity: withClaimedOwner(candidate, { id: requesterId, name: requesterName })
    };
  }

  return { status: "TAKEN", opportunity: null };
}

export async function claimOpportunityCandidate(
  db: OpportunityNextDb,
  input: ClaimOpportunityCandidateInput
): Promise<ClaimOpportunityCandidateResult> {
  return db.$transaction((tx) => claimOpportunityCandidateInTransaction(tx, input));
}

export function normalizeExcludedConversationIds(values?: string[]) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, MAX_EXCLUDED_CONVERSATIONS)
    )
  );
}

export function selectNextOpportunityFromCandidates({
  candidates,
  scanned,
  excludeConversationIds
}: SelectNextOpportunityFromCandidatesInput): GetNextOpportunityResult {
  const excluded = new Set(normalizeExcludedConversationIds(excludeConversationIds));
  let skipped = 0;

  for (const candidate of candidates) {
    if (excluded.has(candidate.conversationId)) {
      skipped += 1;
      continue;
    }

    return {
      opportunity: candidate,
      scanned,
      skipped
    };
  }

  return {
    opportunity: null,
    scanned,
    skipped
  };
}

export async function claimVisibleOpportunityFromCandidates({
  db,
  companyId,
  requesterId,
  requesterName,
  candidates,
  scanned,
  conversationId,
  idempotencyKey,
  excludeConversationIds
}: ClaimVisibleOpportunityFromCandidatesInput): Promise<ClaimVisibleOpportunityResult> {
  const excluded = normalizeExcludedConversationIds(excludeConversationIds);
  const visibleCandidate = candidates.find(
    (candidate) => candidate.conversationId === conversationId && !excluded.includes(candidate.conversationId)
  );

  if (!visibleCandidate) {
    return {
      ...selectNextOpportunityFromCandidates({ candidates, scanned, excludeConversationIds: excluded }),
      claimed: false,
      claimStatus: "MISSING"
    };
  }

  const claim = await claimOpportunityCandidate(db, {
    companyId,
    requesterId,
    requesterName,
    candidate: visibleCandidate,
    idempotencyKey
  });

  if (claim.opportunity) {
    return {
      opportunity: claim.opportunity,
      scanned,
      skipped: excluded.length,
      claimed: true,
      claimStatus: claim.status
    };
  }

  return {
    ...selectNextOpportunityFromCandidates({
      candidates,
      scanned,
      excludeConversationIds: [...excluded, conversationId]
    }),
    claimed: false,
    claimStatus: claim.status
  };
}

export async function getNextOpportunityCandidate({
  companyId,
  requesterId,
  requesterRole,
  excludeConversationIds
}: GetNextOpportunityInput): Promise<GetNextOpportunityResult> {
  const queue = await listOpportunityQueue({
    companyId,
    requesterId,
    requesterRole,
    limit: DEFAULT_NEXT_ACTION_CANDIDATE_LIMIT
  });

  return selectNextOpportunityFromCandidates({
    candidates: queue.items,
    scanned: queue.scanned,
    excludeConversationIds
  });
}

export async function claimVisibleOpportunity({
  companyId,
  requesterId,
  requesterName,
  requesterRole,
  conversationId,
  idempotencyKey,
  excludeConversationIds
}: ClaimVisibleOpportunityInput): Promise<ClaimVisibleOpportunityResult> {
  const queue = await listOpportunityQueue({
    companyId,
    requesterId,
    requesterRole,
    limit: DEFAULT_NEXT_ACTION_CANDIDATE_LIMIT
  });

  return claimVisibleOpportunityFromCandidates({
    db: prisma,
    companyId,
    requesterId,
    requesterName,
    candidates: queue.items,
    scanned: queue.scanned,
    conversationId,
    idempotencyKey,
    excludeConversationIds
  });
}
