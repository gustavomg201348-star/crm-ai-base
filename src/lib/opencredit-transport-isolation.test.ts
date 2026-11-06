import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { after, before, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";

const companyId = "test-company";
const internal = { id: "internal-channel", companyId, type: "OPEN_CREDIT", provider: "internal", name: "OpenCredit", appSecret: null };
const meta = { id: "meta-channel", companyId, type: "whatsapp", provider: "meta", name: "WhatsApp", appSecret: null };
const session = { id: "admin", companyId, role: "ADMIN", name: "Test", email: "admin@example.invalid" };
const effects: string[] = [];
const messageSendIdentifiers: (readonly string[])[] = [];
let messageSendLimit: Response | null = null;
function forbiddenEffect(name: string) {
  return () => { effects.push(name); throw new Error("UNEXPECTED_EFFECT"); };
}
const markers = [
  { channel: "OPEN_CREDIT", channelId: internal.id, channelRef: internal },
  { channel: "OPEN_CREDIT", channelId: meta.id, channelRef: meta },
  { channel: "whatsapp", channelId: internal.id, channelRef: internal },
  { channel: "OPEN_CREDIT", channelId: null, channelRef: null },
];
const baseConversation = { id: "conversation", agentId: null, aiMode: "AUTO", aiPaused: false, contact: { id: "contact", companyId, phone: "5511987654321" } };
let conversation = { ...baseConversation, ...markers[0] };
let campaignChannel: typeof meta | null = null;
let observedSimulation: string | null = null;
let switchToInternalOnRead = 0;
let conversationReads = 0;

function channelMatches(channel: typeof meta, where: { id?: string; companyId?: string; type?: string | { not: string }; provider?: string | { not: string } }) {
  return (!where.id || where.id === channel.id) && (!where.companyId || where.companyId === channel.companyId)
    && (typeof where.type === "string" ? channel.type === where.type : channel.type !== where.type?.not)
    && (typeof where.provider === "string" ? channel.provider === where.provider : channel.provider !== where.provider?.not);
}

const db = {
  conversation: {
    findFirst: async () => ++conversationReads === switchToInternalOnRead ? { ...baseConversation, ...markers[0] } : conversation,
    update: forbiddenEffect("conversation.update"),
  },
  company: { findUnique: async () => ({ id: companyId, aiMode: "AUTO" }) },
  channel: {
    findFirst: async ({ where }: { where: Parameters<typeof channelMatches>[1] }) => [internal, meta].find(channel => channelMatches(channel, where)) ?? null,
    findMany: async ({ where }: { where: Parameters<typeof channelMatches>[1] }) => [internal, meta].filter(channel => channelMatches(channel, where)),
    create: forbiddenEffect("channel.create"),
    update: forbiddenEffect("channel.update"),
  },
  campaign: { findUnique: async () => ({ id: "campaign", companyId, channel: campaignChannel ?? internal, recipients: [] }), update: forbiddenEffect("campaign.update") },
  proposal: { findMany: forbiddenEffect("proposal.findMany") },
  message: { findFirst: async () => ({ mediaId: "synthetic-media", conversation }), create: forbiddenEffect("message.create") },
  activity: { create: forbiddenEffect("activity.create") },
  $transaction: forbiddenEffect("transaction"),
};

type Route = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const routes: Record<string, Route> = {};
let integration: typeof import("./conversation-message.service");
let ai: typeof import("./ai-attendant.service");
let context: typeof import("./ai-response-context");
let campaign: typeof import("./campaigns");
let template: typeof import("./whatsapp-template.service");
let media: typeof import("./whatsapp-media.service");
let webhook: typeof import("./webhook-channel-secrets");
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async () => forbiddenEffect("external HTTP")();
  const loader = Module as typeof Module & { _load(s: string, ...args: unknown[]): unknown };
  const original = loader._load;
  const require = createRequire(import.meta.url);
  const blockedExports: Record<string, string[]> = {
    "@/lib/meta-whatsapp": ["sendMetaTextMessage", "sendMetaMediaMessage", "sendMetaTemplateMessage", "uploadMetaMedia"],
    "@/lib/meta-whatsapp-diagnostics": ["subscribeMetaWebhook"],
    "@/lib/meta-template-sync": ["syncMetaTemplatesForWaba"],
    "@/lib/authority-text-shadow-runtime": ["observeTextOutboundAuthority"],
    "@/lib/message-delivery": ["saveFailedOutboundMessage"],
    "@/lib/channel-secrets": ["resolveChannelAccessToken"],
    "@/lib/outbound-message-reply": ["resolveOutboundReplyContext"],
  };
  loader._load = (name, ...args) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db") return { prisma: db };
    if (name === "@/lib/auth") return { getSessionFromRequest: async () => session };
    if (name === "@/lib/inbound-message") return {
      processInboundMessage: async ({ channelId }: { channelId: string }) => { observedSimulation = channelId; return { id: "simulated" }; },
    };
    if (name === "@/lib/rate-limit") return {
      enforceRateLimits: async (rules: Parameters<typeof import("./rate-limit").enforceRateLimits>[0]) => {
        const messageSend = rules.find(rule => rule.category === "message-send");
        if (!messageSend) return null;
        messageSendIdentifiers.push(messageSend.identifiers);
        return messageSendLimit;
      },
      rateLimitPolicies: {},
      prismaRateLimitStore: {},
    };
    const originalExports = original.call(loader, name, ...args);
    if (!blockedExports[name]) return originalExports;
    return { ...originalExports as object, ...Object.fromEntries(blockedExports[name].map(key => [key, forbiddenEffect(key)])) };
  };
  try {
    integration = require("./conversation-message.service");
    ai = require("./ai-attendant.service");
    context = require("./ai-response-context");
    campaign = require("./campaigns");
    template = require("./whatsapp-template.service");
    media = require("./whatsapp-media.service");
    webhook = require("./webhook-channel-secrets");
    const entries = {
      text: ["conversations/[id]/messages", "POST"],
      direct: ["channels/[id]/messages", "POST"],
      outboundMedia: ["conversations/[id]/messages/media", "POST"],
      template: ["conversations/[id]/messages/template", "POST"],
      download: ["messages/[id]/media", "GET"],
      ai: ["conversations/[id]/ai", "POST"],
      aiMode: ["conversations/[id]/ai-mode", "PATCH"],
      list: ["channels", "GET"],
      create: ["channels", "POST"],
      patch: ["channels/[id]", "PATCH"],
      simulate: ["channels/simulate", "POST"],
      subscribe: ["channels/[id]/subscribe-webhook", "POST"],
      templateSync: ["channels/[id]/templates/sync", "POST"],
      channelTemplate: ["channels/[id]/templates", "POST"],
      validateMeta: ["channels/meta/validate", "POST"],
    };
    for (const [key, [path, method]] of Object.entries(entries)) routes[key] = require("../app/api/" + path + "/route")[method];
  } finally { loader._load = original; }
});

