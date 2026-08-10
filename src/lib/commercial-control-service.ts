import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_PROPOSAL_STATUS_VALUES } from "@/lib/opportunity-summary-rules";
import { listOpportunityQueue } from "@/lib/opportunity-queue-service";
import type { OpportunityQueueResult } from "@/lib/opportunity-queue-types";
import type { CommercialControlOverview, CommercialControlTaskItem } from "@/lib/commercial-control-types";

type CommercialControlDb = Pick<
  PrismaClient,
  "conversation" | "task" | "proposal" | "campaign" | "campaignRecipient" | "contact" | "pipelineStage"
>;

type CommercialControlInput = {
  companyId: string;
  requesterId: string;
  requesterRole: string;
  now?: Date;
  timeZone?: string;
  db?: CommercialControlDb;
  opportunityQueue?: typeof listOpportunityQueue;
};

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";
const ACTIVE_CAMPAIGN_STATUSES = ["DRAFT", "PENDING", "SENDING", "PAUSED"] as const;
const CONTRACT_STATUS = "PAID";
const TASK_ITEM_LIMIT = 6;
const OPPORTUNITY_LIMIT = 8;
const RECENT_CAMPAIGN_LIMIT = 6;

function getTimeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function getTimeZoneOffset(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function localDateToUtcDate({
  year,
  month,
  day,
  timeZone
}: {
  year: number;
  month: number;
  day: number;
  timeZone: string;
}) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day));
  const offset = getTimeZoneOffset(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offset);
}

export function getCommercialControlDateRanges({
  now,
  timeZone = DEFAULT_TIME_ZONE
}: {
  now: Date;
  timeZone?: string;
}) {
  const today = getTimeZoneParts(now, timeZone);
  const tomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const afterTomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 2));
  const tomorrow = {
    year: tomorrowDate.getUTCFullYear(),
    month: tomorrowDate.getUTCMonth() + 1,
    day: tomorrowDate.getUTCDate()
  };
  const afterTomorrow = {
    year: afterTomorrowDate.getUTCFullYear(),
    month: afterTomorrowDate.getUTCMonth() + 1,
    day: afterTomorrowDate.getUTCDate()
  };

  return {
    todayStart: localDateToUtcDate({ ...today, timeZone }),
    todayEnd: localDateToUtcDate({ ...tomorrow, timeZone }),
    tomorrowStart: localDateToUtcDate({ ...tomorrow, timeZone }),
    tomorrowEnd: localDateToUtcDate({ ...afterTomorrow, timeZone })
  };
}

function toIso(date: Date) {
  return date.toISOString();
}

function mapTaskItem(task: {
  id: string;
  title: string;
  dueAt: Date;
  contact: { id: string; name: string; phone: string | null };
  assignee: { id: string; name: string } | null;
}): CommercialControlTaskItem {
  return {
    id: task.id,
    title: task.title,
    dueAt: toIso(task.dueAt),
    contact: {
      id: task.contact.id,
      name: task.contact.name,
      phone: task.contact.phone
    },
    assignee: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name
        }
      : null
  };
}

function countByPriority(items: OpportunityQueueResult["items"]) {
  const counts = new Map<string, number>();

  for (const item of items) {
    counts.set(item.priority.type, (counts.get(item.priority.type) ?? 0) + 1);
  }

  return Array.from(counts.entries()).map(([priority, count]) => ({
    priority: priority as OpportunityQueueResult["items"][number]["priority"]["type"],
    count
  }));
}

