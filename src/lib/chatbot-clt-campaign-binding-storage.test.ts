import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { resolveStoredCltCampaignTrigger } from "./chatbot-clt-campaign-binding-storage";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";

const scope = { companyId: "company", channelId: "channel", correlationId: "receipt" };
const binding = { companyId: scope.companyId, channelId: scope.channelId, campaignId: "campaign",
  templateName: "clt", templateLanguage: "pt_BR", optionId: "CONFERIR",
  flowId: "flow", flowVersionId: "version", enabled: true };
const reply = { ...binding, status: "CONFIRMED", interactionType: "TEMPLATE_BUTTON",
  optionIdentity: "PROVIDER_ID", campaignRecipientId: "recipient", sourceMessageId: "message",
  inboundMessage: { metaReplyConflictSnapshot: null } };
const stored = { ...binding,
  campaign: { ...binding, id: binding.campaignId, messageType: "TEMPLATE" },
  version: { id: binding.flowVersionId, companyId: binding.companyId, flowId: binding.flowId,
    status: "PUBLISHED", definition: JSON.stringify(buildCltQualificationDefinition()),
    flow: { isActive: true, publishedVersionId: binding.flowVersionId } } };

test("resolver queries explicit scoped receipt and enabled binding without writes", async () => {
  let queries = 0;
  const db = { chatbotReplyCorrelation: { findFirst: async (args: unknown) => {
    assert.deepEqual(args, { where: { id: scope.correlationId, companyId: scope.companyId,
      channelId: scope.channelId, status: "CONFIRMED" },
      include: { inboundMessage: { select: { metaReplyConflictSnapshot: true } } } });
    queries++;
    return reply;
  } }, cltChatbotCampaignBinding: { findFirst: async (args: unknown) => {
    assert.deepEqual(args, { where: { companyId: scope.companyId, channelId: scope.channelId,
      campaignId: binding.campaignId, enabled: true },
      include: { campaign: true, version: { include: { flow: true } } } });
    queries++;
    return stored;
  } } } as unknown as PrismaClient;
  assert.deepEqual(await resolveStoredCltCampaignTrigger(db, scope), { matched: true, executable: false });
  assert.equal(queries, 2);
});

test("absent or quarantined receipt and absent binding do not match", async () => {
  for (const value of [null, { ...reply, inboundMessage: { metaReplyConflictSnapshot: "conflict" } }, reply]) {
    const db = { chatbotReplyCorrelation: { findFirst: async () => value },
      cltChatbotCampaignBinding: { findFirst: async () => null } } as unknown as PrismaClient;
    assert.deepEqual(await resolveStoredCltCampaignTrigger(db, scope), { matched: false, executable: false });
  }
});
