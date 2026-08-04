import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  ACTIVE_PROPOSAL_STATUS_VALUES,
  INACTIVE_RETIREMENT_LEAD_STATUS_VALUES
} from "@/lib/opportunity-summary-rules";
import { buildOpportunitySummary } from "@/lib/opportunity-summary-rules";
import {
  buildOpportunityQueueItem,
  decodeOpportunityQueueCursor,
  deduplicateOpportunityQueueByContact,
  filterOpportunityQueueItems,
  paginateOpportunityQueueItems,
  selectOpportunityQueueOwner,
  sortOpportunityQueueItems
} from "@/lib/opportunity-queue-rules";
import type { OpportunityQueueFilters, OpportunityQueueResult } from "@/lib/opportunity-queue-types";
import type {
  OpportunitySummaryCampaignInput,
  OpportunitySummaryCltSimulationInput,
  OpportunitySummaryProposalInput,
  OpportunitySummaryRetirementLeadInput,
  OpportunitySummaryTaskInput
} from "@/lib/opportunity-summary-types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_CANDIDATE_CONVERSATIONS = 600;
const RECENT_INBOUND_HOURS = 72;
const RECENT_CLT_SIMULATION_DAYS = 30;
const WAITING_CUSTOMER_DAYS = 14;

type QueueConversation = Prisma.ConversationGetPayload<{
  include: {
    agent: { select: { id: true; name: true } };
    contact: {
      include: {
        owner: { select: { id: true; name: true } };
        stage: true;
        tags: { include: { tag: true } };
      };
    };
    messages: {
      orderBy: { createdAt: "desc" };
      take: 12;
    };
  };
}>;

export class OpportunityQueueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpportunityQueueValidationError";
  }
}

function normalizeLimit(limit?: number | null) {
  if (!limit) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.floor(limit));
}

function buildCandidateWhere({
  companyId,
  requesterId,
  requesterRole,
  ownerId,
  now
}: {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  ownerId?: string | null;
  now: Date;
}): Prisma.ConversationWhereInput {
  const recentInboundSince = new Date(now.getTime() - RECENT_INBOUND_HOURS * 60 * 60 * 1000);
  const recentCltSince = new Date(now.getTime() - RECENT_CLT_SIMULATION_DAYS * 24 * 60 * 60 * 1000);
  const waitingCustomerSince = new Date(now.getTime() - WAITING_CUSTOMER_DAYS * 24 * 60 * 60 * 1000);
  const isAdmin = requesterRole === "ADMIN" || requesterRole === "SUPERVISOR";

  return {
    AND: [
      {
        contact: {
          companyId,
          archivedAt: null
        }
      },
      isAdmin
        ? {}
        : {
            OR: [{ agentId: requesterId }, { agentId: null }]
          },
      ownerId
        ? {
            OR: [
              { agentId: ownerId },
              { contact: { ownerId } },
              { contact: { proposals: { some: { companyId, assignedUserId: ownerId } } } }
            ]
          }
        : {},
      {
        OR: [
          { unreadCount: { gt: 0 } },
          { lastInboundMessageAt: { gte: recentInboundSince } },
          { messages: { some: { direction: "inbound", createdAt: { gte: recentInboundSince } } } },
          { messages: { some: { direction: "outbound", createdAt: { gte: waitingCustomerSince } } } },
          { contact: { temperature: "HOT" } },
          { contact: { tasks: { some: { companyId, status: "PENDING" } } } },
          { contact: { proposals: { some: { companyId, status: { in: [...ACTIVE_PROPOSAL_STATUS_VALUES] } } } } },
          {
            contact: {
              retirementLeads: {
                some: {
                  companyId,
                  journeyStatus: { notIn: [...INACTIVE_RETIREMENT_LEAD_STATUS_VALUES] }
                }
              }
            }
          },
          {
            contact: {
              cltSimulationLogs: {
                some: {
                  companyId,
                  status: "SUCCESS",
                  createdAt: { gte: recentCltSince }
                }
              }
            }
          },
          {
            contact: {
              campaignRecipients: {
                some: {
                  campaign: { companyId },
                  updatedAt: { gte: waitingCustomerSince }
                }
              }
            }
          }
        ]
      }
    ]
  };
}

function groupByContactId<T extends { contactId: string | null }>(items: T[]) {
  const map = new Map<string, T[]>();

  for (const item of items) {
    if (!item.contactId) continue;
    const current = map.get(item.contactId) ?? [];
    current.push(item);
    map.set(item.contactId, current);
  }

  return map;
}

function firstByContactId<T extends { contactId: string | null }>(items: T[]) {
  const map = new Map<string, T>();

  for (const item of items) {
    if (!item.contactId || map.has(item.contactId)) continue;
    map.set(item.contactId, item);
  }

  return map;
}

function withoutContactId<T extends { contactId: string | null }>(
  items: T[] | undefined
): Omit<T, "contactId">[] {
  return (items ?? []).map(({ contactId: _contactId, ...item }) => item);
}

