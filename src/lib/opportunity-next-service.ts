import { prisma } from "@/lib/db";
import { listOpportunityQueue } from "@/lib/opportunity-queue-service";
import type { OpportunityQueueItem } from "@/lib/opportunity-queue-types";

const DEFAULT_NEXT_ACTION_CANDIDATE_LIMIT = 50;
const MAX_EXCLUDED_CONVERSATIONS = 100;

export type OpportunityClaimStatus = "CLAIMED" | "ALREADY_OWNED" | "TAKEN" | "MISSING";

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
      };
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

function withClaimedOwner(item: OpportunityQueueItem, owner: { id: string; name: string }) {
  return {
    ...item,
    owner
  };
}

function buildClaimHistory({
  companyId,
  conversationId,
  requesterId
}: {
  companyId: string;
  conversationId: string;
  requesterId: string;
}) {
  return {
    companyId,
    conversationId,
    assignedToUserId: requesterId,
    assignedByUserId: requesterId,
    mode: "NEXT_BEST_ACTION",
    action: "CLAIMED"
  };
}

async function claimOpportunityCandidateInTransaction(
  db: ConversationClaimDb,
  {
    companyId,
    requesterId,
    requesterName,
    candidate,
    now = new Date()
  }: ClaimOpportunityCandidateInput
): Promise<ClaimOpportunityCandidateResult> {
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
    await db.leadAssignmentHistory.create({
      data: buildClaimHistory({
        companyId,
        conversationId: candidate.conversationId,
        requesterId
      })
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
    candidate: visibleCandidate
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
    excludeConversationIds
  });
}