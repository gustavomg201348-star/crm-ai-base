import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  buildNextBestActionEventSnapshot,
  NEXT_BEST_ACTION_CLAIMED,
  NEXT_BEST_ACTION_COMPLETED,
  NEXT_BEST_ACTION_RETURNED,
  NEXT_BEST_ACTION_SKIPPED,
  NextBestActionError,
  type NextBestActionEventAction,
  type NextBestActionEventCreateData
} from "@/lib/opportunity-next-service";
import { listOpportunityQueue } from "@/lib/opportunity-queue-service";
import type { OpportunityQueueItem } from "@/lib/opportunity-queue-types";

export const COMPLETED_SUPPRESSION_HOURS = 24;
export const USER_SUPPRESSION_HOURS = 4;

type LifecycleAction = typeof NEXT_BEST_ACTION_COMPLETED | typeof NEXT_BEST_ACTION_SKIPPED | typeof NEXT_BEST_ACTION_RETURNED;

export type RecordNextBestActionInput = {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  conversationId: string;
  action: LifecycleAction;
  idempotencyKey: string;
  reason?: string | null;
  outcome?: string | null;
  now?: Date;
};

export type RecordNextBestActionResult = {
  action: LifecycleAction;
  idempotent: boolean;
  suppressedUntil: Date | null;
  message: string;
};

type ClaimValidationResult = {
  conversation: {
    id: string;
    agentId: string | null;
    contact: { id: string };
  };
  claim: {
    id: string;
    assignmentHistoryId: string | null;
    createdAt: Date;
  };
  candidate: OpportunityQueueItem | null;
};

export function getSuppressedUntil(action: NextBestActionEventAction, now = new Date()) {
  if (action === NEXT_BEST_ACTION_COMPLETED) {
    return new Date(now.getTime() + COMPLETED_SUPPRESSION_HOURS * 60 * 60 * 1000);
  }

  if (action === NEXT_BEST_ACTION_SKIPPED || action === NEXT_BEST_ACTION_RETURNED) {
    return new Date(now.getTime() + USER_SUPPRESSION_HOURS * 60 * 60 * 1000);
  }

  return null;
}

export function parseLifecycleAction(value: unknown): LifecycleAction | null {
  if (
    value === NEXT_BEST_ACTION_COMPLETED ||
    value === NEXT_BEST_ACTION_SKIPPED ||
    value === NEXT_BEST_ACTION_RETURNED
  ) {
    return value;
  }

  return null;
}

function requireText(value: string | null | undefined, code: string, message: string) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new NextBestActionError(code, 400, message);
  }

  return normalized;
}

function normalizeIdempotencyKey(value: string) {
  return requireText(value, "IDEMPOTENCY_KEY_REQUIRED", "Informe a chave de idempotencia.");
}

async function findQueueCandidate({
  companyId,
  requesterId,
  requesterRole,
  conversationId
}: {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  conversationId: string;
}) {
  const queue = await listOpportunityQueue({
    companyId,
    requesterId,
    requesterRole,
    limit: 100
  });

  return queue.items.find((item) => item.conversationId === conversationId) ?? null;
}

function buildEventData({
  companyId,
  requesterId,
  conversationId,
  contactId,
  action,
  idempotencyKey,
  reason,
  outcome,
  suppressedUntil,
  candidate,
  now,
  assignmentHistoryId
}: {
  companyId: string;
  requesterId: string;
  conversationId: string;
  contactId: string;
  action: LifecycleAction;
  idempotencyKey: string;
  reason?: string | null;
  outcome?: string | null;
  suppressedUntil: Date | null;
  candidate: OpportunityQueueItem | null;
  now: Date;
  assignmentHistoryId?: string | null;
}): NextBestActionEventCreateData {
  return {
    companyId,
    conversationId,
    contactId,
    userId: requesterId,
    assignmentHistoryId,
    action,
    reason,
    outcome,
    idempotencyKey,
    suppressedUntil,
    createdAt: now,
    ...(candidate ? buildNextBestActionEventSnapshot(candidate) : {})
  };
}

