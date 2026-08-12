import type { UserAvailability } from "@prisma/client";
import { conversationInclude, mapConversation } from "@/lib/conversations";
import { prisma } from "@/lib/db";
import { markCommercialObservationStale } from "@/lib/commercial-observer-persistence";

export type AssignmentMode = "CLAIM_FIRST" | "ROUND_ROBIN" | "ADMIN_MANUAL";
export type AvailabilityStatus = "ONLINE" | "BUSY" | "OFFLINE" | "PAUSED";

export const defaultLeadAssignmentSettings = {
  mode: "CLAIM_FIRST" as AssignmentMode,
  onlineOnly: true,
  maxOpenPerAttendant: null as number | null,
  allowAttendantClaim: true,
  redistributeWhenOffline: false
};

const globalForLeadAssignment = globalThis as typeof globalThis & {
  crmLeadAssignmentSettings?: Map<string, LeadAssignmentSettings>;
  crmUserAvailability?: Map<string, {
    userId: string;
    companyId: string;
    status: AvailabilityStatus;
    lastSeenAt: Date;
    updatedAt: Date;
  }>;
};

const memorySettings =
  globalForLeadAssignment.crmLeadAssignmentSettings ??
  new Map<string, LeadAssignmentSettings>();
const memoryAvailability =
  globalForLeadAssignment.crmUserAvailability ??
  new Map<string, {
    userId: string;
    companyId: string;
    status: AvailabilityStatus;
    lastSeenAt: Date;
    updatedAt: Date;
  }>();

globalForLeadAssignment.crmLeadAssignmentSettings = memorySettings;
globalForLeadAssignment.crmUserAvailability = memoryAvailability;

type LeadAssignmentSettings = typeof defaultLeadAssignmentSettings;

export function normalizeAvailabilityStatus(value?: string | null): AvailabilityStatus {
  return value === "ONLINE" || value === "BUSY" || value === "PAUSED" || value === "OFFLINE"
    ? value
    : "OFFLINE";
}

export function normalizeAssignmentMode(value?: string | null): AssignmentMode {
  return value === "ROUND_ROBIN" || value === "ADMIN_MANUAL" || value === "CLAIM_FIRST"
    ? value
    : "CLAIM_FIRST";
}

export async function getLeadAssignmentSettings(companyId: string) {
  try {
    const setting = await prisma.leadAssignmentSetting.upsert({
      where: { companyId },
      update: {},
      create: {
        companyId,
        ...defaultLeadAssignmentSettings
      }
    });

    return {
      mode: normalizeAssignmentMode(setting.mode),
      onlineOnly: setting.onlineOnly,
      maxOpenPerAttendant: setting.maxOpenPerAttendant,
      allowAttendantClaim: setting.allowAttendantClaim,
      redistributeWhenOffline: setting.redistributeWhenOffline,
      fallback: false
    };
  } catch {
    return {
      ...(memorySettings.get(companyId) ?? defaultLeadAssignmentSettings),
      fallback: true
    };
  }
}

