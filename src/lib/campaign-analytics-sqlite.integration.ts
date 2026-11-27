import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";

assert.equal(process.env.CAMPAIGN_ANALYTICS_SQLITE_TEST, "1");
assert((process.env.DATABASE_URL ?? "").startsWith("file:"));
const file = resolve(process.env.DATABASE_URL!.slice(5)),
  rel = relative(resolve(tmpdir()), file);
assert.equal(basename(file), "qevora_campaign_analytics_test.db");
assert(!rel.startsWith("..") && !isAbsolute(rel));

async function main() {
  const { prisma: db } = await import("./db");
  const { campaignAnalytics } = await import("./campaign-analytics.service");
  const { analyticsFilters } = await import("./campaign-analytics-policy");
  const { authenticateMetaInboundBatch } = await import(
    "./meta-inbound-provenance"
  );
  const { persistInboundMessage } = await import("./meta-reply-ingestion");
  await import("./inbound-message");
  after(() => db.$disconnect());
  const company = await db.company.create({
    data: { name: "Synthetic SQLite", aiMode: "OFF" },
  });
  const secret = "synthetic-sqlite-secret",
    channel = await db.channel.create({
      data: {
        companyId: company.id,
        name: "SQLite Meta",
        provider: "meta",
        type: "whatsapp",
        appSecret: secret,
        status: "ACTIVE",
        phoneNumberId: randomUUID(),
      },
    });
  const campaign = await db.campaign.create({
    data: {
      companyId: company.id,
      channelId: channel.id,
      name: "Synthetic",
      message: "Synthetic",
      messageType: "TEMPLATE",
      templateName: "test_template",
      status: "PAUSED",
    },
  });
  const phone = "5511999990088",
    contact = await db.contact.create({
      data: { companyId: company.id, phone, name: "Literal %_ synthetic" },
    }),
    conversation = await db.conversation.create({
      data: { contactId: contact.id, channelId: channel.id },
    });
  const providerId = "wamid.synthetic." + randomUUID();
  await db.campaignRecipient.create({
    data: {
      campaignId: campaign.id,
      contactId: contact.id,
      conversationId: conversation.id,
      phone,
      status: "SENT",
      providerMessageId: providerId,
      sentAt: new Date(),
    },
  });
  const source = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: "outbound",
      type: "template",
      body: "Synthetic",
      templateName: campaign.templateName,
      providerMessageId: providerId,
      templateVariables: JSON.stringify({
        buttons: ["invalid scalar", { type: "QUICK_REPLY", text: "Conferir" }],
      }),
    },
  });
  const query = (extra: Record<string, string> = {}) =>
    campaignAnalytics(
      db,
      company.id,
      analyticsFilters(new URLSearchParams(extra)),
      "dashboard",
      "sqlite",
    );
  test("SQLite counts synthetic sends and literal wildcard searches", async () => {
    const a = await query({ search: "%_" });
    assert.equal(a.metrics?.sent, 1);
    assert.equal(a.metrics?.read, 0);
  });
  test("SQLite attributes authenticated button with malformed catalog elements safely", async () => {
    const body = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: channel.phoneNumberId },
                messages: [
                  {
                    id: "wamid.reply." + randomUUID(),
                    from: phone,
                    type: "button",
                    context: { id: providerId },
                    button: { text: "Conferir", payload: "Conferir" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const [{ input, capability }] = await authenticateMetaInboundBatch({
      db,
      rawBody: body,
      signature:
        "sha256=" + createHmac("sha256", secret).update(body).digest("hex"),
    });
    await persistInboundMessage(
      db,
      {
        conversationId: conversation.id,
        direction: "inbound",
        senderType: "customer",
        type: "button",
        body: input.body.trim(),
        providerMessageId: input.providerMessageId,
        replyToProviderMessageId: providerId,
      },
      {
        companyId: company.id,
        channelId: channel.id,
        contactId: contact.id,
        senderPhone: phone,
        contextProviderMessageId: providerId,
        metadata: input.replyMetadata,
      },
      company.id,
      capability,
    );
    const a = await query();
    assert.equal(a.metrics?.additionalReads, 1);
    assert.equal(a.metrics?.clickEvents, 1);
    assert.equal(
      (await db.message.findUniqueOrThrow({ where: { id: source.id } })).readAt,
      null,
    );
  });
  test("SQLite late official read preserves identified union and exports", async () => {
    await db.message.update({
      where: { id: source.id },
      data: { readAt: new Date() },
    });
    const a = await query();
    assert.equal(a.metrics?.identifiedReads, 1);
    assert.equal(a.metrics?.additionalReads, 0);
    const csv = await campaignAnalytics(
      db,
      company.id,
      analyticsFilters(new URLSearchParams("interaction=CLICKED")),
      "export",
      "sqlite",
    );
    assert.equal(csv.rows?.length, 1);
  });
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