async function getExistingEvent({
  companyId,
  idempotencyKey
}: {
  companyId: string;
  idempotencyKey: string;
}) {
  return prisma.nextBestActionEvent.findUnique({
    where: {
      companyId_idempotencyKey: {
        companyId,
        idempotencyKey
      }
    },
    select: {
      action: true,
      suppressedUntil: true
    }
  });
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function validateActiveClaim({
  companyId,
  requesterId,
  requesterRole,
  conversationId
}: {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  conversationId: string;
}): Promise<ClaimValidationResult> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      contact: { companyId }
    },
    select: {
      id: true,
      agentId: true,
      contact: { select: { id: true } }
    }
  });

  if (!conversation) {
    throw new NextBestActionError("OPPORTUNITY_NOT_FOUND", 404, "Oportunidade nao encontrada.");
  }

  if (conversation.agentId !== requesterId) {
    throw new NextBestActionError(
      "STALE_OWNERSHIP",
      409,
      "Esta oportunidade nao esta mais atribuida a voce."
    );
  }

  const claim = await prisma.nextBestActionEvent.findFirst({
    where: {
      companyId,
      conversationId,
      userId: requesterId,
      action: NEXT_BEST_ACTION_CLAIMED
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      assignmentHistoryId: true,
      createdAt: true
    }
  });

  if (!claim?.assignmentHistoryId) {
    throw new NextBestActionError(
      "NBA_CLAIM_REQUIRED",
      409,
      "Esta oportunidade nao possui um claim da Proxima Melhor Acao."
    );
  }

  const resolvedEvent = await prisma.nextBestActionEvent.findFirst({
    where: {
      companyId,
      conversationId,
      createdAt: { gt: claim.createdAt },
      action: { in: [NEXT_BEST_ACTION_COMPLETED, NEXT_BEST_ACTION_RETURNED] }
    },
    select: { id: true }
  });

  if (resolvedEvent) {
    throw new NextBestActionError(
      "NBA_ALREADY_RESOLVED",
      409,
      "Esta oportunidade ja teve uma acao final registrada."
    );
  }

  const latestAssignment = await prisma.leadAssignmentHistory.findFirst({
    where: {
      companyId,
      conversationId
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: {
      id: true,
      assignedToUserId: true,
      mode: true,
      action: true
    }
  });

  if (
    !latestAssignment ||
    latestAssignment.id !== claim.assignmentHistoryId ||
    latestAssignment.assignedToUserId !== requesterId ||
    latestAssignment.mode !== "NEXT_BEST_ACTION" ||
    latestAssignment.action !== NEXT_BEST_ACTION_CLAIMED
  ) {
    throw new NextBestActionError(
      "STALE_OWNERSHIP",
      409,
      "Esta oportunidade teve uma atribuicao posterior."
    );
  }

  const candidate = await findQueueCandidate({
    companyId,
    requesterId,
    requesterRole,
    conversationId
  });

  return {
    conversation,
    claim,
    candidate
  };
}

async function recordSkipped(input: Required<Pick<RecordNextBestActionInput, "companyId" | "requesterId" | "requesterRole" | "conversationId" | "idempotencyKey" | "reason" | "now">>) {
  const reason = requireText(input.reason, "REASON_REQUIRED", "Informe o motivo para pular.");
  const candidate = await findQueueCandidate(input);

  if (!candidate) {
    throw new NextBestActionError(
      "OPPORTUNITY_NOT_ELIGIBLE",
      409,
      "Esta oportunidade nao esta elegivel para pular agora."
    );
  }

  const suppressedUntil = getSuppressedUntil(NEXT_BEST_ACTION_SKIPPED, input.now);

  await prisma.nextBestActionEvent.create({
    data: buildEventData({
      ...input,
      contactId: candidate.contact.id,
      action: NEXT_BEST_ACTION_SKIPPED,
      reason,
      outcome: null,
      suppressedUntil,
      candidate
    })
  });

  return suppressedUntil;
}

async function recordCompleted(input: Required<Pick<RecordNextBestActionInput, "companyId" | "requesterId" | "requesterRole" | "conversationId" | "idempotencyKey" | "outcome" | "now">>) {
  const outcome = requireText(input.outcome, "OUTCOME_REQUIRED", "Informe o resultado da acao.");
  const { conversation, candidate } = await validateActiveClaim(input);
  const suppressedUntil = getSuppressedUntil(NEXT_BEST_ACTION_COMPLETED, input.now);

  await prisma.nextBestActionEvent.create({
    data: buildEventData({
      ...input,
      contactId: conversation.contact.id,
      action: NEXT_BEST_ACTION_COMPLETED,
      reason: null,
      outcome,
      suppressedUntil,
      candidate
    })
  });

  return suppressedUntil;
}

