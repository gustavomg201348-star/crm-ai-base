import { Prisma, type PrismaClient } from "@prisma/client";
import { ChatbotError } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";
import { authorityStorage, type AuthorityDatabase } from "./conversation-authority-storage";
import { normalizeButtonPayload } from "./meta-whatsapp";

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
  const optionId = normalizeButtonPayload(title, 0);
  const matches = buttons.filter(button => button && button.type === "QUICK_REPLY" && typeof button.text === "string" && normalizeButtonPayload(button.text, 0) === optionId);
  requireConfig(matches.length === 1 && matches[0].text === title, "INVALID_TRIGGER");
  return optionId;
}

// A new campaign binding is always disabled.
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

export async function setCltCampaignEnabled(database: AuthorityDatabase, input: {
  companyId: string; actorUserId: string; campaignId: string; enabled: boolean;
}) {
  const { companyId, actorUserId, campaignId, enabled } = input;
  requireConfig([companyId, actorUserId, campaignId].every(reference) && typeof enabled === "boolean", "INVALID_CONFIG");
  const storage = authorityStorage(database);
  return storage.transaction(async tx => {
    const actor = await tx.user.findFirst({ where: { id: actorUserId, companyId, role: "ADMIN" } });
    requireConfig(actor, "FORBIDDEN");
    const binding = await tx.cltChatbotCampaignBinding.findFirst({ where: { companyId, campaignId }, include: {
      campaign: { include: { channel: true } },
      version: { include: { flow: true } }
    } });
    requireConfig(binding, "BINDING_NOT_FOUND");
    const key = { companyId, channelId: binding.channelId, campaignId };
    if (binding.enabled === enabled) return tx.cltChatbotCampaignBinding.findUniqueOrThrow({
      where: { companyId_channelId_campaignId: key }, select: cltBindingFields
    });
    let flowVersionId = binding.flowVersionId;
    if (enabled) {
      const { campaign, version } = binding;
      requireConfig(campaign.messageType === "TEMPLATE" && campaign.templateName === binding.templateName &&
        campaign.templateLanguage === binding.templateLanguage && campaign.channel.companyId === companyId &&
        campaign.channel.type === "whatsapp" && campaign.channel.provider === "meta" && campaign.channel.phoneNumberId &&
        campaign.channel.wabaId && ["ACTIVE", "CONNECTED"].includes(campaign.channel.status), "INVALID_CAMPAIGN");
      const template = await tx.metaTemplate.findFirst({ where: { companyId, wabaId: campaign.channel.wabaId,
        name: binding.templateName, language: binding.templateLanguage, isActive: true, metaStatus: "APPROVED", operationalStatus: "READY" } });
      const title = binding.optionId === "CONFERIR" ? "Conferir" : "Verificar";
      requireConfig(template && resolveCltTriggerOption(JSON.parse(template.components), title) === binding.optionId, "INVALID_TEMPLATE");
      requireConfig(version.flow.isActive, "INVALID_VERSION");
      requireConfig(!await tx.chatbotSession.findFirst({ where: { ...key, status: "ACTIVE", runtimeActorId: { not: null } } }), "PAUSE_PENDING");
      const definition = canonicalChatbotValue(buildCltQualificationDefinition());
      if (version.definition !== definition || version.status !== "PUBLISHED" || version.flow.publishedVersionId !== version.id) {
        const flow = await tx.chatbotFlow.update({ where: { id: binding.flowId },
          data: { versionCounter: { increment: 1 }, revision: { increment: 1 } } });
        const next = await tx.chatbotFlowVersion.create({ data: { companyId, flowId: flow.id, number: flow.versionCounter,
          status: "PUBLISHED", definition, publishedAt: await storage.now(tx) } });
        await tx.chatbotFlow.update({ where: { id: flow.id }, data: { publishedVersionId: next.id } });
        flowVersionId = next.id;
      }
    }
    return tx.cltChatbotCampaignBinding.update({ where: { companyId_channelId_campaignId: key }, data: { enabled, flowVersionId,
      ...(enabled ? { enabledAt: await storage.now(tx), activatedByUserId: actorUserId } : {}) },
      select: cltBindingFields });
  });
}

export const cltBindingFields = { companyId: true, channelId: true, campaignId: true, templateName: true,
  templateLanguage: true, optionId: true, flowId: true, flowVersionId: true, enabled: true, enabledAt: true, updatedAt: true } as const;