beforeEach(() => {
  effects.length = 0;
  messageSendIdentifiers.length = 0;
  messageSendLimit = null;
  campaignChannel = null;
  observedSimulation = null;
  switchToInternalOnRead = 0;
  conversationReads = 0;
  conversation = { ...baseConversation, ...markers[0] };
});
after(() => { globalThis.fetch = realFetch; });

function request(method = "POST", body?: object) {
  return new NextRequest("https://crm.example.invalid/", {
    method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

const params = (id = baseConversation.id) => ({ params: Promise.resolve({ id }) });

markers.forEach((marker, index) => {
  test("all conversation transport rejects OpenCredit marker combination " + index, async () => {
    conversation = { ...baseConversation, ...marker };
    const responses = await Promise.all([
      routes.text(request("POST", { body: "outbound" }), params()),
      routes.text(request("POST", { body: "inbound", direction: "inbound" }), params()),
      routes.outboundMedia(request(), params()),
      routes.template(request("POST", { templateName: "sample", language: "pt_BR" }), params()),
      routes.download(request("GET"), params()),
      routes.direct(request("POST", { conversationId: conversation.id, to: conversation.contact.phone, body: "test" }), params(meta.id)),
      routes.ai(request("POST", {}), params()),
      routes.aiMode(request("PATCH", { mode: "AUTO" }), params()),
    ]);
    assert.deepEqual(responses.map(response => response.status), Array(8).fill(403));
    assert.deepEqual(messageSendIdentifiers, []);
    const input = { conversationId: conversation.id, companyId };
    await assert.rejects(() => integration.getConversationIntegration(input), /OPENCREDIT_TRANSPORT_BLOCKED/);
    await assert.rejects(() => context.buildAiResponseContext({ ...input, replyToMessageId: null }), /OPENCREDIT_TRANSPORT_BLOCKED/);
    await assert.rejects(() => ai.generateAiSuggestion(input), /OPENCREDIT_TRANSPORT_BLOCKED/);
    assert.equal(await ai.maybeSendAutomaticAiReply(input), null);
    assert.deepEqual(effects, []);
  });
});

for (const conversationId of [baseConversation.id, undefined]) {
  test(`direct Meta text uses message-send ${conversationId ? "with" : "without"} a conversation`, async () => {
    conversation = { ...baseConversation, channel: "whatsapp", channelId: meta.id, channelRef: meta };
    messageSendLimit = new Response(null, { status: 429, headers: { "Retry-After": "10" } });

    const response = await routes.direct(
      request("POST", { conversationId, to: conversation.contact.phone, body: "test" }),
      params(meta.id)
    );

    assert.equal(response, messageSendLimit);
    assert.equal(response.status, 429);
    assert.deepEqual(messageSendIdentifiers, [[companyId, session.id]]);
    assert.deepEqual(effects, []);
  });
}

test("outbound media and template services independently stop before upload and template lookup", async () => {
  const input = { conversationId: conversation.id, companyId, userId: session.id };
  await assert.rejects(() => media.sendConversationMedia({
    ...input, fileName: "sample.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.7"),
  }), /OPENCREDIT_TRANSPORT_BLOCKED/);
  await assert.rejects(() => template.sendConversationTemplate({
    ...input, templateName: "sample", language: "pt_BR", variables: [],
  }), /OPENCREDIT_TRANSPORT_BLOCKED/);
  assert.deepEqual(effects, []);
});

test("a late internal-channel rejection does not create failed media or template messages", async () => {
  conversation = { ...baseConversation, channel: "whatsapp", channelId: meta.id, channelRef: meta };
  switchToInternalOnRead = 3;
  const form = new FormData();
  form.set("file", new File(["%PDF-1.7"], "sample.pdf", { type: "application/pdf" }));
  const mediaRequest = new NextRequest("https://crm.example.invalid/", { method: "POST", body: form });
  assert.equal((await routes.outboundMedia(mediaRequest, params())).status, 403);
  conversationReads = 0;
  switchToInternalOnRead = 2;
  assert.equal((await routes.template(request("POST", { templateName: "sample", language: "pt_BR" }), params())).status, 403);
  assert.deepEqual(effects, []);
});

test("channel admin omits internal rows and rejects manual create or mutation", async () => {
  const list = await routes.list(request("GET"), params());
  assert.equal(list.status, 200);
  assert.deepEqual((await list.json()).channels.map((channel: { id: string }) => channel.id), [meta.id]);
  for (const input of [{ type: "OPEN_CREDIT" }, { provider: "internal" }]) {
    assert.equal((await routes.create(request("POST", { name: "manual", ...input }), params())).status, 400);
    assert.equal((await routes.patch(request("PATCH", input), params(meta.id))).status, 400);
  }
  assert.equal((await routes.patch(request("PATCH", { name: "manual" }), params(internal.id))).status, 403);
  assert.deepEqual(effects, []);
});

test("simulation, webhook subscription and channel template boundaries reject internal channels", async () => {
  assert.equal((await routes.simulate(request("POST", { channelId: internal.id, phone: "5511987654321", message: "sample" }), params())).status, 404);
  assert.equal(observedSimulation, null);
  assert.equal((await routes.subscribe(request(), params(internal.id))).status, 404);
  assert.equal((await routes.templateSync(request(), params(internal.id))).status, 400);
  assert.equal((await routes.channelTemplate(request(), params(internal.id))).status, 404);
  const diagnostics = await routes.validateMeta(request("POST", { channelId: internal.id }), params());
  assert.equal((await diagnostics.json()).diagnostics.ok, false);
  const result = await webhook.resolveVerifiedMetaWebhookChannel({
    db: db as unknown as Parameters<typeof webhook.resolveVerifiedMetaWebhookChannel>[0]["db"],
    phoneNumberId: internal.id, rawBody: "{}", signature: "synthetic",
  });
  assert.equal(result.ok, false);
  assert.deepEqual(effects, []);
});

test("simulation with an eligible Meta channel still reaches the inbound handler", async () => {
  const response = await routes.simulate(request("POST", { channelId: meta.id, phone: "5511987654321", message: "sample" }), params());
  assert.equal(response.status, 201);
  assert.equal(observedSimulation, meta.id);
  assert.deepEqual(effects, []);
});

test("campaign dispatch rejects internal, wrong-type and cross-company Meta channels before side effects", async () => {
  for (const channel of [internal, { ...meta, type: "OPEN_CREDIT" }, { ...meta, companyId: "other-company" }]) {
    campaignChannel = channel;
    await assert.rejects(() => campaign.processCampaign("campaign"), /Disparo real exige canal WhatsApp Meta/);
  }
  assert.deepEqual(effects, []);
});
