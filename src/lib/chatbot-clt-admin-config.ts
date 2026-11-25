import { Prisma, type PrismaClient } from "@prisma/client";
import { ChatbotError } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";

function requireConfig(value: unknown, code: string): asserts value {
  if (!value) throw new ChatbotError(code);
}
function reference(value: unknown) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value;
}

export function resolveCltTriggerOption(components: unknown, title: string): string {
  requireConfig(Array.isArray(components), "INVALID_TEMPLATE");
  requireConfig(title === "Conferir" || title === "Verificar", "INVALID_TRIGGER");
  const groups = components.filter(item => item && item.type === "BUTTONS");
  requireConfig(groups.length === 1 && Array.isArray(groups[0].buttons), "INVALID_TEMPLATE");
  const buttons = groups[0].buttons as Array<{ type?: string; text?: string }>;
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const optionId = normalize(title);
  const matches = buttons.filter(button => button && button.type === "QUICK_REPLY" && typeof button.text === "string" && normalize(button.text) === optionId);
  requireConfig(matches.length === 1 && matches[0].text === title, "INVALID_TRIGGER");
  return optionId;
}

// Administration only. A configured binding remains non-executable until runtime fencing exists.
export async function configureCltCampaign(db: PrismaClient, input: {
  companyId: string; actorUserId: string; campaignId: string; buttonTitle: string;
}) {
  const { companyId, actorUserId, campaignId, buttonTitle } = input;
  requireConfig([companyId, actorUserId, campaignId, buttonTitle].every(reference), "INVALID_CONFIG");
  return db.$transaction(async tx => {
    const actor = await tx.user.findFirst({ where: { id: actorUserId, companyId, role: "ADMIN" }, select: { id: true } });
    requireConfig(actor, "FORBIDDEN");
    const campaign = await tx.campaign.findFirst({
      where: { id: campaignId, companyId, messageType: "TEMPLATE" },
      include: { channel: { select: { companyId: true, wabaId: true, type: true, provider: true, status: true } } }
    });
    requireConfig(campaign && campaign.channel.companyId === companyId && campaign.channel.wabaId &&
      campaign.channel.type === "whatsapp" && campaign.channel.provider === "meta" &&
      ["ACTIVE", "CONNECTED"].includes(campaign.channel.status) && campaign.templateName && campaign.templateLanguage, "INVALID_CAMPAIGN");
    const template = await tx.metaTemplate.findFirst({ where: {
      companyId, wabaId: campaign.channel.wabaId, name: campaign.templateName, language: campaign.templateLanguage,
      isActive: true, metaStatus: "APPROVED", operationalStatus: "READY"
    }, select: { components: true } });
    requireConfig(template, "INVALID_TEMPLATE");
    const optionId = resolveCltTriggerOption(JSON.parse(template.components), buttonTitle);
    const key = { companyId, channelId: campaign.channelId, campaignId };
    const existing = await tx.cltChatbotCampaignBinding.findUnique({ where: { companyId_channelId_campaignId: key } });
    if (existing) {
      requireConfig(existing.optionId === optionId && existing.templateName === campaign.templateName &&
        existing.templateLanguage === campaign.templateLanguage, "BINDING_CONFLICT");
      return existing;
    }
    const flow = await tx.chatbotFlow.create({ data: { companyId, name: "Qualificação comercial CLT" } });
    const version = await tx.chatbotFlowVersion.create({ data: {
      companyId, flowId: flow.id, number: 1, status: "PUBLISHED", publishedAt: new Date(),
      definition: canonicalChatbotValue(buildCltQualificationDefinition())
    } });
    await tx.chatbotFlow.update({ where: { id: flow.id }, data: { publishedVersionId: version.id, revision: { increment: 1 } } });
    return tx.cltChatbotCampaignBinding.create({ data: {
      ...key, templateName: campaign.templateName, templateLanguage: campaign.templateLanguage,
      optionId, flowId: flow.id, flowVersionId: version.id, enabled: false
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
