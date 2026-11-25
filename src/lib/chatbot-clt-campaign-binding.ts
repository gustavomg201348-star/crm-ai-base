import { ChatbotError } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";

export type CltCampaignBinding = {
  companyId: string; channelId: string; campaignId: string;
  templateName: string; templateLanguage: string; optionId: string;
  flowId: string; flowVersionId: string; enabled: boolean;
};
type CampaignProjection = { id: string; companyId: string; channelId: string; messageType: string; templateName: string | null; templateLanguage: string | null };
type ReplyProjection = { companyId: string; channelId: string; campaignId: string | null; campaignRecipientId: string | null; templateName: string | null; templateLanguage: string | null; status: string; interactionType: string; optionIdentity: string; optionId: string | null; sourceMessageId: string | null };
type VersionProjection = { id: string; companyId: string; flowId: string; status: string; definition: unknown; flow: { isActive: boolean; publishedVersionId: string | null } };

// Inert contract only: projections must eventually come from scoped persisted rows.
// A match never grants authority or permission to send.
export function matchCltCampaignTrigger(input: {
  binding: CltCampaignBinding | null; campaign: CampaignProjection;
  reply: ReplyProjection; version: VersionProjection | null;
}): { matched: boolean; executable: false } {
  const denied = { matched: false, executable: false } as const;
  const { binding: b, campaign: c, reply: r, version: v } = input;
  if (!b || b.enabled !== true || !v) return denied;
  const required = [b.companyId, b.channelId, b.campaignId, b.templateName, b.templateLanguage, b.optionId, b.flowId, b.flowVersionId];
  if (!required.every(value => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value)) {
    throw new ChatbotError("INVALID_CLT_CAMPAIGN_BINDING");
  }
  if (c.companyId !== b.companyId || c.channelId !== b.channelId || c.id !== b.campaignId ||
      c.messageType !== "TEMPLATE" || c.templateName !== b.templateName || c.templateLanguage !== b.templateLanguage ||
      r.companyId !== b.companyId || r.channelId !== b.channelId || r.campaignId !== b.campaignId ||
      !r.campaignRecipientId || !r.sourceMessageId || r.templateName !== b.templateName || r.templateLanguage !== b.templateLanguage ||
      r.status !== "CONFIRMED" || r.interactionType !== "TEMPLATE_BUTTON" || r.optionIdentity !== "PROVIDER_ID" || r.optionId !== b.optionId ||
      v.companyId !== b.companyId || v.flowId !== b.flowId || v.id !== b.flowVersionId ||
      v.status !== "PUBLISHED" || v.flow.isActive !== true || v.flow.publishedVersionId !== v.id) return denied;
  if (canonicalChatbotValue(v.definition) !== canonicalChatbotValue(buildCltQualificationDefinition())) return denied;
  return { matched: true, executable: false };
}