export async function updateLeadAssignmentSettings({
  companyId,
  data
}: {
  companyId: string;
  data: Partial<typeof defaultLeadAssignmentSettings>;
}) {
  try {
    const setting = await prisma.leadAssignmentSetting.upsert({
      where: { companyId },
      update: {
        ...(data.mode ? { mode: normalizeAssignmentMode(data.mode) } : {}),
        ...(data.onlineOnly !== undefined ? { onlineOnly: data.onlineOnly } : {}),
        ...(data.maxOpenPerAttendant !== undefined
          ? { maxOpenPerAttendant: data.maxOpenPerAttendant }
          : {}),
        ...(data.allowAttendantClaim !== undefined
          ? { allowAttendantClaim: data.allowAttendantClaim }
          : {}),
        ...(data.redistributeWhenOffline !== undefined
          ? { redistributeWhenOffline: data.redistributeWhenOffline }
          : {})
      },
      create: {
        companyId,
        mode: normalizeAssignmentMode(data.mode),
        onlineOnly: data.onlineOnly ?? defaultLeadAssignmentSettings.onlineOnly,
        maxOpenPerAttendant:
          data.maxOpenPerAttendant ?? defaultLeadAssignmentSettings.maxOpenPerAttendant,
        allowAttendantClaim:
          data.allowAttendantClaim ?? defaultLeadAssignmentSettings.allowAttendantClaim,
        redistributeWhenOffline:
          data.redistributeWhenOffline ??
          defaultLeadAssignmentSettings.redistributeWhenOffline
      }
    });

    return {
      mode: normalizeAssignmentMode(setting.mode),
      onlineOnly: setting.onlineOnly,
      maxOpenPerAttendant: setting.maxOpenPerAttendant,
      allowAttendantClaim: setting.allowAttendantClaim,
      redistributeWhenOffline: setting.redistributeWhenOffline,
      fallback: false
    };
  } catch {
    const current = memorySettings.get(companyId) ?? defaultLeadAssignmentSettings;
    const next = {
      mode: normalizeAssignmentMode(data.mode ?? current.mode),
      onlineOnly: data.onlineOnly ?? current.onlineOnly,
      maxOpenPerAttendant:
        data.maxOpenPerAttendant === undefined
          ? current.maxOpenPerAttendant
          : data.maxOpenPerAttendant,
      allowAttendantClaim:
        data.allowAttendantClaim ?? current.allowAttendantClaim,
      redistributeWhenOffline:
        data.redistributeWhenOffline ?? current.redistributeWhenOffline
    };
    memorySettings.set(companyId, next);
    return { ...next, fallback: true };
  }
}

async function getAvailabilityMap(companyId: string) {
  try {
    const rows = await prisma.userAvailability.findMany({ where: { companyId } });
    return new Map(rows.map((row) => [row.userId, row]));
  } catch {
    return new Map(
      Array.from(memoryAvailability.values())
        .filter((row) => row.companyId === companyId)
        .map((row) => [row.userId, row as unknown as UserAvailability])
    );
  }
}

