import type { Prisma } from "@prisma/client";
import { matchCltCampaignTrigger } from "./chatbot-clt-campaign-binding";

export async function readStoredCltCampaignTrigger(db: Prisma.TransactionClient, scope: {
  companyId: string; channelId: string; correlationId: string;
}) {
  const { companyId, channelId, correlationId } = scope;
  if (![companyId, channelId, correlationId].every(value =>
    typeof value === "string" && value.length > 0 && value.trim() === value)) return null;
  const reply = await db.chatbotReplyCorrelation.findFirst({
    where: { id: correlationId, companyId, channelId, status: "CONFIRMED" },
    include: { inboundMessage: { select: { metaReplyConflictSnapshot: true } } }
  });
  if (!reply?.campaignId || reply.inboundMessage.metaReplyConflictSnapshot !== null) return null;
  const binding = await db.cltChatbotCampaignBinding.findFirst({
    where: { companyId, channelId, campaignId: reply.campaignId, enabled: true },
    include: { campaign: true, version: { include: { flow: true } } }
  });
  if (!binding) return null;
  const version = { ...binding.version, definition: JSON.parse(binding.version.definition) as unknown };
  const match = matchCltCampaignTrigger({ binding, campaign: binding.campaign, reply, version });
  return match.matched ? { binding, reply, version } : null;
}

export async function resolveStoredCltCampaignTrigger(db: Prisma.TransactionClient, scope: Parameters<typeof readStoredCltCampaignTrigger>[1]) {
  return { matched: Boolean(await readStoredCltCampaignTrigger(db, scope)), executable: false } as const;
}
