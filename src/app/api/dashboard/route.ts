import { NextResponse, type NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
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
    const session = getSessionFromRequest(request);

    if (!session) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    const blocked = requireAdmin(session);
    if (blocked) return blocked;

    const period = request.nextUrl.searchParams.get("period") ?? "30d";
    const originId = request.nextUrl.searchParams.get("originId") ?? "";
    const ownerId = request.nextUrl.searchParams.get("ownerId") ?? "";
    const since = getPeriodStart(period);
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
      priorityContacts
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
      })
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

    return NextResponse.json({
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
