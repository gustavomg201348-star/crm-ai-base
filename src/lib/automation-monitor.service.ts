import { Prisma, type PrismaClient } from "@prisma/client";
import {
  defaultLeadAssignmentSettings,
  normalizeAssignmentMode,
} from "./lead-assignment";
import { resolveCltCheckAutoReply } from "./company-ai-settings";
import {
  materializationWorkerMode,
  openCreditMaterializationWorkerConfig,
} from "./opencredit-materialization-worker";

type Tx = Prisma.TransactionClient;
const monitorCodes = [
  "RECEIVED",
  "TRANSIENT_FAILURE",
  "KEY_UNAVAILABLE",
  "SERIALIZATION_CONFLICT",
  "LEASE_EXPIRED",
  "MODE_UNAVAILABLE",
  "ENVELOPE_INVALID",
  "BINDING_MISMATCH",
  "IDENTITY_INSUFFICIENT",
  "CONTACT_IDENTITY_CONFLICT",
  "CONTACT_ARCHIVED_MATCH",
  "CONTACT_DATA_INCOMPLETE",
  "CHANNEL_CONFIGURATION_CONFLICT",
  "CONVERSATION_CONFIGURATION_CONFLICT",
  "RETRY_EXHAUSTED",
];
export const safeMonitorCode = (value: string | null) =>
  value ? (monitorCodes.includes(value) ? value : "UNKNOWN") : null;
