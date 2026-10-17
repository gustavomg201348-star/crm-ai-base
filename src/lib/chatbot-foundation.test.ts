import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { createChatbotFoundation } from "./chatbot-foundation.service";

const definition = { schemaVersion: 1, entryStepId: "intro", steps: [
  { id: "intro", type: "TEXT", text: "Exemplo sintetico", next: "human" },
  { id: "human", type: "HANDOFF", queue: "DEFAULT" }
] };
const code = (expected: string) => (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === expected);

test("chatbot foundation integration on an explicitly isolated database", { skip: !process.env.CHATBOT_FOUNDATION_TEST_DATABASE_URL && !process.env.CI }, async (t) => {
  const url = process.env.CHATBOT_FOUNDATION_TEST_DATABASE_URL;
  assert(url, "CHATBOT_FOUNDATION_TEST_DATABASE_URL is required in CI; integration cannot be silently skipped");
  const postgres = process.env.CHATBOT_FOUNDATION_POSTGRES_TEST === "1";
  if (postgres) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "postgresql:");
    assert(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/qevora_chatbot_test", "A dedicated disposable database is required");
    assert(!parsed.searchParams.has("host"), "Connection host overrides are forbidden");
  } else {
    assert(url.startsWith("file:"), "Only a disposable SQLite or explicitly enabled local PostgreSQL is authorized");
    const file = path.resolve(url.slice(5));
    assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert(path.basename(file).startsWith("qevora-chatbot-foundation-") && file.endsWith(".db"));
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  let now = new Date();
  // Database defaults use wall time even when the test advances its logical clock.
  const service = createChatbotFoundation(db, () => new Date(Math.max(now.getTime(), Date.now())));
  const suffix = Date.now().toString(36);
  try {
    const company = await db.company.create({ data: { name: `Synthetic chatbot ${suffix}` } });
    const otherCompany = await db.company.create({ data: { name: `Other synthetic ${suffix}` } });
    const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic A", provider: "meta" } });
    const otherChannel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic B", provider: "meta" } });
    const foreignChannel = await db.channel.create({ data: { companyId: otherCompany.id, name: "Foreign", provider: "meta" } });
    const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic", phone: "00000000000" } });
    const conversation = await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id } });
    const secondConversation = await db.conversation.create({ data: { contactId: contact.id, channelId: otherChannel.id } });
    const campaign = await db.campaign.create({ data: { companyId: company.id, channelId: channel.id, name: "Synthetic campaign fixture", message: "Not sent" } });
    const recipient = await db.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: contact.id, conversationId: conversation.id, phone: contact.phone, status: "SENT", providerMessageId: "synthetic-outbound-fixture" } });
    const campaignBefore = JSON.stringify(await db.campaign.findMany());
    const before = JSON.stringify(await db.conversation.findMany({ orderBy: { id: "asc" } }), (_key, value) => typeof value === "bigint" ? value.toString() : value);
    const draft = await service.createDraft({ companyId: company.id, name: "Draft", definition });
    const scopeFlow = { companyId: company.id, flowId: draft.flow.id };
    await t.test("draft is not executable and invalid definitions never publish", async () => {
      assert.equal(await service.getPublishedVersion(scopeFlow), null);
      await assert.rejects(service.createDraft({ companyId: company.id, name: "Bad", definition: { ...definition, entryStepId: "missing" } }), code("INVALID_DEFINITION"));
      await db.chatbotFlowVersion.update({ where: { id: draft.version.id }, data: { definition: JSON.stringify({ ...definition, entryStepId: "missing" }) } });
      await assert.rejects(service.publishVersion({ ...scopeFlow, versionId: draft.version.id, expectedRevision: 0 }), code("INVALID_DEFINITION"));
      assert.equal((await db.chatbotFlow.findUniqueOrThrow({ where: { id: draft.flow.id } })).publishedVersionId, null);
      await db.chatbotFlowVersion.update({ where: { id: draft.version.id }, data: { definition: JSON.stringify(definition) } });
    });
    const published = await service.publishVersion({ ...scopeFlow, versionId: draft.version.id, expectedRevision: 0 });
    const create = { ...scopeFlow, flowVersionId: published.id, channelId: channel.id, contactId: contact.id, conversationId: conversation.id, campaignId: campaign.id, campaignRecipientId: recipient.id, expiresAt: new Date(Date.now() + 3600000) };
    await t.test("company and channel boundaries are mandatory", async () => {
      assert.equal(await service.getPublishedVersion({ ...scopeFlow, companyId: otherCompany.id }), null);
      await assert.rejects(service.publishVersion({ ...scopeFlow, companyId: otherCompany.id, versionId: published.id, expectedRevision: 1 }), code("VERSION_NOT_FOUND"));
      await assert.rejects(service.createSession({ ...create, companyId: otherCompany.id }), code("INVALID_SESSION_REFERENCE"));
      await assert.rejects(service.createSession({ ...create, channelId: foreignChannel.id }), code("INVALID_SESSION_REFERENCE"));
      await assert.rejects(service.createSession({ ...create, channelId: otherChannel.id }), code("INVALID_SESSION_REFERENCE"));
      await assert.rejects(service.createSession({ ...create, campaignId: "missing" }), code("INVALID_CAMPAIGN_REFERENCE"));
      await assert.rejects(service.createSession({ ...create, campaignId: campaign.id, campaignRecipientId: "missing" }), code("INVALID_CAMPAIGN_REFERENCE"));
    });
    await t.test("published versions are immutable through services", async () => {
      await assert.rejects(service.publishVersion({ ...scopeFlow, versionId: published.id, expectedRevision: 1 }), code("VERSION_IMMUTABLE"));
      const next = await service.createDraftVersion({ ...scopeFlow, expectedRevision: 1, definition });
      assert.equal(next.number, 2);
      await assert.rejects(service.createDraftVersion({ ...scopeFlow, expectedRevision: 1, definition }), code("REVISION_CONFLICT"));
      await service.publishVersion({ ...scopeFlow, expectedRevision: 2, versionId: next.id });
      assert.equal((await service.getPublishedVersion(scopeFlow))?.id, next.id);
      assert.equal((await db.chatbotFlowVersion.findUniqueOrThrow({ where: { id: published.id } })).definition, published.definition);
      if (postgres) {
        await assert.rejects(db.chatbotFlowVersion.update({ where: { id: published.id }, data: { definition: "{}" } }));
        await assert.rejects(db.chatbotFlowVersion.delete({ where: { id: published.id } }));
      }
    });
    const sessions = await Promise.all([service.createSession(create), service.createSession(create)]);
    const session = sessions[0];
    now = new Date(Date.now() + 100);
    const scope = { companyId: company.id, channelId: channel.id, sessionId: session.id };
    await t.test("concurrent session creation has one active slot and preserves original version", async () => {
      assert.equal(sessions[0].id, sessions[1].id);
      assert.equal(await db.chatbotSession.count({ where: { conversationId: conversation.id, status: "ACTIVE" } }), 1);
      assert.equal(session.flowVersionId, published.id);
      await assert.rejects(db.chatbotSession.create({ data: { ...create, activeConversationId: conversation.id, currentStepId: "intro" } }));
      await assert.rejects(service.getSession({ ...scope, channelId: otherChannel.id }), code("SESSION_NOT_FOUND"));
      await assert.rejects(service.getSession({ ...scope, companyId: otherCompany.id }), code("SESSION_NOT_FOUND"));
    });
    const eventInput = { ...scope, idempotencyKey: "synthetic-inbound-1", kind: "INBOUND_TEXT" as const, payload: { text: "Teste" }, occurredAt: now };
    const events = await Promise.all([service.recordEvent(eventInput), service.recordEvent(eventInput)]);
    await t.test("event idempotency is durable and conflicting reuse is rejected", async () => {
      assert.equal(events[0].id, events[1].id);
      assert.equal(await db.chatbotEvent.count({ where: { sessionId: session.id } }), 1);
      await assert.rejects(service.recordEvent({ ...eventInput, payload: { text: "Different" } }), code("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(service.recordEvent({ ...eventInput, idempotencyKey: "old", occurredAt: new Date(session.createdAt.getTime() - 1) }), code("EVENT_TOO_OLD"));
    });
    const claims = await Promise.all([
      service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 }),
      service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 })
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    const claimed = claims.find(Boolean)!;
    assert(claimed?.event.leaseToken);
    await t.test("leases prevent duplicate processing and stale completion", async () => {
      assert.equal(await service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 }), null);
      await assert.rejects(service.finishEvent({ ...scope, eventId: events[0].id, expectedRevision: 0, leaseToken: "wrong", result: "PROCESSED" }), code("LEASE_CONFLICT"));
      now = new Date(now.getTime() + 31000);
      const reclaimed = await service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 });
      assert(reclaimed?.event.leaseToken);
      assert.equal(reclaimed.event.attempts, 2);
      await service.finishEvent({ ...scope, eventId: events[0].id, expectedRevision: 0, leaseToken: reclaimed.event.leaseToken, result: "RETRY" });
      assert.equal(await service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 }), null);
      now = new Date(now.getTime() + 5000);
      const retried = await service.claimEvent({ ...scope, eventId: events[0].id, expectedRevision: 0 });
      assert(retried?.event.leaseToken);
      const dead = await service.finishEvent({ ...scope, eventId: events[0].id, expectedRevision: 0, leaseToken: retried.event.leaseToken, result: "RETRY" });
      assert.equal(dead.status, "DEAD");
      assert.equal(dead.attempts, 3);
    });
    const pending = await service.recordEvent({ ...eventInput, idempotencyKey: "pending", occurredAt: now });
    await t.test("only one event lease can own a session at a time", async () => {
      const another = await service.recordEvent({ ...eventInput, idempotencyKey: "another", occurredAt: now });
      const first = await service.claimEvent({ ...scope, eventId: pending.id, expectedRevision: 0 });
      assert(first?.event.leaseToken);
      assert.equal(await service.claimEvent({ ...scope, eventId: another.id, expectedRevision: 0 }), null);
      await service.finishEvent({ ...scope, eventId: pending.id, expectedRevision: 0, leaseToken: first.event.leaseToken, result: "RETRY" });
      now = new Date(now.getTime() + 3000);
    });
    await t.test("different events racing for the same session have only one processing owner", async () => {
      const left = await service.recordEvent({ ...eventInput, idempotencyKey: "race-left", occurredAt: now });
      const right = await service.recordEvent({ ...eventInput, idempotencyKey: "race-right", occurredAt: now });
      const racing = await Promise.all([
        service.claimEvent({ ...scope, eventId: left.id, expectedRevision: 0 }),
        service.claimEvent({ ...scope, eventId: right.id, expectedRevision: 0 })
      ]);
      assert.equal(racing.filter(Boolean).length, 1);
      const owner = racing.find(Boolean)!;
      const finished = await service.finishEvent({ ...scope, eventId: owner.event.id, expectedRevision: 0, leaseToken: owner.event.leaseToken!, result: "PROCESSED" });
      assert.equal(finished.status, "PROCESSED");
    });
    const command = await db.chatbotOutbox.create({ data: { ...scope, eventId: pending.id, idempotencyKey: "command-1", payload: "{}" } });
    await t.test("foreign keys protect session, event and outbox references", async () => {
      await assert.rejects(db.chatbotEvent.create({ data: { ...scope, companyId: otherCompany.id, idempotencyKey: "foreign", fingerprint: "test", kind: "INBOUND_TEXT", payload: "{}", occurredAt: now } }));
      await assert.rejects(db.chatbotSession.create({ data: { ...create, conversationId: secondConversation.id, activeConversationId: secondConversation.id, currentStepId: "intro" } }));
      await assert.rejects(db.chatbotOutbox.create({ data: { ...scope, eventId: "foreign", idempotencyKey: "foreign", payload: "{}" } }));
      if (postgres) {
        await assert.rejects(db.chatbotSession.create({ data: { ...create, channelId: otherChannel.id, conversationId: secondConversation.id, currentStepId: "intro", campaignId: undefined, campaignRecipientId: undefined } }));
        await assert.rejects(db.chatbotEvent.create({ data: { ...scope, idempotencyKey: "invalid-attempts", fingerprint: "test", kind: "INBOUND_TEXT", payload: "{}", occurredAt: now, attempts: -1 } }));
        await assert.rejects(db.chatbotOutbox.create({ data: { ...scope, eventId: pending.id, idempotencyKey: "invalid-status", payload: "{}", status: "INVALID" } }));
      }
    });
    const inFlight = await service.claimEvent({ ...scope, eventId: pending.id, expectedRevision: 0 });
    assert(inFlight?.event.leaseToken);
    await t.test("human intervention suspends persistently, cancels outbox and prevents late completion", async () => {
      const suspended = await service.suspendSession({ ...scope, expectedRevision: 0, reason: "HUMAN_INTERVENTION" });
      assert.equal(suspended.status, "SUSPENDED"); assert.equal(suspended.authority, "HUMAN");
      assert.equal((await db.chatbotOutbox.findUniqueOrThrow({ where: { id: command.id } })).status, "CANCELED");
      await assert.rejects(service.closeSession({ ...scope, expectedRevision: 0, reason: "MANUAL" }), code("REVISION_CONFLICT"));
      await assert.rejects(service.createSession(create), code("HUMAN_CONTROL_REQUIRED"));
      await assert.rejects(service.finishEvent({ ...scope, eventId: pending.id, expectedRevision: 0, leaseToken: inFlight!.event.leaseToken!, result: "PROCESSED" }), code("SESSION_NOT_ACTIVE"));
      const closed = await service.closeSession({ ...scope, expectedRevision: 1, reason: "HUMAN_HANDOFF" });
      assert.equal(closed.status, "CLOSED"); assert.equal(closed.activeConversationId, null);
      await assert.rejects(service.createSession(create), code("HUMAN_CONTROL_REQUIRED"));
    });
    await t.test("expiry is persisted and expired sessions cannot accept events", async () => {
      const expiring = await service.createSession({ ...create, campaignId: undefined, campaignRecipientId: undefined, channelId: otherChannel.id, conversationId: secondConversation.id, expiresAt: new Date(now.getTime() + 1000) });
      const expiryScope = { ...scope, channelId: otherChannel.id, sessionId: expiring.id };
      now = new Date(now.getTime() + 2000);
      const expired = await service.getSession(expiryScope);
      assert.equal(expired.status, "EXPIRED"); assert.equal(expired.activeConversationId, null);
      await assert.rejects(service.recordEvent({ ...eventInput, ...expiryScope, idempotencyKey: "expired", occurredAt: now }), code("SESSION_NOT_ACTIVE"));
      await assert.rejects(service.createSession({ ...create, expiresAt: now }), code("SESSION_EXPIRED"));
    });
    await t.test("campaign references must match the session company, channel, contact and conversation", async () => {
      const thirdContact = await db.contact.create({ data: { companyId: company.id, name: "Other synthetic contact", phone: "00000000000" } });
      const thirdConversation = await db.conversation.create({ data: { contactId: thirdContact.id, channelId: channel.id, status: "OPEN" } });
      try {
        await assert.rejects(service.createSession({ ...create, contactId: thirdContact.id, conversationId: thirdConversation.id, campaignId: campaign.id, campaignRecipientId: recipient.id, expiresAt: new Date(now.getTime() + 10000) }), code("INVALID_CAMPAIGN_REFERENCE"));
      } finally {
        await db.conversation.delete({ where: { id: thirdConversation.id } });
        await db.contact.delete({ where: { id: thirdContact.id } });
      }
    });
    await t.test("foundation never changes commercial entities or sends messages", async () => {
      assert.equal(JSON.stringify(await db.conversation.findMany({ orderBy: { id: "asc" } }), (_key, value) => typeof value === "bigint" ? value.toString() : value), before);
      assert.equal(await db.message.count(), 0);
      assert.equal(await db.task.count(), 0);
      assert.equal(await db.proposal.count(), 0);
      assert.equal(JSON.stringify(await db.campaign.findMany()), campaignBefore);
    });
  } finally {
    await db.$disconnect();
  }
});
