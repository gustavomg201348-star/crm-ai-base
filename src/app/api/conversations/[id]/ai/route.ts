import { generateManualAiReplySuggestion } from "@/lib/ai-attendant.service";
import { buildAiResponseContext } from "@/lib/ai-response-context";
import { createAiReplyPostHandler } from "@/lib/ai-reply-route-handler";
import { getSessionFromRequest } from "@/lib/auth";
import { resolveConversationAccess } from "@/lib/conversation-access-control";
import { prisma } from "@/lib/db";
import { enforceRateLimits } from "@/lib/rate-limit";

export const POST = createAiReplyPostHandler({
  getSession: getSessionFromRequest,
  enforceLimits: enforceRateLimits,
  resolveAccess: ({ session, conversationId }) =>
    resolveConversationAccess({ db: prisma, session, conversationId }),
  buildContext: buildAiResponseContext,
  generateSuggestion: generateManualAiReplySuggestion
});