export async function listAttendants(companyId: string) {
  const [users, availabilityMap, workloads] = await Promise.all([
    prisma.user.findMany({
      where: { companyId, role: { in: ["AGENT", "SUPERVISOR"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true, role: true }
    }),
    getAvailabilityMap(companyId),
    prisma.conversation.groupBy({
      by: ["agentId"],
      where: {
        contact: { companyId },
        agentId: { not: null },
        status: { in: ["OPEN", "PENDING", "BOT"] }
      },
      _count: { _all: true }
    })
  ]);

  const workloadMap = new Map(workloads.map((item) => [item.agentId, item._count._all]));

  return users.map((user) => {
    const availability = availabilityMap.get(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      availabilityStatus: normalizeAvailabilityStatus(availability?.status),
      lastSeenAt: availability?.lastSeenAt ?? null,
      openConversations: workloadMap.get(user.id) ?? 0
    };
  });
}

export async function setAttendantStatus({
  companyId,
  userId,
  status
}: {
  companyId: string;
  userId: string;
  status: AvailabilityStatus;
}) {
  const normalized = normalizeAvailabilityStatus(status);

  try {
    const availability = await prisma.userAvailability.upsert({
      where: { userId },
      update: { status: normalized, lastSeenAt: new Date() },
      create: { userId, companyId, status: normalized, lastSeenAt: new Date() }
    });

    return {
      userId,
      availabilityStatus: normalizeAvailabilityStatus(availability.status),
      lastSeenAt: availability.lastSeenAt,
      fallback: false
    };
  } catch {
    const now = new Date();
    memoryAvailability.set(userId, {
      userId,
      companyId,
      status: normalized,
      lastSeenAt: now,
      updatedAt: now
    });

    return {
      userId,
      availabilityStatus: normalized,
      lastSeenAt: now,
      fallback: true
    };
  }
}

async function createAssignmentHistory(
  data: {
    companyId: string;
    conversationId: string;
    assignedToUserId?: string | null;
    assignedByUserId?: string | null;
    mode: string;
    action?: string;
  }
) {
  try {
    await prisma.leadAssignmentHistory.create({
      data: {
        companyId: data.companyId,
        conversationId: data.conversationId,
        assignedToUserId: data.assignedToUserId ?? null,
        assignedByUserId: data.assignedByUserId ?? null,
        mode: data.mode,
        action: data.action ?? "ASSIGNED"
      }
    });
  } catch {
    // Historico e auxiliar; nunca deve bloquear atendimento.
  }
}

export async function assignConversationToUser({
  companyId,
  conversationId,
  assignedToUserId,
  assignedByUserId,
  mode = "MANUAL",
  force = false
}: {
  companyId: string;
  conversationId: string;
  assignedToUserId: string;
  assignedByUserId?: string | null;
  mode?: string;
  force?: boolean;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, contact: { companyId } },
      select: { id: true, agentId: true }
    });

    if (!conversation) {
      throw new Error("Conversa nao encontrada.");
    }

    if (!force && conversation.agentId && conversation.agentId !== assignedToUserId) {
      throw new Error("Esse lead ja foi assumido por outro atendente.");
    }

    const updated = await tx.conversation.update({
      where: { id: conversation.id },
      data: { agentId: assignedToUserId, updatedAt: new Date() },
      include: conversationInclude
    });

    await markCommercialObservationStale({
      companyId,
      conversationId,
      sourceUpdatedAt: updated.updatedAt,
      db: tx as never
    });

    return mapConversation(updated);
  });

  await createAssignmentHistory({
    companyId,
    conversationId,
    assignedToUserId,
    assignedByUserId,
    mode,
    action: "ASSIGNED"
  });

  return updated;
}

export async function unassignConversation({
  companyId,
  conversationId,
  assignedByUserId
}: {
  companyId: string;
  conversationId: string;
  assignedByUserId?: string | null;
}) {
  const updated = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, contact: { companyId } },
      select: { id: true }
    });

    if (!conversation) {
      throw new Error("Conversa nao encontrada.");
    }

    const updated = await tx.conversation.update({
      where: { id: conversation.id },
      data: { agentId: null, updatedAt: new Date() },
      include: conversationInclude
    });

    await markCommercialObservationStale({
      companyId,
      conversationId,
      sourceUpdatedAt: updated.updatedAt,
      db: tx as never
    });

    return mapConversation(updated);
  });

  await createAssignmentHistory({
    companyId,
    conversationId,
    assignedToUserId: null,
    assignedByUserId,
    mode: "UNASSIGN",
    action: "UNASSIGNED"
  });

  return updated;
}

export async function maybeAutoAssignConversation({
  companyId,
  conversationId
}: {
  companyId: string;
  conversationId: string;
}) {
  const settings = await getLeadAssignmentSettings(companyId);
  if (settings.mode !== "ROUND_ROBIN") return null;

  const existing = await prisma.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } },
    select: { agentId: true }
  });

  if (existing?.agentId) return null;

  const attendants = await listAttendants(companyId);
  const candidates = attendants
    .filter((attendant) => attendant.role === "AGENT" || attendant.role === "SUPERVISOR")
    .filter((attendant) =>
      settings.onlineOnly ? attendant.availabilityStatus === "ONLINE" : true
    )
    .filter((attendant) =>
      settings.maxOpenPerAttendant
        ? attendant.openConversations < settings.maxOpenPerAttendant
        : true
    )
    .sort((a, b) => a.openConversations - b.openConversations || a.name.localeCompare(b.name));

  const next = candidates[0];
  if (!next) return null;

  return assignConversationToUser({
    companyId,
    conversationId,
    assignedToUserId: next.id,
    mode: "ROUND_ROBIN"
  });
}
