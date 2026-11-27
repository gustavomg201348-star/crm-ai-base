import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { NextRequest } from "next/server";
import { assertOpenCreditCommercialOperationTestDatabase } from "./opencredit-commercial-operation-postgres.guard";
assertOpenCreditCommercialOperationTestDatabase(process.env);
async function main() {
  const { prisma: db } = await import("./db");
  const { campaignAnalytics } = await import("./campaign-analytics.service");
  const { analyticsFilters } = await import("./campaign-analytics-policy");
  const security = await import("./meta-inbound-provenance");
  const { persistInboundMessage } = await import("./meta-reply-ingestion");
  await import("./inbound-message");
  const webhook = await import("../app/api/webhooks/whatsapp/route");
  const route = await import("../app/api/campaigns/analytics/route");
  const exporter = await import("../app/api/campaigns/analytics/export/route");
  const { hashPassword, createSessionToken } = await import("./auth");
  const { classifyPhoneNormalization } = await import(
    "./phone-normalization.service"
  );
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls++;
    throw Error("EXTERNAL_TRANSPORT_FORBIDDEN");
  };
  after(async () => {
    globalThis.fetch = originalFetch;
    await db.$disconnect();
  });
  const secret = "stage06-synthetic-webhook-secret",
    passwordHash = hashPassword("stage06-synthetic-password");
  let sequence = 100;
  const filters = (extra: Record<string, string> = {}) =>
    analyticsFilters(new URLSearchParams({ period: "7d", ...extra }));
  async function fixture() {
    const company = await db.company.create({
      data: {
        name: "Analytics synthetic",
        aiMode: "OFF",
        cltChatbotEnabled: false,
        cltCheckAutoReplyEnabled: false,
      },
    });
    const user = await db.user.create({
      data: {
        companyId: company.id,
        name: "Synthetic admin",
        email: randomUUID() + "@invalid.test",
        passwordHash,
        role: "ADMIN",
      },
    });
    const channel = await db.channel.create({
      data: {
        companyId: company.id,
        name: "Canal sintético",
        provider: "meta",
        type: "whatsapp",
        status: "ACTIVE",
        appSecret: secret,
        phoneNumberId: randomUUID(),
      },
    });
    const campaign = await db.campaign.create({
      data: {
        companyId: company.id,
        channelId: channel.id,
        name: "Campanha sintética",
        message: "Template sintético",
        messageType: "TEMPLATE",
        templateName: "oferta_synthetic",
        status: "PAUSED",
      },
    });
    return { company, user, channel, campaign };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function recipient(
    f: Fixture,
    status = "SENT",
    existing?: { id: string; phone: string },
    channel = f.channel,
    campaign = f.campaign,
  ) {
    const phone = "55119" + String(sequence++).padStart(8, "0");
    const contact =
      existing ??
      (await db.contact.create({
        data: {
          companyId: f.company.id,
          name: "Cliente sintético " + sequence,
          phone,
          normalizedPhone: classifyPhoneNormalization(phone).normalizedPhone,
        },
      }));
    const conversation =
      (await db.conversation.findFirst({
        where: { contactId: contact.id, channelId: channel.id },
      })) ??
      (await db.conversation.create({
        data: {
          contactId: contact.id,
          channelId: channel.id,
          status: "PENDING",
        },
      }));
    const providerId = "wamid.synthetic." + randomUUID(),
      at = new Date(Date.now() - 60000);
    const r = await db.campaignRecipient.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        conversationId: conversation.id,
        phone: contact.phone,
        status,
        providerMessageId:
          status === "PENDING" || status === "FAILED" ? null : providerId,
        sentAt: status === "PENDING" || status === "FAILED" ? null : at,
        deliveredAt: status === "DELIVERED" ? at : null,
        failedAt: status === "FAILED" ? at : null,
        createdAt: at,
      },
    });
    let source = null;
    if (r.providerMessageId)
      source = await db.message.create({
        data: {
          conversationId: conversation.id,
          direction: "outbound",
          senderType: "agent",
          type: "template",
          body: "Synthetic template",
          templateName: campaign.templateName,
          templateVariables: JSON.stringify({
            buttons: [
              "Conferir",
              "Verificar",
              "Quero simular",
              "Tenho interesse",
              "Falar com atendente",
              "Outra opção",
            ]
              .map((text) => ({ type: "QUICK_REPLY", text }))
              .concat([{ type: "URL", text: "Visitar site" }]),
          }),
          providerMessageId: providerId,
          status: status === "DELIVERED" ? "delivered" : "sent",
          createdAt: at,
        },
      });
    return { r, contact, conversation, source, providerId, channel, campaign };
  }
  type Recipient = Awaited<ReturnType<typeof recipient>>;
  function raw(
    f: Fixture,
    r: Recipient,
    kind = "button",
    title = "Conferir",
    id = "wamid.inbound." + randomUUID(),
    context: string | null = r.providerId,
  ) {
    return JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: r.channel.phoneNumberId },
                messages: [
                  {
                    id,
                    from: r.contact.phone,
                    type: kind,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...(context ? { context: { id: context } } : {}),
                    ...(kind === "button"
                      ? { button: { text: title, payload: title } }
                      : { text: { body: title } }),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
  }
  const sign = (body: string) =>
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  async function reply(
    f: Fixture,
    r: Recipient,
    kind = "button",
    title = "Conferir",
    id?: string,
    context?: string | null,
  ) {
    const body = raw(
      f,
      r,
      kind,
      title,
      id,
      context === undefined ? r.providerId : context,
    );
    const [{ input, capability }] = await security.authenticateMetaInboundBatch(
      { db, rawBody: body, signature: sign(body) },
    );
    return persistInboundMessage(
      db,
      {
        conversationId: r.conversation.id,
        direction: "inbound",
        senderType: "customer",
        body: input.body.trim(),
        type: input.type ?? "text",
        providerMessageId: input.providerMessageId,
        replyToProviderMessageId: input.contextProviderMessageId ?? null,
      },
      {
        companyId: f.company.id,
        channelId: r.channel.id,
        contactId: r.contact.id,
        senderPhone: input.phone,
        contextProviderMessageId: input.contextProviderMessageId,
        metadata: input.replyMetadata,
      },
      f.company.id,
      capability,
    );
  }
  async function read(f: Fixture, extra: Record<string, string> = {}) {
    const value = await campaignAnalytics(
      db,
      f.company.id,
      filters(extra),
      "dashboard",
      "postgresql",
    );
    assert(value.metrics);
    return value;
  }
  async function official(r: Recipient, status = "read") {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: r.channel.phoneNumberId },
                statuses: [
                  {
                    id: r.providerId,
                    status,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    recipient_id: r.contact.phone,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const response = await webhook.POST(
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": sign(body),
        },
      }),
    );
    assert.equal(response.status, 200);
  }
  test("01 sent and delivered without read remains official unread", async () => {
    const f = await fixture();
    await recipient(f, "DELIVERED");
    const a = await read(f);
    assert.equal(a.metrics.read, 0);
    assert.equal(a.metrics.delivered, 1);
    assert.equal(a.metrics.identifiedReads, 0);
  });
  test("02 official signed Meta read preserves Message.readAt semantics", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await official(r);
    const a = await read(f);
    assert.equal(a.metrics.read, 1);
    assert.equal(a.metrics.additionalReads, 0);
    assert.equal(a.metrics.identifiedReadRate, 100);
    assert(
      (await db.message.findUniqueOrThrow({ where: { id: r.source!.id } }))
        .readAt,
    );
  });
  for (const [index, title] of [
    [3, "Conferir"],
    [4, "Verificar"],
  ] as const)
    test(
      index + " click without read is additional evidence, never readAt",
      async () => {
        const f = await fixture(),
          r = await recipient(f);
        await reply(f, r, "button", title);
        const a = await read(f);
        assert.equal(a.metrics.read, 0);
        assert.equal(a.metrics.additionalReads, 1);
        assert.equal(a.metrics.identifiedReads, 1);
        assert.equal(a.metrics.interactionWithoutDelivery, 1);
        assert.equal(a.metrics.interactionRate, 100);
        assert.equal(
          (await db.message.findUniqueOrThrow({ where: { id: r.source!.id } }))
            .readAt,
          null,
        );
      },
    );
  test("05 explicitly quoted text is a response, not a button click", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r, "text", "Synthetic quoted response");
    const a = await read(f);
    assert.equal(a.metrics.textRespondents, 1);
    assert.equal(a.metrics.clickEvents, 0);
    assert.equal(a.metrics.identifiedReads, 1);
  });
  test("06 generic unquoted text remains unattributed", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r, "text", "Synthetic generic response", undefined, null);
    const a = await read(f);
    assert.equal(a.metrics.interactedRecipients, 0);
    assert.equal(a.unattributed?.unquotedText, 1);
  });
  test("07 late official read replaces additional evidence without increasing union", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r);
    const before = await read(f);
    await official(r);
    const after = await read(f);
    assert.equal(before.metrics.identifiedReads, after.metrics.identifiedReads);
    assert.equal(after.metrics.additionalReads, 0);
    assert.equal(after.metrics.read, 1);
  });
  test("08 multiple distinct button events retain one unique recipient", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r, "button", "Conferir");
    await reply(f, r, "button", "Verificar");
    await reply(f, r, "text", "Quoted response");
    const a = await read(f);
    assert.equal(a.metrics.clickEvents, 2);
    assert.equal(a.metrics.clicks, 1);
    assert.equal(a.metrics.textRespondents, 1);
    assert.equal(a.metrics.interactedRecipients, 1);
    assert.equal(a.buttons?.length, 2);
  });
  test("09 actual authenticated webhook replay is idempotent analytically", async () => {
    const f = await fixture(),
      r = await recipient(f);
    const body = raw(f, r);
    const req = () =>
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": sign(body),
        },
      });
    assert.equal((await webhook.POST(req())).status, 200);
    assert.equal((await webhook.POST(req())).status, 200);
    const a = await read(f);
    assert.equal(a.metrics.clickEvents, 1);
    assert.equal(a.metrics.identifiedReads, 1);
  });
  test("10 out of order delivery statuses do not erase official read analytics", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await official(r, "read");
    await official(r, "sent");
    const a = await read(f);
    assert.equal(a.metrics.read, 1);
    assert.equal(a.metrics.delivered, 1);
  });
  test("11 two campaigns for the same contact keep send and contact units separate", async () => {
    const f = await fixture(),
      r = await recipient(f);
    const campaign = await db.campaign.create({
      data: {
        companyId: f.company.id,
        channelId: f.channel.id,
        name: "Second",
        message: "Synthetic",
        messageType: "TEMPLATE",
        templateName: "oferta_synthetic",
        status: "PAUSED",
      },
    });
    const second = await recipient(f, "SENT", r.contact, f.channel, campaign);
    await reply(f, r);
    await reply(f, second);
    const a = await read(f);
    assert.equal(a.metrics.sent, 2);
    assert.equal(a.metrics.identifiedReads, 2);
    assert.equal(a.metrics.clicks, 1);
    assert.equal(a.metrics.interactionRate, 100);
    const selected = await read(f, { campaignId: campaign.id });
    assert.equal(selected.metrics.sent, 1);
  });
  test("12 replies on different channels never leak across channels", async () => {
    const f = await fixture(),
      r = await recipient(f);
    const channel = await db.channel.create({
      data: {
        companyId: f.company.id,
        name: "Alternate",
        type: "whatsapp",
        provider: "meta",
        status: "ACTIVE",
        appSecret: secret,
        phoneNumberId: randomUUID(),
      },
    });
    const campaign = await db.campaign.create({
      data: {
        companyId: f.company.id,
        channelId: channel.id,
        name: "Alternate",
        message: "Synthetic",
        messageType: "TEMPLATE",
        templateName: "oferta_synthetic",
        status: "PAUSED",
      },
    });
    const other = await recipient(f, "SENT", r.contact, channel, campaign);
    assert.notEqual(other.providerId, r.providerId);
    await reply(f, r);
    assert.equal(
      (await read(f, { channelId: channel.id })).metrics.clickEvents,
      0,
    );
    assert.equal(
      (await read(f, { channelId: f.channel.id })).metrics.clickEvents,
      1,
    );
  });
  test("13 replaced recipient provider ID never attributes the old send to a new attempt", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r);
    const next = "wamid.retry." + randomUUID();
    await db.message.create({
      data: {
        conversationId: r.conversation.id,
        direction: "outbound",
        type: "template",
        templateName: f.campaign.templateName,
        body: "Synthetic resend",
        providerMessageId: next,
      },
    });
    await db.campaignRecipient.update({
      where: { id: r.r.id },
      data: { providerMessageId: next },
    });
    assert.equal((await read(f)).metrics.identifiedReads, 0);
  });
  test("14 selected, pending and failed remain distinguishable from cumulative delivery", async () => {
    const f = await fixture();
    await recipient(f, "FAILED");
    await recipient(f, "PENDING");
    await recipient(f, "DELIVERED");
    const a = await read(f);
    assert.equal(a.metrics.selected, 3);
    assert.equal(a.metrics.pending, 1);
    assert.equal(a.metrics.failed, 1);
    assert.equal(a.metrics.sent, 1);
    assert.equal((await read(f, { status: "FAILED" })).logs?.length, 1);
  });
  test("15 zero eligible sends produce finite zero percentages", async () => {
    const f = await fixture();
    await recipient(f, "PENDING");
    const a = await read(f);
    for (const field of [
      "deliveryRate",
      "readRate",
      "identifiedReadRate",
      "interactionRate",
    ] as const)
      assert.equal(a.metrics[field], 0);
  });
  function request(f: Fixture, path: string, role = "ADMIN") {
    return new NextRequest("http://localhost" + path, {
      headers: {
        cookie:
          "crm_session=" +
          createSessionToken(
            { ...f.user, role: role as "ADMIN" },
            f.user.passwordHash,
          ),
      },
    });
  }
  test("16 API authorization, malicious identifiers and multi-tenant isolation", async () => {
    const f = await fixture(),
      foreign = await fixture();
    await recipient(foreign);
    assert.equal(
      (
        await route.GET(
          new NextRequest("http://localhost/api/campaigns/analytics"),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await route.GET(
          request(
            f,
            "/api/campaigns/analytics?campaignId=" + foreign.campaign.id,
          ),
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await route.GET(
          request(
            f,
            "/api/campaigns/analytics?channelId=" + foreign.channel.id,
          ),
        )
      ).status,
      404,
    );
    assert.equal(
      (await route.GET(request(f, "/api/campaigns/analytics?status=BAD")))
        .status,
      400,
    );
    const supervisor = await db.user.create({
      data: {
        companyId: f.company.id,
        name: "Supervisor",
        email: randomUUID() + "@invalid.test",
        role: "SUPERVISOR",
        passwordHash,
      },
    });
    const sup = { ...f, user: supervisor };
    assert.equal(
      (await route.GET(request(sup, "/api/campaigns/analytics", "SUPERVISOR")))
        .status,
      403,
    );
    assert.equal((await read(f)).metrics.selected, 0);
  });
  for (const [number, enabled, fixed] of [
    [17, true, false],
    [18, false, false],
    [19, false, true],
    [20, true, true],
  ] as const)
    test(
      number +
        " analytics is independent of chatbot/emergency/fixed-AI flags and has no side effects",
      async () => {
        const f = await fixture(),
          r = await recipient(f);
        await reply(f, r);
        await db.company.update({
          where: { id: f.company.id },
          data: { cltChatbotEnabled: enabled, cltCheckAutoReplyEnabled: fixed },
        });
        const before = {
          messages: await db.message.count({
            where: { conversationId: r.conversation.id },
          }),
          sessions: await db.chatbotSession.count({
            where: { companyId: f.company.id },
          }),
          operations: await db.outboundOperation.count({
            where: { companyId: f.company.id },
          }),
          recipient: await db.campaignRecipient.findUniqueOrThrow({
            where: { id: r.r.id },
          }),
        };
        const a = await read(f);
        assert.equal(a.metrics.identifiedReads, 1);
        const after = {
          messages: await db.message.count({
            where: { conversationId: r.conversation.id },
          }),
          sessions: await db.chatbotSession.count({
            where: { companyId: f.company.id },
          }),
          operations: await db.outboundOperation.count({
            where: { companyId: f.company.id },
          }),
          recipient: await db.campaignRecipient.findUniqueOrThrow({
            where: { id: r.r.id },
          }),
        };
        assert.deepEqual(after, before);
      },
    );
  test("21 filtered CSV is versioned, matches attribution and neutralizes formulas", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await db.contact.update({
      where: { id: r.contact.id },
      data: { name: "=1+1" },
    });
    await reply(f, r);
    const response = await exporter.GET(
      request(f, "/api/campaigns/analytics/export?interaction=CLICKED"),
    );
    assert.equal(response.status, 200);
    const text = await response.text();
    assert(text.includes("identifiedRead"));
    assert(text.includes("'=1+1"));
    assert.equal(text.trim().split(/\r?\n/).length, 2);
    const empty = await exporter.GET(
      request(f, "/api/campaigns/analytics/export?interaction=TEXT_REPLY"),
    );
    assert.equal((await empty.text()).trim().split(/\r?\n/).length, 1);
  });
  test("22 indicators, logs, daily series and arbitrary snapshot button labels agree", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await reply(f, r, "button", "Outra opção");
    const a = await read(f);
    assert.equal(a.logs?.[0].identifiedRead, true);
    assert.equal(a.metrics.clickEvents, Number(a.logs?.[0].clickEvents));
    assert.equal(
      a.daily?.reduce((n, d) => n + d.sent, 0),
      a.metrics.sent,
    );
    assert.equal(a.buttons?.[0].optionTitle, "Outra opção");
    await reply(f, r, "button", "Visitar site");
    assert.equal((await read(f)).metrics.clickEvents, 1);
  });
  test("23 thousands of recipients use bounded results and aggregate counts", async () => {
    const f = await fixture();
    const count = 3000;
    for (let offset = 0; offset < count; offset += 500) {
      const ids = Array.from(
        { length: 500 },
        (_, i) => "vol-" + f.campaign.id + "-" + (offset + i),
      );
      await db.contact.createMany({
        data: ids.map((id, i) => ({
          id,
          companyId: f.company.id,
          name: "Volume " + (offset + i),
          phone: "55118" + String(offset + i).padStart(8, "0"),
        })),
      });
      await db.conversation.createMany({
        data: ids.map((id) => ({
          id: "conversation-" + id,
          contactId: id,
          channelId: f.channel.id,
          status: "PENDING",
        })),
      });
      await db.message.createMany({
        data: ids.map((id, i) => ({
          conversationId: "conversation-" + id,
          direction: "outbound",
          type: "template",
          body: "Synthetic volume template",
          templateName: f.campaign.templateName,
          providerMessageId: "provider-" + id,
          readAt: (offset + i) % 3 === 0 ? new Date() : null,
        })),
      });
      await db.campaignRecipient.createMany({
        data: ids.map((id) => ({
          campaignId: f.campaign.id,
          contactId: id,
          phone: "synthetic",
          status: "SENT",
          conversationId: "conversation-" + id,
          providerMessageId: "provider-" + id,
          sentAt: new Date(),
        })),
      });
    }
    const started = Date.now();
    const a = await read(f);
    assert.equal(a.metrics.selected, count);
    assert.equal(a.metrics.sent, count);
    assert.equal(a.metrics.read, 1000);
    assert.equal(a.logs?.length, 50);
    assert(a.pagination?.hasMore);
    assert(Date.now() - started < 18000);
  });
  test("24 forged or conflicted snapshot cannot establish interaction evidence", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await db.message.create({
      data: {
        conversationId: r.conversation.id,
        direction: "inbound",
        senderType: "customer",
        type: "button",
        body: "Synthetic unverified",
        providerMessageId: randomUUID(),
        replyToProviderMessageId: r.providerId,
        metaReplySnapshot: "{malformed",
      },
    });
    assert.equal((await read(f)).metrics.identifiedReads, 0);
  });
  test("25 analytics never calls a provider", () => {
    assert.equal(providerCalls, 0);
  });
  test("26 invalid HMAC cannot create evidence or change analytics", async () => {
    const f = await fixture(),
      r = await recipient(f),
      body = raw(f, r);
    const response = await webhook.POST(
      new NextRequest("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": "sha256=" + "0".repeat(64),
        },
      }),
    );
    assert.equal(response.status, 403);
    assert.equal((await read(f)).metrics.identifiedReads, 0);
  });
  test("27 current provider ID uniqueness forbids ambiguous resend attribution", async () => {
    const f = await fixture(),
      r = await recipient(f),
      other = await recipient(f);
    await assert.rejects(
      db.campaignRecipient.update({
        where: { id: other.r.id },
        data: { providerMessageId: r.providerId },
      }),
      { code: "P2002" },
    );
    await reply(f, r);
    assert.equal((await read(f)).metrics.identifiedReads, 1);
  });
  test("28 literal wildcard search, delivery-only filters and pagination agree", async () => {
    const f = await fixture(),
      r = await recipient(f);
    await db.contact.update({
      where: { id: r.contact.id },
      data: { name: "Cliente %_ literal" },
    });
    await reply(f, r);
    assert.equal((await read(f, { search: "%_" })).metrics.selected, 1);
    assert.equal((await read(f, { search: "absent" })).metrics.selected, 0);
    assert.equal((await read(f, { status: "DELIVERED" })).metrics.selected, 0);
    assert.equal(
      (await read(f, { interaction: "IDENTIFIED" })).metrics.selected,
      1,
    );
    assert.equal((await read(f, { page: "1" })).logs?.length, 0);
  });
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
