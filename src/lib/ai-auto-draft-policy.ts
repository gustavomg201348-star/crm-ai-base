import type { RateLimitStore } from "@/lib/rate-limit";
import type { PrismaClient } from "@prisma/client";

export type AutoDraftMessage = {
  id: string;
  createdAt: string | Date;
  direction: string;
  senderType?: string | null;
  type?: string | null;
  providerMessageId?: string | null;
  body: string;
};

export type AutoDraftSnapshot = {
  id: string;
  status: string;
  aiMode?: string | null;
  aiPaused: boolean;
  messages: AutoDraftMessage[];
};

// Timestamp ties and incomplete timelines are deliberately not ordered by ID.
export function latestUnansweredAutoDraftMessage(
  snapshot: AutoDraftSnapshot,
  companyMode: string
): AutoDraftMessage | null {
  if ((snapshot.aiMode ?? companyMode) !== "COPILOT" || snapshot.aiPaused ||
      snapshot.status === "RESOLVED" || !snapshot.messages.length) return null;
  let latest: AutoDraftMessage | null = null;
  let maximum = -Infinity;
  let tied = false;
  for (const message of snapshot.messages) {
    const time = new Date(message.createdAt).getTime();
    if (!Number.isFinite(time)) return null;
    if (time > maximum) {
      maximum = time;
      latest = message;
      tied = false;
    } else if (time === maximum && message.id !== latest?.id) tied = true;
  }
  if (!latest || tied || latest.direction !== "inbound" ||
      latest.senderType !== "customer" || !latest.providerMessageId?.trim() ||
      !["text", "button", "interactive"].includes(latest.type ?? "") ||
      !latest.body.trim() ||
      latest.body.trim() === "Resposta interativa recebida") return null;
  return latest;
}

// Sliding expiry from the first claim, not epoch windows: no boundary double-call.
export const AUTO_DRAFT_CLAIM_WINDOW_MS = 24 * 60 * 60_000;

export async function resolveAutoDraftEligibility(
  db: Pick<PrismaClient, "conversation">,
  { companyId, conversationId, triggerMessageId }: {
    companyId: string; conversationId: string; triggerMessageId: string;
  }
) {
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, contact: { companyId } },
    select: {
      id: true, status: true, aiMode: true, aiPaused: true,
      contact: { select: { company: { select: { aiMode: true } } } },
      messages: {
        orderBy: { createdAt: "desc" }, take: 2,
        select: { id: true, createdAt: true, direction: true, senderType: true,
          type: true, providerMessageId: true, body: true }
      }
    }
  });
  return Boolean(conversation && latestUnansweredAutoDraftMessage(
    conversation, conversation.contact.company.aiMode
  )?.id === triggerMessageId);
}

export async function claimAutoDraft(
  store: RateLimitStore,
  key: string,
  now = new Date()
): Promise<"allowed" | "claimed" | "unavailable"> {
  try {
    const result = await store.increment({
      key, now, windowStart: now,
      expiresAt: new Date(now.getTime() + AUTO_DRAFT_CLAIM_WINDOW_MS)
    });
    if (!Number.isSafeInteger(result.count) || result.count < 1 ||
        !(result.expiresAt instanceof Date) || result.expiresAt.getTime() <= now.getTime() ||
        !Number.isFinite(result.expiresAt.getTime())) return "unavailable";
    return result.count === 1 ? "allowed" : "claimed";
  } catch {
    return "unavailable";
  }
}
