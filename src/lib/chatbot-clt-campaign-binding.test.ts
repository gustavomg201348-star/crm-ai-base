import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCltCampaignTrigger } from "./chatbot-clt-campaign-binding";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";

const binding = { companyId: "company", channelId: "channel", campaignId: "campaign",
  templateName: "clt", templateLanguage: "pt_BR", optionId: "CONFERIR",
  flowId: "flow", flowVersionId: "version", enabled: true };
const campaign = { id: binding.campaignId, companyId: binding.companyId, channelId: binding.channelId,
  messageType: "TEMPLATE", templateName: binding.templateName, templateLanguage: binding.templateLanguage };
const reply = { companyId: binding.companyId, channelId: binding.channelId, campaignId: binding.campaignId,
  campaignRecipientId: "recipient", templateName: binding.templateName, templateLanguage: binding.templateLanguage,
  status: "CONFIRMED", interactionType: "TEMPLATE_BUTTON", optionIdentity: "PROVIDER_ID",
  optionId: binding.optionId, sourceMessageId: "message" };
const version = { id: binding.flowVersionId, companyId: binding.companyId, flowId: binding.flowId,
  status: "PUBLISHED", definition: buildCltQualificationDefinition(),
  flow: { isActive: true, publishedVersionId: binding.flowVersionId } };
const valid = { binding, campaign, reply, version };

test("explicit campaign and exact option match is inert", () => {
  assert.deepEqual(matchCltCampaignTrigger(valid), { matched: true, executable: false });
});
test("control group, wrong tenant, campaign, button, language and inactive version cannot trigger", () => {
  for (const input of [
    { ...valid, binding: null },
    { ...valid, binding: { ...binding, enabled: false } },
    { ...valid, campaign: { ...campaign, id: "other" } },
    { ...valid, campaign: { ...campaign, companyId: "other" } },
    { ...valid, reply: { ...reply, channelId: "other" } },
    { ...valid, reply: { ...reply, optionId: "NAO" } },
    { ...valid, reply: { ...reply, optionIdentity: "TITLE_ONLY" } },
    { ...valid, reply: { ...reply, status: "CONFLICT" } },
    { ...valid, reply: { ...reply, templateLanguage: "en_US" } },
    { ...valid, reply: { ...reply, campaignRecipientId: null } },
    { ...valid, version: null },
    { ...valid, version: { ...version, status: "DRAFT" } },
    { ...valid, version: { ...version, flow: { ...version.flow, isActive: false } } },
    { ...valid, version: { ...version, flow: { ...version.flow, publishedVersionId: "new" } } }
  ]) assert.deepEqual(matchCltCampaignTrigger(input), { matched: false, executable: false });
});
