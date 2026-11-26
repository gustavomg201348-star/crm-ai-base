import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/qevora_chatbot_test");
assert(!url.searchParams.has("host"));

async function main() {
  const { prisma: db } = await import("./db");
  const { createCltSessionRuntime } = await import("./chatbot-clt-session-runtime");
  const { configureCltCampaign, setCltCampaignEnabled } = await import("./chatbot-clt-admin-config");
  const { cltBlocksAiSend, requireCltHumanSend } = await import("./chatbot-clt-outbound-policy");
  const { assignConversationToUser, maybeAutoAssignConversation } = await import("./lead-assignment");
  const { createConversationAuthorityService } = await import("./conversation-authority.service");
  const { createOutboundOperationService } = await import("./outbound-operation.service");
  const { processCampaign } = await import("./campaigns");
  const webhook = await import("../app/api/webhooks/whatsapp/route");
  const reconcile = await import("../app/api/campaigns/clt-chatbot/reconcile/route");
  const { createSessionToken } = await import("./auth");
  const originalFetch = globalThis.fetch;
  const database = { db, provider: "postgresql" as const };
  const secret = "synthetic-clt-webhook-secret";
  const requests: Array<{ phoneId: string; id: string; payload: { type: string; to: string; text?: { body: string };
    interactive?: { action: { buttons: { reply: { id: string; title: string } }[] } } } }> = [];
  let transportBarrier: (() => Promise<void>) | undefined;
  let uncertain = false;
  process.env.CAMPAIGN_DISPATCH_INTERVAL_SECONDS = "0";
  globalThis.fetch = async (input, init) => {
    const target = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    assert.equal(target.origin, "https://graph.facebook.com");
    assert.match(target.pathname, /^\/v[\d.]+\/clt-synthetic-[a-f0-9-]+\/messages$/);
    assert.equal(init?.method, "POST");
    const payload = JSON.parse(String(init?.body));
    const id = "wamid.synthetic." + randomUUID();
    requests.push({ phoneId: target.pathname.split("/")[2], id, payload });
    await transportBarrier?.();
    if (uncertain) throw new Error("Simulated timeout");
    return Response.json({ messages: [{ id }] });
  };
  after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

  async function fixture(title: "Conferir" | "Verificar" = "Conferir", options: { disabled?: boolean; realCampaign?: boolean } = {}) {
    const company = await db.company.create({ data: { name: "Synthetic CLT company", aiMode: "OFF" } });
    const user = await db.user.create({ data: { name: "Synthetic admin", email: randomUUID() + "@invalid.test",
      companyId: company.id, passwordHash: "synthetic-password", role: "ADMIN" } });
    const agent = await db.user.create({ data: { name: "Synthetic attendant", email: randomUUID() + "@invalid.test",
      companyId: company.id, passwordHash: "synthetic-password", role: "AGENT" } });
    const phone = "5547999999999";
    const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone, normalizedPhone: phone } });
    const channel = await db.channel.create({ data: { companyId: company.id, provider: "meta", type: "whatsapp",
      status: "ACTIVE", name: "Synthetic", appSecret: secret, accessToken: "synthetic-meta-token",
      phoneNumberId: "clt-synthetic-" + randomUUID(), wabaId: randomUUID() } });
    const campaign = await db.campaign.create({ data: { companyId: company.id, channelId: channel.id, createdById: user.id,
      name: "Synthetic CLT campaign", message: "Synthetic", messageType: "TEMPLATE", templateName: "synthetic_clt",
      templateLanguage: "pt_BR", total: 1 } });
    await db.metaTemplate.create({ data: { companyId: company.id, wabaId: channel.wabaId!, name: campaign.templateName!,
      language: campaign.templateLanguage!, metaStatus: "APPROVED", operationalStatus: "READY",
      components: JSON.stringify([{ type: "BODY", text: "Synthetic" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: title }] }]) } });
    const admin = { companyId: company.id, actorUserId: user.id, campaignId: campaign.id };
    const configured = await configureCltCampaign(db, { ...admin, buttonTitle: title });
    assert.equal(configured.enabled, false);
    const setEnabled = (enabled: boolean) => setCltCampaignEnabled(database, { ...admin, enabled });
    if (!options.disabled) await setEnabled(true);

    let recipient = await db.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id, phone } });
    if (options.realCampaign) {
      if (options.disabled) await processCampaign(campaign.id);
      else await Promise.all([processCampaign(campaign.id), processCampaign(campaign.id)]);
      recipient = await db.campaignRecipient.findUniqueOrThrow({ where: { id: recipient.id } });
      assert.equal(recipient.status, "SENT", recipient.errorMessage ?? "campaign must be sent");
      assert(recipient.providerMessageId);
    } else {
      const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id } });
      const providerMessageId = "wamid.synthetic.source." + randomUUID();
      await db.message.create({ data: { conversationId: conversation.id, direction: "outbound", type: "template",
        body: "Synthetic template", providerMessageId, templateName: campaign.templateName, templateLanguage: campaign.templateLanguage } });
      recipient = await db.campaignRecipient.update({ where: { id: recipient.id },
        data: { conversationId: conversation.id, providerMessageId, status: "SENT", sentAt: new Date() } });
    }
    const scope = { companyId: company.id, channelId: channel.id, conversationId: recipient.conversationId! };
    const dto = () => db.chatbotSession.findFirst({ where: scope });
    const owner = () => db.conversationAuthority.findFirst({ where: scope });
    const thread = () => db.conversation.findUniqueOrThrow({ where: { id: scope.conversationId } });
    const sent = () => requests.filter(row => row.phoneId === channel.phoneNumberId);
    const send = async (input: Record<string, unknown>, expected = 200, sign = true, via = channel.phoneNumberId) => {
      const raw = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages",
        value: { metadata: { phone_number_id: via }, messages: [{ id: "wamid.in." + randomUUID(), from: phone,
          timestamp: String(Math.floor(Date.now() / 1000)), ...input }] } }] }] });
      const signature = sign ? "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") : "sha256=invalid";
      const result = await webhook.POST(new NextRequest("https://synthetic.invalid/api/webhooks/whatsapp", {
        method: "POST", body: raw, headers: { "Content-Type": "application/json", "x-hub-signature-256": signature }
      }));
      assert.equal(result.status, expected, await result.text());
    };
    const start = (overrides: Record<string, unknown> = {}, expected = 200, sign = true) => send({
      type: "button", context: { id: recipient.providerMessageId }, button: { payload: title.toUpperCase(), text: title }, ...overrides
    }, expected, sign);
    const option = (id: string, context = sent().at(-1)?.id, timestamp?: string) => send({ type: "interactive",
      context: { id: context }, interactive: { type: "button_reply", button_reply: { id, title: id } },
      ...(timestamp ? { timestamp } : {}) });
    const text = (body: string, timestamp?: string) => send({ type: "text", text: { body }, ...(timestamp ? { timestamp } : {}) });
    const drain = async (times = 2) => {
      // Construct a fresh runtime to prove the queue and session survive restart.
      const worker = createCltSessionRuntime(database);
      const errors: unknown[] = [];
      for (let i = 0; i < times; i++) await worker.drain(error => errors.push(error));
      if (errors.length) throw errors[0];
    };
    return { company, user, agent, contact, channel, campaign, recipient, scope, dto, owner, thread, sent, start, option, text, drain, setEnabled };
  }

  test("real campaign path sends once, starts unassigned, and a signed Conferir leads to agent with competitor offer", async () => {
    const f = await fixture("Conferir", { realCampaign: true });
    assert.equal(f.sent().length, 1);
    assert.equal((await f.thread()).agentId, null);
    await f.start({}, 403, false);
    assert.equal(await f.dto(), null);
    const duplicate = { id: "wamid.synthetic.duplicate." + randomUUID() };
    await Promise.all([f.start(duplicate), f.start(duplicate)]);
    assert.equal((await f.owner())?.state, "CHATBOT");
    await f.drain(1);
    await Promise.all([f.drain(1), f.drain(1)]);
    assert.deepEqual(f.sent().at(-1)?.payload.interactive?.action.buttons.map(button => button.reply.title),
      ["Já recebi", "Ainda não recebi", "Falar com atendente"]);
    assert.equal(f.sent().length, 2);
    await f.option("clt_received");
    await f.drain();
    await f.text("R$ 3.000 em 12 parcelas de R$ 290");
    await f.drain();
    assert.equal(JSON.parse((await f.dto())!.runtimeState!).variables.competitor_offer, "R$ 3.000 em 12 parcelas de R$ 290");
    assert.match(f.sent().at(-1)?.payload.text?.body ?? "", /nossa equipe.*😊/);
    assert.equal((await f.dto())?.closureReason, "HUMAN_HANDOFF");
    assert.equal((await f.owner())?.state, "HUMAN_QUEUE");
    assert.equal((await f.thread()).status, "PENDING");
    assert.equal((await f.thread()).aiPaused, true);
    await f.start();
    await f.drain();
    assert.equal(f.sent().length, 4);
  });

  for (const [optionId, title] of [["clt_priority_amount", "Maior valor"], ["clt_priority_installment", "Menor parcela"],
    ["clt_priority_term", "Menor prazo"]]) {
    test("Verificar, no-memory answer and priority " + title, async () => {
      const f = await fixture("Verificar");
      await f.start(); await f.drain();
      const original = f.sent().at(-1)!.id;
      await f.option("clt_received"); await f.drain();
      await f.text("Não me lembro.");
      await f.drain();
      assert.deepEqual(f.sent().at(-1)?.payload.interactive?.action.buttons.map(button => button.reply.title),
        ["Maior valor", "Menor parcela", "Menor prazo"]);
      await f.option(optionId, original); // An old context cannot advance the new prompt.
      await f.drain();
      assert.equal((await f.dto())?.currentStepId, "priority");
      await f.option(optionId); await f.drain();
      assert.equal(JSON.parse((await f.dto())!.runtimeState!).variables.priority, title);
      assert.equal((await f.owner())?.state, "HUMAN_QUEUE");
    });
  }

  for (const outcome of ["amount", "max", "human-first", "human-second"] as const) {
    test("commercial branch " + outcome, async () => {
      const f = await fixture();
      await f.start(); await f.drain();
      if (outcome === "human-first") {
        await f.option("clt_human"); await f.drain();
      } else {
        await f.option("clt_not_received"); await f.drain();
        await f.option(outcome === "amount" ? "clt_specific_amount" : outcome === "max" ? "clt_max_amount" : "clt_human_need");
        await f.drain();
        if (outcome === "amount") {
          await f.text("R$ 4000", String(Math.floor(Date.now() / 1000) - 60)); await f.drain();
          assert.equal((await f.dto())?.currentStepId, "amount");
          await f.text("R$ 5000"); await f.drain();
          assert.equal(JSON.parse((await f.dto())!.runtimeState!).variables.desired_amount, "R$ 5000");
        }
      }
      assert.equal((await f.owner())?.state, "HUMAN_QUEUE");
      assert.match(f.sent().at(-1)?.payload.text?.body ?? "", /direcionar seu atendimento/);
    });
  }

  test("campaign with disabled CLT binding follows the legacy sender", async () => {
    const f = await fixture("Conferir", { disabled: true, realCampaign: true });
    assert.equal((await f.thread()).agentId, f.user.id);
    assert.equal(await f.owner(), null);
    assert.equal(f.sent().length, 1);
  });

  test("disabled binding, old click, cross-tenant source and admin boundary", async () => {
    const disabled = await fixture("Conferir", { disabled: true });
    const active = await fixture();
    await disabled.start(); await disabled.drain();
    assert.equal(await disabled.dto(), null);
    await active.start({ timestamp: String(Math.floor(Date.now() / 1000) - 600) });
    await active.start({ context: { id: disabled.recipient.providerMessageId } });
    await active.drain();
    assert.equal(await active.dto(), null);
    assert.equal(active.sent().length, 0);
    await assert.rejects(setCltCampaignEnabled(database, { companyId: disabled.company.id, actorUserId: disabled.user.id,
      campaignId: active.campaign.id, enabled: false }), /BINDING_NOT_FOUND/);
    await assert.rejects(setCltCampaignEnabled(database, { companyId: active.company.id, actorUserId: active.agent.id,
      campaignId: active.campaign.id, enabled: false }), /FORBIDDEN/);
  });

  test("pause cancels pending jobs before network dispatch and hands off", async () => {
    const f = await fixture();
    await f.start(); await f.drain(1);
    await f.setEnabled(false);
    await f.drain();
    assert.equal(f.sent().length, 0);
    assert.equal((await f.owner())?.state, "HUMAN_QUEUE");
    const operation = await db.outboundOperation.findFirstOrThrow({ where: { ...f.scope, origin: "CHATBOT" } });
    assert.equal(operation.status, "CANCELED");
  });

  test("takeover during provider call changes authority and fences human, AI, round robin and AutoStart", async () => {
    const f = await fixture();
    await f.start(); await f.drain(1);
    await db.leadAssignmentSetting.create({ data: { companyId: f.company.id, mode: "ROUND_ROBIN" } });
    assert.equal(await maybeAutoAssignConversation(f.scope), null);
    assert.equal(await cltBlocksAiSend(db, f.scope), true);
    await assert.rejects(requireCltHumanSend(db, f.scope, f.agent.id), /Atendimento CLT/);
    const authority = (await f.owner())!;
    const operations = createOutboundOperationService(database);
    await assert.rejects(operations.prepare({ ...f.scope, origin: "CAMPAIGN", actorUserId: f.user.id,
      expectedGeneration: authority.generation, logicalKey: randomUUID(), payload: {} }), /AUTHORITY_DENIED/);
    await assert.rejects(operations.prepare({ ...f.scope, origin: "AI", expectedGeneration: authority.generation,
      logicalKey: randomUUID(), payload: {} }), /AUTHORITY_DENIED/);
    let entered!: () => void;
    let free!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { free = resolve; });
    transportBarrier = () => { entered(); return held; };
    const send = f.drain(1);
    try {
      await Promise.race([waiting, send.then(() => { throw new Error("dispatch was never reached"); })]);
      await assignConversationToUser({ ...f.scope, assignedToUserId: f.agent.id, assignedByUserId: f.agent.id });
      assert.equal((await f.owner())?.state, "HUMAN");
      assert.equal((await f.dto())?.status, "CLOSED");
      await assert.rejects(requireCltHumanSend(db, f.scope, f.agent.id), /Atendimento CLT/);
    } finally {
      free();
      transportBarrier = undefined;
      await send;
    }
    await requireCltHumanSend(db, f.scope, f.agent.id);
    await f.text("Depois da transferência");
    await f.drain();
    assert.equal(f.sent().length, 1);
  });

  test("existing AI authority prevents admission", async () => {
    const f = await fixture();
    const service = createConversationAuthorityService(database);
    const command = { ...f.scope, actorUserId: f.user.id, reason: "CLT_TEST", logicalKey: randomUUID() };
    await service.initialize({ ...command, state: "HUMAN_QUEUE" });
    await service.transition({ ...command, logicalKey: randomUUID(), state: "AI", expectedGeneration: BigInt(0) });
    await f.start(); await f.drain();
    assert.equal(await f.dto(), null);
    assert.equal((await f.owner())?.state, "AI");
    assert.equal(f.sent().length, 0);
  });

  test("ambiguous transport releases the queue, reconciles with audit and never resends", async () => {
    const f = await fixture();
    await f.start(); await f.drain(1);
    uncertain = true;
    try { await f.drain(); } finally { uncertain = false; }
    await f.drain();
    assert.equal(f.sent().length, 1);
    assert.equal((await f.owner())?.state, "HUMAN_QUEUE");
    const operation = await db.outboundOperation.findFirstOrThrow({ where: { ...f.scope, origin: "CHATBOT" } });
    assert.equal(operation.status, "UNKNOWN");
    const cookie = "crm_session=" + createSessionToken({ id: f.user.id, companyId: f.company.id, name: f.user.name,
      email: f.user.email, role: "ADMIN" }, f.user.passwordHash);
    const base = "https://synthetic.invalid/api/campaigns/clt-chatbot/reconcile";
    const listed = await reconcile.GET(new NextRequest(base + "?campaignId=" + f.campaign.id, { headers: { cookie } }));
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).operations.map((row: { id: string }) => row.id), [operation.id]);
    const settle = () => reconcile.POST(new NextRequest(base, { method: "POST", headers: { cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ campaignId: f.campaign.id, operationId: operation.id, resolution: "FAILED",
        executorTerminated: true, logicalKey: "audit-result", evidenceReference: "SYNTHETIC_EVIDENCE" }) }));
    const first = await settle();
    assert.equal(first.status, 200);
    assert.deepEqual(await (await settle()).json(), await first.json());
    assert.equal((await db.outboundOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, "FAILED");
    await f.drain();
    assert.equal(f.sent().length, 1);
  });
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
