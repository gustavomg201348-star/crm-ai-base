import type { PrismaClient } from "@prisma/client";
import { matchCltCampaignTrigger } from "./chatbot-clt-campaign-binding";

// Read-only resolution. No session creation, webhook hook or transport.
export async function resolveStoredCltCampaignTrigger(db: PrismaClient, scope: {
  companyId: string; channelId: string; correlationId: string;
}) {
  const { companyId, channelId, correlationId } = scope;
  const denied = { matched: false, executable: false } as const;
  if (![companyId, channelId, correlationId].every(value =>
    typeof value === "string" && value.length > 0 && value.trim() === value)) return denied;
  const reply = await db.chatbotReplyCorrelation.findFirst({
    where: { id: correlationId, companyId, channelId, status: "CONFIRMED" },
    include: { inboundMessage: { select: { metaReplyConflictSnapshot: true } } }
  });
  if (!reply?.campaignId || reply.inboundMessage.metaReplyConflictSnapshot !== null) return denied;
  const binding = await db.cltChatbotCampaignBinding.findFirst({
    where: { companyId, channelId, campaignId: reply.campaignId, enabled: true },
    include: { campaign: true, version: { include: { flow: true } } }
  });
  if (!binding) return denied;
  return matchCltCampaignTrigger({ binding, campaign: binding.campaign, reply,
    version: { ...binding.version, definition: JSON.parse(binding.version.definition) } });
}