export async function getCommercialControlOverview({
  companyId,
  requesterId,
  requesterRole,
  now = new Date(),
  timeZone = DEFAULT_TIME_ZONE,
  db = prisma,
  opportunityQueue = listOpportunityQueue
}: CommercialControlInput): Promise<CommercialControlOverview> {
  const ranges = getCommercialControlDateRanges({ now, timeZone });
  const contactWhere = {
    companyId,
    archivedAt: null
  };
  const conversationCompanyWhere = {
    contact: contactWhere
  };
  const taskWhere = {
    companyId,
    status: "PENDING"
  };
  const todayDateWhere = {
    gte: ranges.todayStart,
    lt: ranges.todayEnd
  };
  const tomorrowDateWhere = {
    gte: ranges.tomorrowStart,
    lt: ranges.tomorrowEnd
  };
  const activeProposalStatuses = [...ACTIVE_PROPOSAL_STATUS_VALUES];

  const [
    activeOrMovedConversations,
    pendingConversations,
    overdueTasks,
    todayTasks,
    tomorrowTasks,
    agendaTasks,
    proposalsCreated,
    contractsClosed,
    activeProposals,
    proposalStatusCounts,
    todayCampaigns,
    activeCampaigns,
    sentToday,
    campaignItems,
    pipelineStages,
    pipelineCounts,
    priorityQueue
  ] = await Promise.all([
    db.conversation.count({
      where: {
        ...conversationCompanyWhere,
        OR: [
          { createdAt: todayDateWhere },
          { updatedAt: todayDateWhere },
          { lastMessageAt: todayDateWhere }
        ]
      }
    }),
    db.conversation.count({
      where: {
        ...conversationCompanyWhere,
        status: "PENDING"
      }
    }),
    db.task.count({
      where: {
        ...taskWhere,
        dueAt: { lt: now }
      }
    }),
    db.task.count({
      where: {
        ...taskWhere,
        dueAt: todayDateWhere
      }
    }),
    db.task.count({
      where: {
        ...taskWhere,
        dueAt: tomorrowDateWhere
      }
    }),
    db.task.findMany({
      where: {
        ...taskWhere,
        dueAt: { lt: ranges.tomorrowEnd }
      },
      orderBy: { dueAt: "asc" },
      take: TASK_ITEM_LIMIT * 3,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true } }
      }
    }),
    db.proposal.count({
      where: {
        companyId,
        createdAt: todayDateWhere
      }
    }),
    db.proposal.count({
      where: {
        companyId,
        status: CONTRACT_STATUS,
        updatedAt: todayDateWhere
      }
    }),
    db.proposal.count({
      where: {
        companyId,
        status: { in: activeProposalStatuses }
      }
    }),
    db.proposal.groupBy({
      by: ["status"],
      where: { companyId },
      _count: { _all: true }
    }),
    db.campaign.count({
      where: {
        companyId,
        OR: [
          { createdAt: todayDateWhere },
          { startedAt: todayDateWhere },
          { finishedAt: todayDateWhere }
        ]
      }
    }),
    db.campaign.count({
      where: {
        companyId,
        status: { in: [...ACTIVE_CAMPAIGN_STATUSES] }
      }
    }),
    db.campaignRecipient.count({
      where: {
        campaign: { companyId },
        sentAt: todayDateWhere
      }
    }),
    db.campaign.findMany({
      where: {
        companyId,
        OR: [
          { createdAt: todayDateWhere },
          { startedAt: todayDateWhere },
          { finishedAt: todayDateWhere },
          { status: { in: [...ACTIVE_CAMPAIGN_STATUSES] } }
        ]
      },
      orderBy: { updatedAt: "desc" },
      take: RECENT_CAMPAIGN_LIMIT,
      select: {
        id: true,
        name: true,
        status: true,
        total: true,
        sent: true,
        failed: true,
        updatedAt: true
      }
    }),
    db.pipelineStage.findMany({
      where: { companyId },
      orderBy: { position: "asc" },
      select: { id: true, name: true, color: true, position: true }
    }),
    db.contact.groupBy({
      by: ["stageId"],
      where: contactWhere,
      _count: { _all: true }
    }),
    opportunityQueue({
      companyId,
      requesterId,
      requesterRole,
      limit: OPPORTUNITY_LIMIT
    })
  ]);

  const overdueItems = agendaTasks
    .filter((task) => task.dueAt.getTime() < now.getTime())
    .slice(0, TASK_ITEM_LIMIT)
    .map(mapTaskItem);
  const todayItems = agendaTasks
    .filter(
      (task) =>
        task.dueAt.getTime() >= ranges.todayStart.getTime() &&
        task.dueAt.getTime() < ranges.todayEnd.getTime()
    )
    .slice(0, TASK_ITEM_LIMIT)
    .map(mapTaskItem);
  const tomorrowItems = agendaTasks
    .filter(
      (task) =>
        task.dueAt.getTime() >= ranges.tomorrowStart.getTime() &&
        task.dueAt.getTime() < ranges.tomorrowEnd.getTime()
    )
    .slice(0, TASK_ITEM_LIMIT)
    .map(mapTaskItem);
  const pipelineCountMap = new Map(
    pipelineCounts.map((item) => [item.stageId, item._count._all])
  );
  const stageItems = pipelineStages.map((stage) => ({
    id: stage.id,
    name: stage.name,
    color: stage.color,
    position: stage.position,
    count: pipelineCountMap.get(stage.id) ?? 0
  }));
  const withoutStageCount = pipelineCountMap.get(null) ?? 0;

  return {
    generatedAt: toIso(now),
    period: {
      timeZone,
      todayStart: toIso(ranges.todayStart),
      todayEnd: toIso(ranges.todayEnd),
      tomorrowStart: toIso(ranges.tomorrowStart),
      tomorrowEnd: toIso(ranges.tomorrowEnd)
    },
    today: {
      activeOrMovedConversations,
      pendingConversations,
      proposalsCreated,
      contractsClosed,
      priorityOpportunities: priorityQueue.total
    },
    attention: {
      overdueTasks,
      todayTasks,
      priorityOpportunities: priorityQueue.total,
      activeProposals
    },
    agenda: {
      overdue: {
        total: overdueTasks,
        items: overdueItems
      },
      today: {
        total: todayTasks,
        items: todayItems
      },
      tomorrow: {
        total: tomorrowTasks,
        items: tomorrowItems
      }
    },
    opportunities: {
      total: priorityQueue.total,
      scanned: priorityQueue.scanned,
      byPriority: countByPriority(priorityQueue.items),
      items: priorityQueue.items.map((item) => ({
        id: item.id,
        conversationId: item.conversationId,
        contactName: item.contact.name,
        ownerName: item.owner?.name ?? "Sem responsavel",
        priority: item.priority.type,
        productLabel: item.product.label,
        reason: item.queueReason,
        actionLabel: item.primaryAction.title
      }))
    },
    proposals: {
      createdToday: proposalsCreated,
      contractsToday: contractsClosed,
      activeTotal: activeProposals,
      byStatus: proposalStatusCounts.map((item) => ({
        status: item.status,
        count: item._count._all
      }))
    },
    campaigns: {
      todayTotal: todayCampaigns,
      activeTotal: activeCampaigns,
      sentToday,
      items: campaignItems.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        total: campaign.total,
        sent: campaign.sent,
        failed: campaign.failed,
        updatedAt: toIso(campaign.updatedAt)
      }))
    },
    pipeline: {
      totalContacts: stageItems.reduce((sum, stage) => sum + stage.count, withoutStageCount),
      stages: withoutStageCount
        ? [
            ...stageItems,
            {
              id: null,
              name: "Sem etapa",
              color: null,
              position: Number.MAX_SAFE_INTEGER,
              count: withoutStageCount
            }
          ]
        : stageItems
    }
  };
}