async function recordReturned(input: Required<Pick<RecordNextBestActionInput, "companyId" | "requesterId" | "requesterRole" | "conversationId" | "idempotencyKey" | "reason" | "now">>) {
  const reason = requireText(input.reason, "REASON_REQUIRED", "Informe o motivo para devolver.");
  const { conversation, claim, candidate } = await validateActiveClaim(input);
  const suppressedUntil = getSuppressedUntil(NEXT_BEST_ACTION_RETURNED, input.now);

  await prisma.$transaction(async (tx) => {
    const latestAssignment = await tx.leadAssignmentHistory.findFirst({
      where: {
        companyId: input.companyId,
        conversationId: input.conversationId
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        assignedToUserId: true,
        mode: true,
        action: true
      }
    });

    if (
      !latestAssignment ||
      latestAssignment.id !== claim.assignmentHistoryId ||
      latestAssignment.assignedToUserId !== input.requesterId ||
      latestAssignment.mode !== "NEXT_BEST_ACTION" ||
      latestAssignment.action !== NEXT_BEST_ACTION_CLAIMED
    ) {
      throw new NextBestActionError(
        "STALE_OWNERSHIP",
        409,
        "Esta oportunidade teve uma atribuicao posterior."
      );
    }

    const released = await tx.conversation.updateMany({
      where: {
        id: input.conversationId,
        agentId: input.requesterId,
        contact: { companyId: input.companyId }
      },
      data: {
        agentId: null,
        updatedAt: input.now
      }
    });

    if (released.count !== 1) {
      throw new NextBestActionError(
        "STALE_OWNERSHIP",
        409,
        "Esta oportunidade nao esta mais atribuida a voce."
      );
    }

    await tx.leadAssignmentHistory.create({
      data: {
        companyId: input.companyId,
        conversationId: input.conversationId,
        assignedToUserId: null,
        assignedByUserId: input.requesterId,
        mode: "NEXT_BEST_ACTION",
        action: NEXT_BEST_ACTION_RETURNED,
        createdAt: input.now
      }
    });

    await tx.nextBestActionEvent.create({
      data: buildEventData({
        ...input,
        contactId: conversation.contact.id,
        action: NEXT_BEST_ACTION_RETURNED,
        reason,
        outcome: null,
        suppressedUntil,
        candidate
      })
    });
  });

  return suppressedUntil;
}

export async function recordNextBestAction(input: RecordNextBestActionInput): Promise<RecordNextBestActionResult> {
  const now = input.now ?? new Date();
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const existingEvent = await getExistingEvent({ companyId: input.companyId, idempotencyKey });

  if (existingEvent) {
    if (existingEvent.action !== input.action) {
      throw new NextBestActionError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "Esta chave ja foi usada em outra acao."
      );
    }

    return {
      action: input.action,
      idempotent: true,
      suppressedUntil: existingEvent.suppressedUntil,
      message: "Acao ja registrada anteriormente."
    };
  }

  let suppressedUntil: Date | null;

  try {
    if (input.action === NEXT_BEST_ACTION_SKIPPED) {
      suppressedUntil = await recordSkipped({
        companyId: input.companyId,
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        conversationId: input.conversationId,
        idempotencyKey,
        reason: input.reason ?? null,
        now
      });
    } else if (input.action === NEXT_BEST_ACTION_COMPLETED) {
      suppressedUntil = await recordCompleted({
        companyId: input.companyId,
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        conversationId: input.conversationId,
        idempotencyKey,
        outcome: input.outcome ?? null,
        now
      });
    } else {
      suppressedUntil = await recordReturned({
        companyId: input.companyId,
        requesterId: input.requesterId,
        requesterRole: input.requesterRole,
        conversationId: input.conversationId,
        idempotencyKey,
        reason: input.reason ?? null,
        now
      });
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const duplicatedEvent = await getExistingEvent({ companyId: input.companyId, idempotencyKey });

    if (duplicatedEvent?.action === input.action) {
      return {
        action: input.action,
        idempotent: true,
        suppressedUntil: duplicatedEvent.suppressedUntil,
        message: "Acao ja registrada anteriormente."
      };
    }

    throw error;
  }

  return {
    action: input.action,
    idempotent: false,
    suppressedUntil,
    message: "Acao registrada."
  };
}