export function integrationReadFlags(i: {
  enabled: boolean;
  paused: boolean;
  passiveInboundEnabled: boolean;
  materializationEnabled: boolean;
  providerScope: string | null;
}) {
  const bindingPresent = Boolean(i.providerScope);
  // Same interlock definition as the existing preflight; other gates remain separate.
  return {
    bindingPresent,
    interlockReady: !i.enabled && i.materializationEnabled,
    gatesConfigured:
      !i.enabled &&
      !i.paused &&
      i.passiveInboundEnabled &&
      i.materializationEnabled &&
      bindingPresent,
  };
}
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 2000,
  timeout: 15000,
};
async function readOnly(tx: Tx) {
  if (/^postgres(ql)?:/.test(process.env.DATABASE_URL ?? "")) {
    await tx.$executeRaw`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout='5000ms'`;
  }
}
export async function readAssignmentConfiguration(
  db: Pick<PrismaClient, "leadAssignmentSetting">,
  companyId: string,
) {
  const row = await db.leadAssignmentSetting.findUnique({
    where: { companyId },
    select: {
      mode: true,
      onlineOnly: true,
      maxOpenPerAttendant: true,
      allowAttendantClaim: true,
      redistributeWhenOffline: true,
    },
  });
  return {
    ...(row ?? defaultLeadAssignmentSettings),
    mode: normalizeAssignmentMode(
      row?.mode ?? defaultLeadAssignmentSettings.mode,
    ),
    fallback: false,
  };
}
const operationalRoles = ["ADMIN", "SUPERVISOR", "AGENT"];
async function distribution(tx: Tx, companyId: string) {
  const scope = {
    contact: { companyId },
    status: { in: ["OPEN", "PENDING", "BOT"] },
  };
  const [settings, users, totalUsers, online, assigned, unassigned, history] =
    await Promise.all([
      readAssignmentConfiguration(tx, companyId),
      tx.user.findMany({
        where: { companyId, role: { in: operationalRoles } },
        select: {
          id: true,
          name: true,
          role: true,
          availability: { select: { companyId: true, status: true } },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 501,
      }),
      tx.user.count({ where: { companyId, role: { in: operationalRoles } } }),
      tx.user.count({
        where: {
          companyId,
          role: { in: operationalRoles },
          availability: { is: { companyId, status: "ONLINE" } },
        },
      }),
      tx.conversation.count({ where: { ...scope, agentId: { not: null } } }),
      tx.conversation.count({ where: { ...scope, agentId: null } }),
      tx.leadAssignmentHistory.aggregate({
        where: { companyId },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
    ]);
  const workloads = await tx.conversation.groupBy({
    by: ["agentId"],
    where: {
      ...scope,
      agentId: { in: users.slice(0, 500).map((u) => u.id) },
      agent: { is: { companyId } },
    },
    _count: { _all: true },
  });
  const load = new Map(workloads.map((w) => [w.agentId, w._count._all]));
  const attendants = users.slice(0, 500).map((u) => ({
    id: u.id,
    name: u.name,
    role: u.role,
    availabilityStatus:
      u.availability?.companyId === companyId
        ? u.availability.status
        : "OFFLINE",
    openConversations: load.get(u.id) ?? 0,
  }));
  return {
    settings,
    attendants,
    metrics: {
      totalUsers,
      online,
      assigned,
      unassigned,
      assignments: history._count._all,
      lastAssignmentAt: history._max.createdAt,
    },
    capacity: {
      complete: users.length <= 500,
      remaining:
        users.length > 500 || settings.maxOpenPerAttendant === null
          ? null
          : attendants
              .filter((u) => u.availabilityStatus === "ONLINE")
              .reduce(
                (n, u) =>
                  n +
                  Math.max(
                    0,
                    settings.maxOpenPerAttendant! - u.openConversations,
                  ),
                0,
              ),
      unlimited: settings.maxOpenPerAttendant === null,
    },
  };
}
export async function readDistributionMonitor(
  db: PrismaClient,
  companyId: string,
) {
  return db.$transaction(async (tx) => {
    await readOnly(tx);
    return {
      updatedAt: new Date().toISOString(),
      ...(await distribution(tx, companyId)),
    };
  }, options);
}
export async function readAutomationMonitor(
  db: PrismaClient,
  companyId: string,
) {
  return db.$transaction(async (tx) => {
    await readOnly(tx);
    const now = new Date(),
      recent = new Date(now.getTime() - 7 * 86400000);
    const tasks = {
      companyId,
      contact: { companyId },
      id: { startsWith: "sem-margem-" },
    };
    const [
      company,
      bindings,
      sessions,
      chatbotEvents,
      automaticTasks,
      nextTasks,
      tagCount,
      integrations,
      inbound,
      jobs,
      handoffs,
      assignments,
      banks,
      bankLogs,
      aiOutbound,
    ] = await Promise.all([
      tx.company.findUniqueOrThrow({
        where: { id: companyId },
        select: {
          aiMode: true,
          cltChatbotEnabled: true,
          cltCheckAutoReplyEnabled: true,
        },
      }),
      tx.cltChatbotCampaignBinding.groupBy({
        by: ["enabled"],
        where: { companyId },
        _count: { _all: true },
      }),
      tx.chatbotSession.groupBy({
        by: ["status"],
        where: { companyId, runtimeActorId: { not: null } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      tx.chatbotEvent.groupBy({
        by: ["status"],
        where: { companyId },
        _count: { _all: true },
        _max: { processedAt: true },
      }),
      tx.task.groupBy({
        by: ["status"],
        where: tasks,
        _count: { _all: true },
        _max: { completedAt: true, createdAt: true },
      }),
      tx.task.findMany({
        where: { ...tasks, status: "PENDING" },
        select: {
          id: true,
          status: true,
          dueAt: true,
          createdAt: true,
          completedAt: true,
        },
        orderBy: [{ dueAt: "asc" }, { id: "asc" }],
        take: 20,
      }),
      tx.$queryRaw<
        Array<{ count: bigint | number }>
      >`SELECT COUNT(*) AS count FROM "Tag" WHERE "companyId"=${companyId} AND LOWER(TRIM(name))='sem margem'`,
      tx.openCreditIntegration.findMany({
        where: { companyId },
        select: {
          id: true,
          enabled: true,
          paused: true,
          passiveInboundEnabled: true,
          materializationEnabled: true,
          providerScope: true,
          updatedAt: true,
          whatsappConfigs: {
            where: { companyId },
            select: { autoStartEnabled: true, revision: true },
          },
        },
        take: 51,
        orderBy: { id: "asc" },
      }),
      tx.openCreditInboundEvent.aggregate({
        where: { companyId },
        _count: { _all: true },
        _max: { receivedAt: true },
      }),
      tx.openCreditLeadMaterialization.groupBy({
        by: ["state"],
        where: { companyId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      tx.openCreditWhatsappHandoff.groupBy({
        by: ["state"],
        where: { companyId },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      distribution(tx, companyId),
      tx.cltIntegration.findMany({
        where: { companyId },
        select: {
          id: true,
          bankId: true,
          bankName: true,
          provider: true,
          status: true,
          lastTestAt: true,
          lastTestStatus: true,
          updatedAt: true,
        },
        orderBy: { bankName: "asc" },
        take: 101,
      }),
      tx.cltSimulationLog.groupBy({
        by: ["status"],
        where: { companyId, createdAt: { gte: recent } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      tx.outboundOperation.groupBy({
        by: ["status"],
        where: { companyId, origin: "AI", createdAt: { gte: recent } },
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
    ]);
    return {
      updatedAt: now.toISOString(),
      periodDays: 7,
      ai: {
        outbound: aiOutbound,
        mode: company.aiMode,
        fixedReplyEnabled: resolveCltCheckAutoReply(
          company.cltCheckAutoReplyEnabled,
          process.env.CLT_CHECK_AUTO_REPLY_ENABLED,
        ),
        fixedReplyInherited: company.cltCheckAutoReplyEnabled === null,
        operational: "UNKNOWN" as const,
      },
      chatbot: {
        enabled: company.cltChatbotEnabled,
        bindings,
        sessions,
        events: chatbotEvents,
      },
      rules: {
        semMargem: {
          tagPresent: Number(tagCount[0]?.count ?? 0) > 0,
          schedule: "Dia 23 do mês seguinte, 08:00, America/Sao_Paulo",
          tasks: automaticTasks,
          nextTasks,
          historyLimitedTo: 20,
        },
      },
      opencredit: {
        integrations: integrations
          .slice(0, 50)
          .map(({ providerScope, whatsappConfigs, ...i }) => ({
            ...i,
            ...integrationReadFlags({ ...i, providerScope }),
            autoStartConfigured: whatsappConfigs.some(
              (w) => w.autoStartEnabled,
            ),
          })),
        integrationsTruncated: integrations.length > 50,
        inbound: {
          total: inbound._count._all,
          lastReceivedAt: inbound._max.receivedAt,
        },
        jobs,
        handoffs,
        worker: {
          enabled:
            process.env.OPENCREDIT_MATERIALIZATION_WORKER_ENABLED === "true",
          mode: materializationWorkerMode({
            OPENCREDIT_MATERIALIZATION_WORKER_MODE:
              process.env.OPENCREDIT_MATERIALIZATION_WORKER_MODE,
            OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID:
              process.env.OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID,
          }).kind,
          ...openCreditMaterializationWorkerConfig(),
          operational: "UNKNOWN" as const,
        },
      },
      distribution: assignments,
      banks: {
        integrations: banks.slice(0, 100),
        truncated: banks.length > 100,
        recentLogs: bankLogs,
      },
    };
  }, options);
}
export const materializationStates = [
  "PENDING",
  "RETRY",
  "PROCESSING",
  "NEEDS_REVIEW",
  "COMPLETED",
  "EXPIRED",
] as const;
export async function readOpenCreditMonitor(
  db: PrismaClient,
  companyId: string,
  params: URLSearchParams,
) {
  const page = Number(params.get("page") ?? 0),
    state = params.get("state") ?? "ALL",
    integrationId = params.get("integrationId") ?? "";
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page > 10000 ||
    !["ALL", ...materializationStates].includes(state) ||
    integrationId.length > 150
  )
    throw Error("INVALID_FILTER");
  return db.$transaction(async (tx) => {
    await readOnly(tx);
    if (
      integrationId &&
      !(await tx.openCreditIntegration.findFirst({
        where: { id: integrationId, companyId },
        select: { id: true },
      }))
    )
      throw Error("NOT_FOUND");
    const where = { companyId, ...(integrationId ? { integrationId } : {}) },
      now = new Date();
    const [
      counts,
      inbound,
      total,
      legacy,
      stale,
      expiredActive,
      rows,
      recentInbound,
      integrations,
      handoffs,
    ] = await Promise.all([
      tx.openCreditLeadMaterialization.groupBy({
        by: ["state"],
        where,
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
      tx.openCreditInboundEvent.aggregate({
        where,
        _count: { _all: true },
        _max: { receivedAt: true },
      }),
      tx.openCreditLeadMaterialization.count({ where }),
      tx.openCreditLead.count({ where }),
      tx.openCreditLeadMaterialization.count({
        where: { ...where, state: "PROCESSING", leaseUntil: { lte: now } },
      }),
      tx.openCreditLeadMaterialization.count({
        where: {
          ...where,
          state: { in: ["PENDING", "RETRY", "PROCESSING", "NEEDS_REVIEW"] },
          expiresAt: { lte: now },
        },
      }),
      tx.openCreditLeadMaterialization.findMany({
        where: { ...where, ...(state !== "ALL" ? { state } : {}) },
        select: {
          id: true,
          inboundEventId: true,
          integrationId: true,
          state: true,
          attempts: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
          availableAt: true,
          leaseUntil: true,
          lastErrorCode: true,
          reviewCode: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page * 50,
        take: 51,
      }),
      tx.openCreditInboundEvent.findMany({
        where,
        select: {
          id: true,
          receivedAt: true,
          eventType: true,
          processingState: true,
          integrationId: true,
        },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        take: 20,
      }),
      tx.openCreditIntegration.findMany({
        where: { companyId },
        select: {
          id: true,
          enabled: true,
          paused: true,
          passiveInboundEnabled: true,
          materializationEnabled: true,
          providerScope: true,
          updatedAt: true,
          whatsappConfigs: {
            where: { companyId },
            select: { autoStartEnabled: true },
          },
        },
        orderBy: { id: "asc" },
        take: 51,
      }),
      tx.openCreditWhatsappHandoff.groupBy({
        by: ["state"],
        where,
        _count: { _all: true },
        _max: { updatedAt: true },
      }),
    ]);
    return {
      updatedAt: now.toISOString(),
      counts,
      total,
      integrations: integrations
        .slice(0, 50)
        .map(({ providerScope, whatsappConfigs, ...i }) => ({
          ...i,
          ...integrationReadFlags({ ...i, providerScope }),
          autoStartConfigured: whatsappConfigs.some((c) => c.autoStartEnabled),
        })),
      integrationsTruncated: integrations.length > 50,
      handoffs,
      legacy,
      inbound: {
        total: inbound._count._all,
        lastReceivedAt: inbound._max.receivedAt,
      },
      stale,
      expiredActive,
      page,
      hasMore: rows.length > 50,
      jobs: rows.slice(0, 50).map((r) => ({
        ...r,
        reviewCode: safeMonitorCode(r.reviewCode),
        lastErrorCode: safeMonitorCode(r.lastErrorCode),
      })),
      recentInbound: recentInbound.map((e) => ({
        ...e,
        eventType: e.eventType === "lead.assigned" ? "lead.assigned" : "OTHER",
        processingState: safeMonitorCode(e.processingState),
      })),
      duplicateCount: null,
    };
  }, options);
}
export type AutomationMonitor = Awaited<
  ReturnType<typeof readAutomationMonitor>
>;
export type DistributionMonitor = Awaited<
  ReturnType<typeof readDistributionMonitor>
>;
export type OpenCreditMonitor = Awaited<
  ReturnType<typeof readOpenCreditMonitor>
>;
