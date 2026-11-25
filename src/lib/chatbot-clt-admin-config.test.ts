import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { configureCltCampaign, resolveCltTriggerOption } from "./chatbot-clt-admin-config";

const components = [{ type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Conferir" }] }];
test("only the exact quick-reply trigger is accepted", () => {
  assert.equal(resolveCltTriggerOption(components, "Conferir"), "CONFERIR");
  assert.throws(() => resolveCltTriggerOption(components, "Verificar"), /INVALID_TRIGGER/);
  assert.throws(() => resolveCltTriggerOption([{ type: "BUTTONS", buttons: [{ type: "URL", text: "Conferir" }] }], "Conferir"), /INVALID_TRIGGER/);
  assert.throws(() => resolveCltTriggerOption([{ type: "BUTTONS", buttons: [...components[0].buttons, ...components[0].buttons] }], "Conferir"), /INVALID_TRIGGER/);
});
const input = { companyId: "company", actorUserId: "admin", campaignId: "campaign", buttonTitle: "Conferir" };
test("configuration rejects unauthorized actor before campaign lookup", async () => {
  const db = { $transaction: async (fn: (tx: unknown) => unknown) => fn({
    user: { findFirst: async () => null }
  }) } as unknown as PrismaClient;
  await assert.rejects(configureCltCampaign(db, input), /FORBIDDEN/);
});
test("configuration rejects cross-company channel", async () => {
  const db = { $transaction: async (fn: (tx: unknown) => unknown) => fn({
    user: { findFirst: async () => ({ id: "admin" }) },
    campaign: { findFirst: async () => ({ channel: { companyId: "other" } }) }
  }) } as unknown as PrismaClient;
  await assert.rejects(configureCltCampaign(db, input), /INVALID_CAMPAIGN/);
});
test("new configuration persists a published version but disabled binding", async () => {
  const writes: string[] = [];
  const db = { $transaction: async (fn: (tx: unknown) => unknown) => fn({
    user: { findFirst: async () => ({ id: "admin" }) },
    campaign: { findFirst: async () => ({ channelId: "channel", templateName: "clt", templateLanguage: "pt_BR",
      channel: { companyId: "company", wabaId: "waba", type: "whatsapp", provider: "meta", status: "ACTIVE" } }) },
    metaTemplate: { findFirst: async () => ({ components: JSON.stringify(components) }) },
    chatbotFlow: { create: async () => { writes.push("flow"); return { id: "flow" }; },
      update: async () => { writes.push("publish"); } },
    chatbotFlowVersion: { create: async () => { writes.push("version"); return { id: "version" }; } },
    cltChatbotCampaignBinding: { findUnique: async () => null, create: async ({ data }: { data: unknown }) => { writes.push("binding"); return data; } }
  }) } as unknown as PrismaClient;
  const result = await configureCltCampaign(db, input);
  assert.equal(result.enabled, false);
  assert.equal(result.optionId, "CONFERIR");
  assert.deepEqual(writes, ["flow", "version", "publish", "binding"]);
});
