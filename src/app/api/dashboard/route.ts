import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/permissions";

const periodDays = {
  "7d": 7,
  "30d": 30,
  "90d": 90
} as const;

function getPeriodStart(period: string | null) {
  if (!period || period === "all") return undefined;

  const days = periodDays[period as keyof typeof periodDays];
  if (!days) return undefined;

  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

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

function localDateTimeToUtcDate({
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

function getTodayRange(timeZone = "America/Sao_Paulo") {
  const today = getTimeZoneParts(new Date(), timeZone);
  const tomorrowDate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  const tomorrow = {
    year: tomorrowDate.getUTCFullYear(),
    month: tomorrowDate.getUTCMonth() + 1,
    day: tomorrowDate.getUTCDate()
  };

  return {
    start: localDateTimeToUtcDate({ ...today, timeZone }),
    end: localDateTimeToUtcDate({ ...tomorrow, timeZone })
  };
}
function sumMoney<T extends { amount?: { toNumber: () => number }; commission?: { toNumber: () => number } }>(
  rows: T[],
  field: "amount" | "commission"
) {
  return rows.reduce((sum, row) => sum + (row[field]?.toNumber() ?? 0), 0);
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const period = request.nextUrl.searchParams.get("period") ?? "30d";
    const originId = request.nextUrl.searchParams.get("originId") ?? "";
    const ownerId = request.nextUrl.searchParams.get("ownerId") ?? "";
    const since = getPeriodStart(period);
    const previousSince = since ? new Date(since.getTime() - (periodDays[period as keyof typeof periodDays] ?? 0) * 86400000) : null;
    const todayRange = getTodayRange();
    const now = new Date();
    const contactWhere = {
      companyId: session.companyId,
      archivedAt: null,
      ...(originId ? { originId } : {}),
      ...(ownerId ? { ownerId } : {})
    };
    const periodContactWhere = {
      ...contactWhere,
      ...(since ? { createdAt: { gte: since } } : {})
    };
    const todayContactWhere = {
      ...contactWhere,
      createdAt: {
        gte: todayRange.start,
        lt: todayRange.end
      }
    };
    const proposalWhere = {
      companyId: session.companyId,
      ...(since ? { createdAt: { gte: since } } : {}),
      ...(originId || ownerId
        ? {
            contact: {
              ...(originId ? { originId } : {}),
              ...(ownerId ? { ownerId } : {})
            }
          }
        : {})
    };
    const returnsWhere = {
      companyId: session.companyId,
      status: "PENDING",
      ...(ownerId
        ? { assigneeId: ownerId }
        : session.role === "AGENT"
          ? { assigneeId: session.id }
          : {})
    };

    const [
      activeContacts,
      newContacts,
      todayContacts,
      hotContacts,
      openConversations,
      staleConversations,
      proposals,
      stageCounts,
      stages,
      statusCounts,
      upcomingTasks,
      pendingReturns,
      overdueReturns,
      todayReturns,
      upcomingReturns,
      returnItems,
      priorityConversations,
      priorityProposals,
      priorityContacts,
      conversationGroups,
      channelGroups,
      agentGroups,
      agents,
      leadTrend,
      proposalTrend,
      recentLeads,
      recentSimulations,
      recentInbound,
      responseStats,
      previousLeads,
      previousProposals,
      currentCreatedConversations,
      previousCreatedConversations,
      commercialStages
    ] = await Promise.all([
      prisma.contact.count({ where: contactWhere }),
      prisma.contact.count({ where: periodContactWhere }),
      prisma.contact.count({ where: todayContactWhere }),
      prisma.contact.count({ where: { ...contactWhere, temperature: "HOT" } }),
      prisma.conversation.count({
        where: { status: "OPEN", contact: contactWhere }
      }),
      prisma.conversation.count({
        where: {
          status: { in: ["OPEN", "PENDING"] },
          updatedAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 4) },
          contact: contactWhere
        }
      }),
      prisma.proposal.findMany({
        where: proposalWhere,
        select: { amount: true, commission: true, status: true }
      }),
      prisma.contact.groupBy({
        by: ["stageId"],
        where: contactWhere,
        _count: { _all: true }
      }),
      prisma.pipelineStage.findMany({
        where: { companyId: session.companyId },
        orderBy: { position: "asc" },
        select: { id: true, name: true, color: true }
      }),
      prisma.proposal.groupBy({
        by: ["status"],
        where: proposalWhere,
        _count: { _all: true }
      }),
      prisma.task.findMany({
        where: {
          companyId: session.companyId,
          status: "PENDING",
          ...(ownerId ? { assigneeId: ownerId } : { assigneeId: session.id })
        },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          assignee: { select: { id: true, name: true, email: true } }
        },
        orderBy: { dueAt: "asc" },
        take: 6
      }),
      prisma.task.count({ where: returnsWhere }),
      prisma.task.count({
        where: {
          ...returnsWhere,
          dueAt: { lt: now }
        }
      }),
      prisma.task.count({
        where: {
          ...returnsWhere,
          dueAt: {
            gte: now,
            lt: todayRange.end
          }
        }
      }),
      prisma.task.count({
        where: {
          ...returnsWhere,
          dueAt: { gte: todayRange.end }
        }
      }),
      prisma.task.findMany({
        where: {
          ...returnsWhere,
          dueAt: { gte: now }
        },
        include: {
          contact: { select: { id: true, name: true, phone: true } },
          assignee: { select: { id: true, name: true, email: true } }
        },
        orderBy: { dueAt: "asc" },
        take: 8
      }),
      prisma.conversation.findMany({
        where: {
          status: { in: ["OPEN", "PENDING"] },
          updatedAt: { lt: new Date(Date.now() - 1000 * 60 * 60 * 4) },
          contact: contactWhere
        },
        include: { contact: true },
        orderBy: { updatedAt: "asc" },
        take: 4
      }),
      prisma.proposal.findMany({
        where: {
          ...proposalWhere,
          status: { in: ["FORMALIZING", "REWORK"] }
        },
        include: { contact: true },
        orderBy: { createdAt: "desc" },
        take: 4
      }),
      prisma.contact.findMany({
        where: {
          ...contactWhere,
          temperature: "HOT",
          conversations: { none: { status: { in: ["OPEN", "PENDING"] } } }
        },
        orderBy: { updatedAt: "desc" },
        take: 4
      }),
      prisma.conversation.groupBy({ by: ["status"], where: { contact: contactWhere }, _count: { _all: true } }),
      prisma.conversation.groupBy({ by: ["channel"], where: { contact: contactWhere }, _count: { _all: true } }),
      prisma.conversation.groupBy({ by: ["agentId"], where: { contact: contactWhere, agentId: { not: null }, ...(since ? { createdAt: { gte: since } } : {}) }, _count: { _all: true }, orderBy: { _count: { agentId: "desc" } }, take: 5 }),
      prisma.user.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true } }),
      prisma.contact.groupBy({ by: ["createdAt"], where: { ...periodContactWhere, createdAt: { gte: since ?? new Date(now.getTime() - 89 * 86400000) } }, _count: { _all: true } }),
      prisma.proposal.groupBy({ by: ["createdAt"], where: { ...proposalWhere, createdAt: { gte: since ?? new Date(now.getTime() - 89 * 86400000) } }, _count: { _all: true } }),
      prisma.contact.findMany({ where: periodContactWhere, select: { id: true, name: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.openCreditCltPrequalification.findMany({ where: { companyId: session.companyId, contact: contactWhere, state: "COMPLETED", completedAt: { not: null, ...(since ? { gte: since } : {}) } }, select: { id: true, completedAt: true, contact: { select: { name: true } } }, orderBy: { completedAt: "desc" }, take: 5 }),
      prisma.conversationInboundEvent.findMany({ where: { companyId: session.companyId, contact: contactWhere, ...(since ? { createdAt: { gte: since } } : {}), message: { type: { in: ["button", "interactive"] } } }, select: { id: true, createdAt: true, contact: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 5 }),
      prisma.$queryRaw<Array<{ total: bigint; answered: bigint; averageSeconds: number | null }>>(Prisma.sql`
        WITH inbound AS (
          SELECT m."conversationId", m."id", m."createdAt",
            LEAD(m."createdAt") OVER (PARTITION BY m."conversationId" ORDER BY m."createdAt", m."id") AS next_inbound
          FROM "Message" m
          JOIN "Conversation" v ON v."id" = m."conversationId"
          JOIN "Contact" c ON c."id" = v."contactId"
          WHERE c."companyId" = ${session.companyId} AND c."archivedAt" IS NULL AND m."direction" = 'inbound'
          ${originId ? Prisma.sql`AND c."originId" = ${originId}` : Prisma.empty}
          ${ownerId ? Prisma.sql`AND c."ownerId" = ${ownerId}` : Prisma.empty}
          ${since ? Prisma.sql`AND m."createdAt" >= ${since}` : Prisma.empty}
        ), replies AS (
          SELECT i."createdAt", (
            SELECT MIN(o."createdAt") FROM "Message" o
            WHERE o."conversationId" = i."conversationId" AND o."direction" = 'outbound'
              AND o."createdAt" > i."createdAt" AND (i.next_inbound IS NULL OR o."createdAt" < i.next_inbound)
              AND o."type" <> 'template' AND o."status" NOT IN ('failed', 'FAILED')
          ) AS replied_at FROM inbound i
        )
        SELECT COUNT(*) AS total, COUNT(replied_at) AS answered,
          AVG(EXTRACT(EPOCH FROM (replied_at - "createdAt")))::double precision AS "averageSeconds"
        FROM replies
      `),
      previousSince && since ? prisma.contact.count({ where: { ...contactWhere, createdAt: { gte: previousSince, lt: since } } }) : Promise.resolve(null),
      previousSince && since ? prisma.proposal.findMany({ where: { ...proposalWhere, createdAt: { gte: previousSince, lt: since } }, select: { amount: true, commission: true, status: true } }) : Promise.resolve(null),
      prisma.conversation.count({ where: { contact: contactWhere, ...(since ? { createdAt: { gte: since } } : {}) } }),
      previousSince && since ? prisma.conversation.count({ where: { contact: contactWhere, createdAt: { gte: previousSince, lt: since } } }) : Promise.resolve(null),
      Promise.all([
        prisma.contact.count({ where: { ...periodContactWhere, conversations: { some: { messages: { some: { direction: "inbound" } } } } } }),
        prisma.contact.count({ where: { ...periodContactWhere, openCreditCltPrequalifications: { some: { companyId: session.companyId, state: "COMPLETED" } } } }),
        prisma.contact.count({ where: { ...periodContactWhere, proposals: { some: { companyId: session.companyId, status: { not: "CANCELED" } } } } }),
        prisma.contact.count({ where: { ...periodContactWhere, proposals: { some: { companyId: session.companyId, status: { in: ["FORMALIZING", "PAID"] } } } } }),
        prisma.contact.count({ where: { ...periodContactWhere, proposals: { some: { companyId: session.companyId, status: "PAID" } } } })
      ])
    ]);

    const activeProposals = proposals.filter((proposal) => proposal.status !== "CANCELED");
    const paidProposals = proposals.filter((proposal) => proposal.status === "PAID");
    const formalizingProposals = proposals.filter(
      (proposal) => proposal.status === "FORMALIZING"
    );
    const conversionRate = activeContacts
      ? Math.round((paidProposals.length / activeContacts) * 1000) / 10
      : 0;

    const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
    const funnel = stageCounts
      .map((item) => {
        const stage = item.stageId ? stageMap.get(item.stageId) : null;
        return {
          id: item.stageId ?? "no-stage",
          label: stage?.name ?? "Sem etapa",
          color: stage?.color ?? "#94a3b8",
          count: item._count._all
        };
      })
      .sort((a, b) => {
        const indexA = stages.findIndex((stage) => stage.id === a.id);
        const indexB = stages.findIndex((stage) => stage.id === b.id);
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
      });

    const proposalStatuses = ["DRAFT", "FORMALIZING", "PAID", "REWORK", "CANCELED"];
    const proposalStatus = proposalStatuses.map((status) => ({
      status,
      count: statusCounts.find((item) => item.status === status)?._count._all ?? 0
    }));

    const priorities = [
      ...priorityConversations.map((conversation) => ({
        id: conversation.id,
        type: "Atendimento",
        title: conversation.contact.name,
        detail: conversation.contact.lastMessage ?? conversation.summary ?? "Conversa sem resposta recente.",
        meta: `Atualizada ${conversation.updatedAt.toISOString()}`,
        severity: "high"
      })),
      ...priorityProposals.map((proposal) => ({
        id: proposal.id,
        type: "Multicred",
        title: `${proposal.product} - ${proposal.contact.name}`,
        detail:
          proposal.status === "REWORK"
            ? "Proposta com pendencia de ajuste."
            : "Proposta em formalizacao.",
        meta: `${proposal.bank} - R$ ${proposal.amount.toString()}`,
        severity: proposal.status === "REWORK" ? "high" : "medium"
      })),
      ...priorityContacts.map((contact) => ({
        id: contact.id,
        type: "Contato",
        title: contact.name,
        detail: contact.lastMessage ?? "Lead quente sem conversa aberta.",
        meta: contact.phone,
        severity: "medium"
      }))
    ].slice(0, 8);

    const dateKey = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const trendMap = new Map<string, { date: string; leads: number; proposals: number }>();
    const trendStart = since ?? new Date(now.getTime() - 89 * 86400000);
    for (let day = new Date(trendStart); day <= now; day = new Date(day.getTime() + 86400000)) {
      const date = dateKey(day);
      trendMap.set(date, { date, leads: 0, proposals: 0 });
    }
    for (const row of leadTrend) { const item = trendMap.get(dateKey(row.createdAt)); if (item) item.leads += row._count._all; }
    for (const row of proposalTrend) { const item = trendMap.get(dateKey(row.createdAt)); if (item) item.proposals += row._count._all; }
    const recentActivity = [
      ...recentLeads.map(row => ({ id: "lead-" + row.id, kind: "lead", title: "Novo lead recebido", detail: row.name, at: row.createdAt.toISOString() })),
      ...recentSimulations.map(row => ({ id: "simulation-" + row.id, kind: "simulation", title: "Simulacao concluida", detail: row.contact.name, at: row.completedAt!.toISOString() })),
      ...recentInbound.map(row => ({ id: "button-" + row.id, kind: "button", title: "Interacao com botao", detail: row.contact.name, at: row.createdAt.toISOString() }))
    ].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 6);
    const response = responseStats[0];
    const inboundTotal = Number(response?.total ?? 0);
    const answered = Number(response?.answered ?? 0);
    return NextResponse.json({
      analytics: {
        recentActivity,
        commercialFunnel: [
          { label: "Leads (base)", count: newContacts, color: "#2563eb" },
          { label: "Responderam", count: commercialStages[0], color: "#0ea5e9" },
          { label: "Pré-simulação CLT", count: commercialStages[1], color: "#6366f1" },
          { label: "Com proposta", count: commercialStages[2], color: "#8b5cf6" },
          { label: "Formalização / pago", count: commercialStages[3], color: "#14b8a6" },
          { label: "Pago", count: commercialStages[4], color: "#16a34a" }
        ],
        comparisons: {
          leads: previousLeads,
          conversationsCreated: previousCreatedConversations,
          currentConversationsCreated: currentCreatedConversations,
          proposals: previousProposals?.filter(row => row.status !== "CANCELED").length ?? null,
          paidAmount: previousProposals ? sumMoney(previousProposals.filter(row => row.status === "PAID"), "amount") : null,
          commission: previousProposals ? sumMoney(previousProposals.filter(row => row.status !== "CANCELED"), "commission") : null
        },
        performance: {
          inboundTotal,
          answered,
          responseRate: inboundTotal ? answered / inboundTotal * 100 : null,
          averageResponseSeconds: response?.averageSeconds ?? null
        },
        trend: Array.from(trendMap.values()),
        channels: channelGroups.map(row => ({ label: row.channel, count: row._count._all })),
        conversations: conversationGroups.map(row => ({ status: row.status, count: row._count._all })),
        agents: agentGroups.flatMap(row => { const agent = agents.find(user => user.id === row.agentId); return agent ? [{ id: agent.id, name: agent.name, count: row._count._all }] : []; })
      },
      filters: { period, originId, ownerId },
      metrics: {
        activeContacts,
        newContacts,
        todayContacts,
        hotContacts,
        openConversations,
        staleConversations,
        proposals: activeProposals.length,
        formalizingProposals: formalizingProposals.length,
        paidProposals: paidProposals.length,
        totalProposalAmount: sumMoney(activeProposals, "amount"),
        paidAmount: sumMoney(paidProposals, "amount"),
        commissionForecast: sumMoney(activeProposals, "commission"),
        conversionRate
      },
      funnel,
      proposalStatus,
      tasks: upcomingTasks.map((task) => ({
        id: task.id,
        title: task.title,
        note: task.note,
        dueAt: task.dueAt,
        status: task.status,
        contact: task.contact,
        assignee: task.assignee
      })),
      returns: {
        totalPending: pendingReturns,
        overdue: overdueReturns,
        today: todayReturns,
        upcoming: upcomingReturns,
        items: returnItems.map((task) => ({
          id: task.id,
          title: task.title,
          note: task.note,
          dueAt: task.dueAt,
          status: task.status,
          contact: task.contact,
          assignee: task.assignee
        }))
      },
      priorities
    });
  } catch {
    return NextResponse.json(
      { error: "Nao foi possivel carregar dashboard." },
      { status: 500 }
    );
  }
}
