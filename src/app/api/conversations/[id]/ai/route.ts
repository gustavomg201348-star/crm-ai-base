import { generateManualAiReplySuggestion } from "@/lib/ai-attendant.service";
import { buildAiResponseContext } from "@/lib/ai-response-context";
import { createAiReplyPostHandler } from "@/lib/ai-reply-route-handler";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { prisma } from "@/lib/db";
import { enforceRateLimits, prismaRateLimitStore } from "@/lib/rate-limit";
import { createHmac } from "node:crypto";
import { claimAutoDraft, resolveAutoDraftEligibility } from "@/lib/ai-auto-draft-policy";
import { isOpenCreditConversation, openCreditChannelRef } from "@/lib/conversation-channel.service";

export const POST = createAiReplyPostHandler({
  getSession: getSessionFromRequest,
  enforceLimits: enforceRateLimits,
  resolveAccess: async ({ session, conversationId }) => {
    const access = await resolveConversationAccess({ db: prisma, session, conversationId });
    if (access.status !== "allowed") return access;
    const channel = await prisma.conversation.findFirst({
      where: { id: conversationId, contact: { companyId: session.companyId } },
      select: { channel: true, channelRef: openCreditChannelRef }
    });
    if (!channel) return { status: "not_found" };
    return isOpenCreditConversation(channel) ? { status: "forbidden", conversation: access.conversation } : access;
  },
  buildContext: buildAiResponseContext,
  generateSuggestion: generateManualAiReplySuggestion,
  autoDraftEligible: (input) => resolveAutoDraftEligibility(prisma, input),
  claimAutoDraft: async ({ companyId, conversationId, triggerMessageId }) => {
    const secret = process.env.RATE_LIMIT_SECRET || process.env.AUTH_SECRET;
    if (!secret) return "unavailable";
    const key = createHmac("sha256", secret)
      .update(JSON.stringify(["auto-draft-v1", companyId, conversationId, triggerMessageId]))
      .digest("hex");
    return claimAutoDraft(prismaRateLimitStore, key);
  }
});
