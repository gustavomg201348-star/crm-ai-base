import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ACTIVE_PROPOSAL_STATUS_VALUES } from "@/lib/opportunity-summary-rules";
import { listOpportunityQueue } from "@/lib/opportunity-queue-service";
import type { OpportunityQueueResult } from "@/lib/opportunity-queue-types";
import type {
  CommercialControlOperationalItem,
  CommercialControlOverview,
  CommercialControlGoalPace,
  CommercialControlTaskItem
} from "@/lib/commercial-control-types";

type CommercialControlDb = Pick<
  PrismaClient,
  | "company"
  | "conversation"
  | "task"
  | "proposal"
  | "campaign"
  | "campaignRecipient"
  | "contact"
  | "pipelineStage"
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
const OPERATIONAL_ITEM_LIMIT = 8;
const RETURN_TASK_PREFIX = "Retorno:";
const FORGOTTEN_CLIENT_THRESHOLD_MS = 1000 * 60 * 60 * 4;
const PACE_ON_TRACK_TOLERANCE_PERCENT = 5;
const PACE_ATTENTION_TOLERANCE_PERCENT = 15;
type ActiveGoalPaceStatus = "NO_RITMO" | "ATENCAO" | "ABAIXO_DO_RITMO";
const GOAL_PACE_NOT_CONFIGURED_MESSAGE =
  "Meta diaria ainda nao configurada. Acompanhe o realizado de hoje, mas o ritmo nao pode ser classificado com seguranca.";

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