export async function listOpportunityQueue(
  filters: OpportunityQueueFilters
): Promise<OpportunityQueueResult> {
  const now = new Date();
  const limit = normalizeLimit(filters.limit);
  const cursor = filters.cursor ? decodeOpportunityQueueCursor(filters.cursor) : null;

  if (filters.cursor && !cursor) {
    throw new OpportunityQueueValidationError("Cursor invalido.");
  }

  if (filters.ownerId) {
    const owner = await prisma.user.findFirst({
      where: {
        id: filters.ownerId,
        companyId: filters.companyId
      },
      select: { id: true }
    });

    if (!owner) {
      throw new OpportunityQueueValidationError("Filtro invalido.");
    }
  }

  const conversations = await prisma.conversation.findMany({
    where: buildCandidateWhere({
      companyId: filters.companyId,
      requesterId: filters.requesterId,
      requesterRole: filters.requesterRole,
      ownerId: filters.ownerId,
      now
    }),
    include: {
      agent: { select: { id: true, name: true } },
      contact: {
        include: {
          owner: { select: { id: true, name: true } },
          stage: true,
          tags: {
            include: {
              tag: true
            }
          }
        }
      },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 12
      }
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: MAX_CANDIDATE_CONVERSATIONS
  });

  const contactIds = Array.from(
    new Set(conversations.map((conversation) => conversation.contactId))
  );

  const [pendingTasks, proposals, campaignRecipients, retirementLeads, cltSimulations] =
    await Promise.all([
      prisma.task.findMany({
        where: {
          companyId: filters.companyId,
          contactId: { in: contactIds },
          status: "PENDING"
        },
        include: {
          assignee: { select: { id: true, name: true } }
        },
        orderBy: { dueAt: "asc" }
      }),
      prisma.proposal.findMany({
        where: {
          companyId: filters.companyId,
          contactId: { in: contactIds }
        },
        include: {
          assignedUser: { select: { id: true, name: true } }
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.campaignRecipient.findMany({
        where: {
          contactId: { in: contactIds },
          campaign: { companyId: filters.companyId }
        },
        include: {
          campaign: {
            include: {
              channel: { select: { name: true } }
            }
          }
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.retirementLead.findMany({
        where: {
          companyId: filters.companyId,
          contactId: { in: contactIds }
        },
        orderBy: { updatedAt: "desc" }
      }),
      prisma.cltSimulationLog.findMany({
        where: {
          companyId: filters.companyId,
          contactId: { in: contactIds },
          status: "SUCCESS"
        },
        orderBy: { createdAt: "desc" }
      })
    ]);

  const tasksByContact = groupByContactId(pendingTasks);
  const proposalsByContact = groupByContactId(proposals);
  const campaignsByContact = groupByContactId(campaignRecipients);
  const retirementByContact = firstByContactId(retirementLeads);
  const cltByContact = firstByContactId(cltSimulations);

  const items = conversations
    .map((conversation) =>
      buildQueueItemForConversation({
        companyId: filters.companyId,
        conversation,
        pendingTasks: withoutContactId(tasksByContact.get(conversation.contactId)),
        proposals: withoutContactId(proposalsByContact.get(conversation.contactId)),
        campaignRecipients: withoutContactId(campaignsByContact.get(conversation.contactId)),
        retirementLead: omitContactId(retirementByContact.get(conversation.contactId)),
        recentCltSimulation: omitContactId(cltByContact.get(conversation.contactId)),
        now
      })
    )
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const filtered = filterOpportunityQueueItems(items, {
    ownerId: filters.ownerId,
    priority: filters.priority,
    productType: filters.productType
  });
  const sorted = deduplicateOpportunityQueueByContact(sortOpportunityQueueItems(filtered));
  const cursorFilters = {
    ownerId: filters.ownerId ?? null,
    priority: filters.priority ?? null,
    productType: filters.productType ?? null
  };
  const page = paginateOpportunityQueueItems(sorted, {
    cursor,
    limit,
    filters: cursorFilters
  });

  if (!page.ok) {
    throw new OpportunityQueueValidationError("Cursor invalido.");
  }

  return {
    items: page.items,
    nextCursor: page.nextCursor,
    total: sorted.length,
    scanned: conversations.length
  };
}

function omitContactId<T extends { contactId: string | null }>(
  item: T | undefined
): Omit<T, "contactId"> | null {
  if (!item) return null;
  const { contactId: _contactId, ...rest } = item;
  return rest;
}

function buildQueueItemForConversation({
  companyId,
  conversation,
  pendingTasks,
  proposals,
  campaignRecipients,
  retirementLead,
  recentCltSimulation,
  now
}: {
  companyId: string;
  conversation: QueueConversation;
  pendingTasks: OpportunitySummaryTaskInput[];
  proposals: OpportunitySummaryProposalInput[];
  campaignRecipients: OpportunitySummaryCampaignInput[];
  retirementLead: OpportunitySummaryRetirementLeadInput | null;
  recentCltSimulation: OpportunitySummaryCltSimulationInput | null;
  now: Date;
}) {
  const summary = buildOpportunitySummary({
    now,
    conversation: {
      ...conversation,
      messages: [...conversation.messages].reverse()
    },
    pendingTasks,
    proposals,
    campaignRecipients,
    retirementLead,
    recentCltSimulation
  });

  return buildOpportunityQueueItem({
    companyId,
    summary,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phone: conversation.contact.phone || conversation.contact.normalizedPhone || null
    },
    owner: selectOpportunityQueueOwner({
      conversationAgent: conversation.agent,
      contactOwner: conversation.contact.owner,
      activeProposalOwner: summary.activeProposal?.assignedUser ?? null
    }),
    updatedAt: conversation.updatedAt
  });
}