function getOverdueMinutes({ dueAt, now }: { dueAt: Date; now: Date }) {
  return Math.max(0, Math.floor((now.getTime() - dueAt.getTime()) / (1000 * 60)));
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

function mapTaskOperationalItem({
  task,
  now,
  sourceType = "TASK",
  reason,
  actionLabel
}: {
  task: {
    id: string;
    title: string;
    dueAt: Date;
    contact: { id: string; name: string; phone: string | null };
    assignee: { id: string; name: string } | null;
  };
  now: Date;
  sourceType?: "TASK";
  reason: string;
  actionLabel: string;
}): CommercialControlOperationalItem {
  return {
    id: `${sourceType.toLowerCase()}-${task.id}`,
    sourceId: task.id,
    sourceType,
    title: task.title,
    reason,
    dueAt: toIso(task.dueAt),
    overdueMinutes: getOverdueMinutes({ dueAt: task.dueAt, now }),
    actionLabel,
    conversationId: null,
    contact: {
      id: task.contact.id,
      name: task.contact.name,
      phone: task.contact.phone
    },
    owner: task.assignee
      ? {
          id: task.assignee.id,
          name: task.assignee.name
        }
      : null
  };
}

function mapForgottenConversationItem({
  conversation,
  now
}: {
  conversation: {
    id: string;
    updatedAt: Date;
    lastMessageAt: Date | null;
    contact: { id: string; name: string; phone: string | null };
    agent: { id: string; name: string } | null;
  };
  now: Date;
}): CommercialControlOperationalItem {
  const referenceDate = conversation.lastMessageAt ?? conversation.updatedAt;

  return {
    id: `conversation-${conversation.id}`,
    sourceId: conversation.id,
    sourceType: "CONVERSATION",
    title: "Cliente aguardando resposta",
    reason: "Conversa pendente acima do limite operacional de 4h.",
    dueAt: toIso(referenceDate),
    overdueMinutes: getOverdueMinutes({ dueAt: referenceDate, now }),
    actionLabel: "Abrir conversa",
    conversationId: conversation.id,
    contact: {
      id: conversation.contact.id,
      name: conversation.contact.name,
      phone: conversation.contact.phone
    },
    owner: conversation.agent
      ? {
          id: conversation.agent.id,
          name: conversation.agent.name
        }
      : null
  };
}

function mapRiskyProposalItem({
  proposal,
  now
}: {
  proposal: {
    id: string;
    product: string;
    status: string;
    updatedAt: Date;
    assignedUser: { id: string; name: string } | null;
    contact: {
      id: string;
      name: string;
      phone: string | null;
      tasks: Array<{
        id: string;
        title: string;
        dueAt: Date;
        assignee: { id: string; name: string } | null;
      }>;
    };
  };
  now: Date;
}): CommercialControlOperationalItem | null {
  const overdueTask = proposal.contact.tasks[0];
  if (!overdueTask) return null;

  return {
    id: `proposal-${proposal.id}`,
    sourceId: proposal.id,
    sourceType: "PROPOSAL",
    title: `${proposal.product} em ${proposal.status}`,
    reason: `Proposta ativa com tarefa vencida: ${overdueTask.title}.`,
    dueAt: toIso(overdueTask.dueAt),
    overdueMinutes: getOverdueMinutes({ dueAt: overdueTask.dueAt, now }),
    actionLabel: "Retomar negociacao",
    conversationId: null,
    contact: {
      id: proposal.contact.id,
      name: proposal.contact.name,
      phone: proposal.contact.phone
    },
    owner: proposal.assignedUser ??
      (overdueTask.assignee
        ? {
            id: overdueTask.assignee.id,
            name: overdueTask.assignee.name
          }
        : null)
  };
}

function dedupeOperationalItemsByContact(items: CommercialControlOperationalItem[]) {
  const seen = new Set<string>();
  const deduped: CommercialControlOperationalItem[] = [];

  for (const item of items) {
    if (seen.has(item.contact.id)) continue;
    seen.add(item.contact.id);
    deduped.push(item);
  }

  return deduped;
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

function decimalToNumber(value: { toNumber(): number } | number | null | undefined) {
  if (typeof value === "number") return value;
  return value?.toNumber() ?? 0;
}

function parseBusinessTime(value?: string | null) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  if (!match) return null;

  return {
    label: `${match[1]}:${match[2]}`,
    minutes: Number(match[1]) * 60 + Number(match[2])
  };
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10;
}

function buildUnconfiguredGoalPace({
  realizedAmount,
  contractsToday,
  averageTicketToday
}: {
  realizedAmount: number;
  contractsToday: number;
  averageTicketToday: number | null;
}): CommercialControlGoalPace {
  return {
    configured: false,
    status: "NOT_CONFIGURED",
    statusLabel: "Meta nao configurada",
    message: GOAL_PACE_NOT_CONFIGURED_MESSAGE,
    targetAmount: null,
    realizedAmount,
    missingAmount: null,
    achievedPercent: null,
    expectedPercent: null,
    paceDifferencePercent: null,
    contractsToday,
    averageTicketToday,
    missingContracts: null,
    businessHours: {
      configured: false,
      start: null,
      end: null,
      elapsedPercent: null
    },
    limitation: "Nao existe meta diaria ou horario comercial persistidos de forma confiavel no schema atual."
  };
}

export function buildGoalPace({
  dailyRevenueGoal,
  businessDayStart,
  businessDayEnd,
  realizedAmount,
  contractsToday,
  averageTicketToday,
  now,
  timeZone
}: {
  dailyRevenueGoal?: { toNumber(): number } | number | null;
  businessDayStart?: string | null;
  businessDayEnd?: string | null;
  realizedAmount: number;
  contractsToday: number;
  averageTicketToday: number | null;
  now: Date;
  timeZone: string;
}): CommercialControlGoalPace {
  const targetAmount = decimalToNumber(dailyRevenueGoal);
  const start = parseBusinessTime(businessDayStart);
  const end = parseBusinessTime(businessDayEnd);

  if (!targetAmount || targetAmount <= 0 || !start || !end || end.minutes <= start.minutes) {
    return buildUnconfiguredGoalPace({
      realizedAmount,
      contractsToday,
      averageTicketToday
    });
  }

  const nowParts = getTimeZoneParts(now, timeZone);
  const currentMinutes = nowParts.hour * 60 + nowParts.minute + nowParts.second / 60;
  const businessDuration = end.minutes - start.minutes;
  const elapsedPercent =
    currentMinutes <= start.minutes
      ? 0
      : currentMinutes >= end.minutes
        ? 100
        : roundPercent(((currentMinutes - start.minutes) / businessDuration) * 100);
  const achievedPercent = roundPercent((realizedAmount / targetAmount) * 100);
  const missingAmount = Math.max(targetAmount - realizedAmount, 0);
  const paceDifferencePercent = roundPercent(achievedPercent - elapsedPercent);
  const missingContracts =
    missingAmount > 0 && averageTicketToday && averageTicketToday > 0
      ? Math.ceil(missingAmount / averageTicketToday)
      : null;

  if (missingAmount <= 0) {
    return {
      configured: true,
      status: "GOAL_REACHED",
      statusLabel: "Meta atingida",
      message: "A meta diaria ja foi atingida com base nos contratos pagos de hoje.",
      targetAmount,
      realizedAmount,
      missingAmount,
      achievedPercent,
      expectedPercent: elapsedPercent,
      paceDifferencePercent,
      contractsToday,
      averageTicketToday,
      missingContracts,
      businessHours: {
        configured: true,
        start: start.label,
        end: end.label,
        elapsedPercent
      },
      limitation: null
    };
  }

  if (currentMinutes < start.minutes) {
    return {
      configured: true,
      status: "NOT_STARTED",
      statusLabel: "Expediente nao iniciado",
      message: "A meta esta configurada, mas o expediente comercial ainda nao comecou.",
      targetAmount,
      realizedAmount,
      missingAmount,
      achievedPercent,
      expectedPercent: elapsedPercent,
      paceDifferencePercent,
      contractsToday,
      averageTicketToday,
      missingContracts,
      businessHours: {
        configured: true,
        start: start.label,
        end: end.label,
        elapsedPercent
      },
      limitation: null
    };
  }

  if (currentMinutes >= end.minutes) {
    return {
      configured: true,
      status: "FINAL",
      statusLabel: "Dia finalizado",
      message: "O expediente configurado ja terminou. O resultado final considera contratos pagos hoje.",
      targetAmount,
      realizedAmount,
      missingAmount,
      achievedPercent,
      expectedPercent: elapsedPercent,
      paceDifferencePercent,
      contractsToday,
      averageTicketToday,
      missingContracts,
      businessHours: {
        configured: true,
        start: start.label,
        end: end.label,
        elapsedPercent
      },
      limitation: null
    };
  }

  const status: ActiveGoalPaceStatus =
    paceDifferencePercent >= -PACE_ON_TRACK_TOLERANCE_PERCENT
      ? "NO_RITMO"
      : paceDifferencePercent >= -PACE_ATTENTION_TOLERANCE_PERCENT
        ? "ATENCAO"
        : "ABAIXO_DO_RITMO";
  const statusLabels = {
    NO_RITMO: "No ritmo",
    ATENCAO: "Atencao",
    ABAIXO_DO_RITMO: "Abaixo do ritmo"
  } satisfies Record<typeof status, string>;
  const statusMessages = {
    NO_RITMO: "O realizado acompanha o percentual esperado para este momento do expediente.",
    ATENCAO: "O realizado esta levemente abaixo do ritmo esperado. Vale acompanhar de perto.",
    ABAIXO_DO_RITMO: "O realizado esta abaixo do ritmo esperado para este horario."
  } satisfies Record<typeof status, string>;

  return {
    configured: true,
    status,
    statusLabel: statusLabels[status],
    message: statusMessages[status],
    targetAmount,
    realizedAmount,
    missingAmount,
    achievedPercent,
    expectedPercent: elapsedPercent,
    paceDifferencePercent,
    contractsToday,
    averageTicketToday,
    missingContracts,
    businessHours: {
      configured: true,
      start: start.label,
      end: end.label,
      elapsedPercent
    },
    limitation: null
  };
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
  const overdueTaskWhere = {
    ...taskWhere,
    dueAt: { lt: now }
  };
  const overdueNextActionWhere = {
    ...overdueTaskWhere,
    NOT: { title: { startsWith: RETURN_TASK_PREFIX } }
  };
  const overdueAppointmentWhere = {
    ...overdueTaskWhere,
    title: { startsWith: RETURN_TASK_PREFIX }
  };
  const forgottenClientThreshold = new Date(now.getTime() - FORGOTTEN_CLIENT_THRESHOLD_MS);
  const forgottenConversationWhere = {
    ...conversationCompanyWhere,
    status: "PENDING",
    updatedAt: { lt: forgottenClientThreshold }
  };
  const activeProposalStatuses = [...ACTIVE_PROPOSAL_STATUS_VALUES];
  const riskyProposalWhere = {
    companyId,
    status: { in: activeProposalStatuses },
    contact: {
      archivedAt: null,
      tasks: {
        some: overdueTaskWhere
      }
    }
  };
  const todayDateWhere = {
    gte: ranges.todayStart,
    lt: ranges.todayEnd
  };
  const paidTodayWhere = {
    OR: [
      { paidAt: todayDateWhere },
      { paidAt: null, updatedAt: todayDateWhere }
    ]
  };
  const tomorrowDateWhere = {
    gte: ranges.tomorrowStart,
    lt: ranges.tomorrowEnd
  };

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
    productionToday,
    todayCampaigns,
    activeCampaigns,
    sentToday,
    campaignItems,
    pipelineStages,
    pipelineCounts,
    priorityQueue,
    forgottenClients,
    forgottenClientItems,
    overdueNextActions,
    overdueAppointments,
    overdueOperationalTasks,
    riskyNegotiations,
    riskyProposalCandidates,
    companySettings
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
        ...paidTodayWhere
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
    db.proposal.aggregate({
      where: {
        companyId,
        status: CONTRACT_STATUS,
        ...paidTodayWhere
      },
      _sum: { amount: true },
      _avg: { amount: true }
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
    }),
    db.conversation.count({
      where: forgottenConversationWhere
    }),
    db.conversation.findMany({
      where: forgottenConversationWhere,
      orderBy: { updatedAt: "asc" },
      take: OPERATIONAL_ITEM_LIMIT,
      select: {
        id: true,
        updatedAt: true,
        lastMessageAt: true,
        contact: { select: { id: true, name: true, phone: true } },
        agent: { select: { id: true, name: true } }
      }
    }),
    db.task.count({
      where: overdueNextActionWhere
    }),
    db.task.count({
      where: overdueAppointmentWhere
    }),
    db.task.findMany({
      where: overdueTaskWhere,
      orderBy: { dueAt: "asc" },
      take: OPERATIONAL_ITEM_LIMIT * 3,
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        assignee: { select: { id: true, name: true } }
      }
    }),
    db.proposal.count({
      where: riskyProposalWhere
    }),
    db.proposal.findMany({
      where: riskyProposalWhere,
      orderBy: { updatedAt: "asc" },
      take: OPERATIONAL_ITEM_LIMIT * 3,
      select: {
        id: true,
        product: true,
        status: true,
        updatedAt: true,
        assignedUser: { select: { id: true, name: true } },
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            tasks: {
              where: overdueTaskWhere,
              orderBy: { dueAt: "asc" },
              take: 1,
              select: {
                id: true,
                title: true,
                dueAt: true,
                assignee: { select: { id: true, name: true } }
              }
            }
          }
        }
      }
    }),
    db.company.findUnique({
      where: { id: companyId },
      select: {
        dailyRevenueGoal: true,
        businessDayStart: true,
        businessDayEnd: true
      }
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
  const overdueNextActionItems = overdueOperationalTasks
    .filter((task) => !task.title.startsWith(RETURN_TASK_PREFIX))
    .slice(0, OPERATIONAL_ITEM_LIMIT)
    .map((task) =>
      mapTaskOperationalItem({
        task,
        now,
        reason: "Proxima acao vencida e ainda pendente.",
        actionLabel: "Executar proxima acao"
      })
    );
  const overdueAppointmentItems = overdueOperationalTasks
    .filter((task) => task.title.startsWith(RETURN_TASK_PREFIX))
    .slice(0, OPERATIONAL_ITEM_LIMIT)
    .map((task) =>
      mapTaskOperationalItem({
        task,
        now,
        reason: "Agendamento de retorno vencido e ainda pendente.",
        actionLabel: "Tratar retorno vencido"
      })
    );
  const riskyNegotiationItems = dedupeOperationalItemsByContact(
    riskyProposalCandidates
      .map((proposal) => mapRiskyProposalItem({ proposal, now }))
      .filter((item): item is CommercialControlOperationalItem => Boolean(item))
  ).slice(0, OPERATIONAL_ITEM_LIMIT);
  const realizedAmount = decimalToNumber(productionToday._sum.amount);
  const averageTicketToday =
    contractsClosed > 0 ? decimalToNumber(productionToday._avg.amount) : null;
  const goalPace = buildGoalPace({
    dailyRevenueGoal: companySettings?.dailyRevenueGoal ?? null,
    businessDayStart: companySettings?.businessDayStart ?? null,
    businessDayEnd: companySettings?.businessDayEnd ?? null,
    realizedAmount,
    contractsToday: contractsClosed,
    averageTicketToday,
    now,
    timeZone
  });

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
    goalPace,
    attention: {
      overdueTasks,
      todayTasks,
      priorityOpportunities: priorityQueue.total,
      activeProposals,
      forgottenClients,
      overdueNextActions,
      overdueAppointments,
      riskyNegotiations
    },
    operationalControl: {
      forgottenClients: {
        total: forgottenClients,
        items: forgottenClientItems.map((conversation) =>
          mapForgottenConversationItem({ conversation, now })
        ),
        limitation: "Usa conversas PENDING sem movimentacao ha mais de 4h; nao interpreta texto das mensagens."
      },
      overdueNextActions: {
        total: overdueNextActions,
        items: overdueNextActionItems,
        limitation: "Usa apenas tarefas PENDING vencidas que nao sao retornos agendados."
      },
      overdueAppointments: {
        total: overdueAppointments,
        items: overdueAppointmentItems,
        limitation: "O modelo nao possui status especifico de reagendamento; item sai da lista quando deixa de estar PENDING ou recebe novo prazo futuro."
      },
      riskyNegotiations: {
        total: riskyNegotiations,
        items: riskyNegotiationItems,
        limitation: "MVP considera em risco somente proposta ativa cujo contato possui tarefa vencida."
      }
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
