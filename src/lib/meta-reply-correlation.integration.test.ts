import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { Prisma, PrismaClient } from "@prisma/client";
import { readMetaReplyMetadata } from "./meta-reply-metadata";
import { createMetaReplyCorrelation } from "./meta-reply-correlation.service";
import { persistInboundMessage, preserveReplyReplay } from "./meta-reply-ingestion";
import { installReplySqliteIntegrity } from "./meta-reply-sqlite-integrity";
import { replyContentDigest } from "./meta-reply-snapshot";

test("passive Meta correlation on an explicitly disposable database", { skip: !process.env.CHATBOT_REPLY_TEST_DATABASE_URL && !process.env.CI }, async (t) => {
  const url = process.env.CHATBOT_REPLY_TEST_DATABASE_URL;
  assert(url, "Dedicated correlation test database is required in CI");
  if (process.env.CHATBOT_REPLY_POSTGRES_TEST === "1") {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "postgresql:");
    assert(["127.0.0.1", "localhost"].includes(parsed.hostname));
    assert.equal(parsed.pathname, "/qevora_chatbot_test");
    assert(!parsed.searchParams.has("host"));
  } else {
    assert(url.startsWith("file:"));
    const file = path.resolve(url.slice(5));
    assert.equal(path.dirname(file).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert(path.basename(file).startsWith("qevora-chatbot-reply-") && file.endsWith(".db"));
  }
  const db = new PrismaClient({ datasources: { db: { url } } });
  const provider = process.env.CHATBOT_REPLY_POSTGRES_TEST === "1" ? "postgresql" : "sqlite";
  if (provider === "sqlite") await installReplySqliteIntegrity(db, url);
  const service = createMetaReplyCorrelation(db, { provider });
  const immutableError = (label: RegExp) => (error: unknown) => label.test(String(error))
    || (provider === "sqlite" && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003");
  const companies: string[] = [];
  try {
    const company = await db.company.create({ data: { name: "Synthetic reply company" } });
    const foreign = await db.company.create({ data: { name: "Synthetic foreign company" } });
    companies.push(company.id, foreign.id);
    const channel = await db.channel.create({ data: { companyId: company.id, name: "Local fixture", provider: "meta" } });
    const secondChannel = await db.channel.create({ data: { companyId: company.id, name: "Other fixture", provider: "meta" } });
    const foreignChannel = await db.channel.create({ data: { companyId: foreign.id, name: "Foreign fixture", provider: "meta" } });
    const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic reply contact", phone: "+5547999999999" } });
    const otherContact = await db.contact.create({ data: { companyId: company.id, name: "Other synthetic contact", phone: "+5547888888888" } });
    const foreignContact = await db.contact.create({ data: { companyId: foreign.id, name: "Foreign synthetic contact", phone: "+5547999999999" } });
    const conversation = await db.conversation.create({ data: { channelId: channel.id, contactId: contact.id } });
    const otherConversation = await db.conversation.create({ data: { channelId: channel.id, contactId: otherContact.id } });
    const secondConversation = await db.conversation.create({ data: { channelId: secondChannel.id, contactId: contact.id } });
    const foreignConversation = await db.conversation.create({ data: { channelId: foreignChannel.id, contactId: foreignContact.id } });
    const scope = { companyId: company.id, channelId: channel.id, conversationId: conversation.id };
    const suffix = company.id;
    const campaign = async (label: string, conv = conversation, target = contact, ch = channel) => {
      const campaign = await db.campaign.create({ data: { companyId: company.id, channelId: ch.id, name: label, message: "Synthetic only" } });
      const providerMessageId = label + suffix;
      const source = await db.message.create({ data: { conversationId: conv.id, direction: "outbound", senderType: "agent", body: "Synthetic outbound", type: "template", templateName: label, templateLanguage: "pt_BR", providerMessageId } });
      const recipient = await db.campaignRecipient.create({ data: { campaignId: campaign.id, contactId: target.id, conversationId: conv.id, phone: target.phone, providerMessageId, status: "SENT" } });
      return { campaign, source, recipient, providerMessageId };
    };
    const old = await campaign("old");
    const recent = await campaign("recent");
    const wrongContact = await campaign("wrong-contact", otherConversation, otherContact);
    const wrongChannel = await campaign("wrong-channel", secondConversation, contact, secondChannel);
    const foreignSource = await db.message.create({ data: { conversationId: foreignConversation.id, direction: "outbound", body: "Synthetic foreign", providerMessageId: "foreign" + suffix } });
    const nonCampaign = await db.message.create({ data: { conversationId: conversation.id, direction: "outbound", body: "Manual synthetic", providerMessageId: "manual" + suffix } });
    const inboundSource = await db.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderType: "customer", body: "Synthetic", providerMessageId: "inbound-source" + suffix } });
    let sequence = 0;
    const input = async (contextProviderMessageId: string | null, senderPhone = "47999999999", metadata = readMetaReplyMetadata({ type: "button", timestamp: "1792065600", button: { payload: "yes", text: "Sim" } })) => {
      const providerMessageId = "reply-" + (++sequence) + suffix;
      const evidence = { ...scope, contactId: contact.id, providerMessageId, contextProviderMessageId, senderPhone, metadata, contentDigest: replyContentDigest({ body: "Synthetic reply" }) };
      const incoming = await persistInboundMessage(db, { conversationId: conversation.id, direction: "inbound", senderType: "customer", body: "Synthetic reply", providerMessageId }, evidence);
      return { ...evidence, incoming };
    };
    const capture = async (request: Awaited<ReturnType<typeof input>>) => {
      const receipt = await service.processMessage({ companyId: request.companyId, channelId: request.channelId, messageId: request.incoming.id });
      assert(receipt);
      return receipt;
    };
    const unchanged = async (operation: () => Promise<unknown>) => {
      const snapshot = async () => JSON.stringify(await Promise.all([
        db.contact.findMany({ orderBy: { id: "asc" } }), db.conversation.findMany({ orderBy: { id: "asc" } }),
        db.message.findMany({ orderBy: { id: "asc" } }).then(rows => rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !["metaReplySnapshot", "metaReplyConflictSnapshot"].includes(key))))), db.campaign.findMany({ orderBy: { id: "asc" } }),
        db.campaignRecipient.findMany({ orderBy: { id: "asc" } }), db.chatbotSession.findMany(),
        db.chatbotEvent.findMany(), db.chatbotOutbox.findMany()
      ]));
      const before = await snapshot();
      await operation();
      assert.equal(await snapshot(), before, "Only correlation receipts may mutate");
    };
    await t.test("old campaign wins by exact ID, never the most recent campaign; replay is durable", async () => {
      const request = await input(old.providerMessageId);
      await unchanged(async () => {
        const first = await capture(request);
        assert.equal(first.status, "CONFIRMED");
        assert.equal(first.campaignId, old.campaign.id);
        assert.notEqual(first.campaignId, recent.campaign.id);
        assert.equal(first.flowCandidateStatus, "UNCONFIGURED");
        assert.equal(first.candidateFlowId, null);
        assert.equal(first.templateName, "old");
        const repeated = await capture(request);
        assert.equal(first.id, repeated.id);
        assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: request.incoming.id } }), 1);
        await preserveReplyReplay(db, request.incoming, { ...request, contextProviderMessageId: recent.providerMessageId }, provider);
        const conflict = await capture(request);
        assert.equal(conflict.status, "CONFLICT");
        assert.equal(conflict.reason, "REPLAY_CONFLICT");
        assert.equal(conflict.campaignId, old.campaign.id);
        assert.equal(conflict.contextProviderMessageId, old.providerMessageId);
      });
    });
    await t.test("simultaneous campaigns and concurrent duplicate deliveries remain independent", async () => {
      const a = await input(old.providerMessageId);
      const b = await input(recent.providerMessageId);
      await unchanged(async () => {
        const results = await Promise.allSettled([a, a, b].map(request => service.processMessage({ ...scope, messageId: request.incoming.id })));
        for (const result of results) {
          if (result.status === "rejected") assert(result.reason instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034", "P1008", "P2028"].includes(result.reason.code));
        }
        const resolvedA = await capture(a); const resolvedB = await capture(b);
        assert.equal(resolvedA.campaignId, old.campaign.id);
        assert.equal(resolvedB.campaignId, recent.campaign.id);
        assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: a.incoming.id } }), 1);
        assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: b.incoming.id } }), 1);
      });
    });
    for (const [label, context, reason] of [
      ["no context", null, "NO_CONTEXT"], ["unknown context", "missing" + suffix, "SOURCE_NOT_FOUND"],
      ["manual outbound", nonCampaign.providerMessageId, "NO_CAMPAIGN"],
      ["foreign company", foreignSource.providerMessageId, "SOURCE_NOT_FOUND"],
      ["different channel", wrongChannel.providerMessageId, "SOURCE_NOT_FOUND"],
      ["referenced inbound", inboundSource.providerMessageId, "SOURCE_NOT_FOUND"],
      ["different contact/conversation", wrongContact.providerMessageId, "SOURCE_CONVERSATION_MISMATCH"]
    ] as const) {
      await t.test(label + " cannot acquire an unverified campaign", async () => {
        const request = await input(context);
        await unchanged(async () => {
          const receipt = await capture(request);
          assert.equal(receipt.reason, reason);
          assert.equal(receipt.campaignId, null);
        });
      });
    }
    await t.test("mismatching sender cannot inherit a context-selected contact", async () => {
      const request = await input(old.providerMessageId, "5547888888888");
      const receipt = await capture(request);
      assert.equal(receipt.status, "CONFLICT");
      assert.equal(receipt.reason, "DESTINATION_PHONE_MISMATCH");
      assert.equal(receipt.campaignId, null);
    });
    await t.test("out-of-order persistence can be reconciled explicitly without inventing IDs", async () => {
      const request = await input("late" + suffix);
      const pending = await capture(request);
      assert.equal(pending.status, "NOT_FOUND");
      const late = await campaign("late");
      const resolved = await service.refresh({ ...scope, id: pending.id });
      assert.equal(resolved?.id, pending.id);
      assert.equal(resolved?.status, "CONFIRMED");
      assert.equal(resolved?.campaignId, late.campaign.id);
      assert.equal(await service.refresh({ ...scope, companyId: foreign.id, id: pending.id }), null);
      assert.equal(await service.refresh({ ...scope, channelId: secondChannel.id, id: pending.id }), null);
    });
    await t.test("ambiguous outbound or recipients are rejected rather than picked by time", async () => {
      if (process.env.CHATBOT_REPLY_POSTGRES_TEST === "1") {
        // Production baseline already forbids duplicate provider IDs globally.
        await assert.rejects(db.message.create({ data: { conversationId: conversation.id, direction: "outbound", body: "Duplicate fixture", providerMessageId: old.providerMessageId } }));
        await assert.rejects(db.campaignRecipient.create({ data: { campaignId: recent.campaign.id, contactId: otherContact.id, conversationId: otherConversation.id, phone: otherContact.phone, providerMessageId: old.providerMessageId } }));
        return;
      }
      const duplicateSource = await db.message.create({ data: { conversationId: conversation.id, direction: "outbound", body: "Synthetic duplicate ID", providerMessageId: old.providerMessageId } });
      const sourceRequest = await input(old.providerMessageId);
      const sourceResult = await capture(sourceRequest);
      assert.equal(sourceResult.status, "AMBIGUOUS");
      assert.equal(sourceResult.campaignId, null);
      await db.message.delete({ where: { id: duplicateSource.id } });
      const anotherCampaign = await db.campaign.create({ data: { companyId: company.id, channelId: channel.id, name: "Duplicate provider fixture", message: "Synthetic" } });
      await db.campaignRecipient.create({ data: { campaignId: anotherCampaign.id, contactId: contact.id, conversationId: conversation.id, phone: contact.phone, providerMessageId: old.providerMessageId } });
      const recipientResult = await capture(await input(old.providerMessageId));
      assert.equal(recipientResult.status, "AMBIGUOUS");
      assert.equal(recipientResult.campaignId, null);
    });
    if (provider === "postgresql") await t.test("CI PostgreSQL executes real ambiguous candidates in a fully rolled-back legacy-corruption fixture", async () => {
      const sourceRequest = await input(old.providerMessageId);
      const recipientRequest = await input(recent.providerMessageId);
      const otherCampaign = await campaign("pg-ambiguity");
      let rolledBack = false;
      try {
        await db.$transaction(async tx => {
          // This dedicated test database is already guarded above. DDL is rolled back, never committed.
          await tx.$executeRawUnsafe('DROP INDEX "Message_providerMessageId_unique"');
          await tx.$executeRawUnsafe('DROP INDEX "CampaignRecipient_providerMessageId_unique"');
          await tx.message.create({ data: { conversationId: conversation.id, direction: "outbound", body: "Synthetic legacy duplicate", providerMessageId: old.providerMessageId } });
          const adapter = { $transaction: async (operation: (inner: Prisma.TransactionClient) => Promise<unknown>) => operation(tx) } as unknown as PrismaClient;
          const isolated = createMetaReplyCorrelation(adapter, { provider });
          const ambiguousSource = await isolated.processMessage({ ...scope, messageId: sourceRequest.incoming.id });
          assert.equal(ambiguousSource?.status, "AMBIGUOUS");
          assert.equal(ambiguousSource?.reason, "MULTIPLE_SOURCE_MESSAGES");
          await tx.campaignRecipient.update({ where: { id: otherCampaign.recipient.id }, data: { providerMessageId: recent.providerMessageId } });
          const ambiguousRecipient = await isolated.processMessage({ ...scope, messageId: recipientRequest.incoming.id });
          assert.equal(ambiguousRecipient?.status, "AMBIGUOUS");
          assert.equal(ambiguousRecipient?.reason, "MULTIPLE_CAMPAIGN_RECIPIENTS");
          throw new Error("ROLLBACK_AMBIGUITY_FIXTURE");
        }, { timeout: 10000 });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "ROLLBACK_AMBIGUITY_FIXTURE") throw error;
        rolledBack = true;
      }
      assert(rolledBack);
      const indexes = await db.$queryRawUnsafe<Array<{ indexname: string }>>("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('Message_providerMessageId_unique','CampaignRecipient_providerMessageId_unique')");
      assert.equal(indexes.length, 2);
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: { in: [sourceRequest.incoming.id, recipientRequest.incoming.id] } } }), 0);
    });
    await t.test("foreign or missing channel input cannot access the stored inbound", async () => {
      const request = await input(recent.providerMessageId);
      assert.equal(await service.processMessage({ companyId: foreign.id, channelId: channel.id, messageId: request.incoming.id }), null);
      assert.equal(await service.processMessage({ companyId: company.id, channelId: secondChannel.id, messageId: request.incoming.id }), null);
    });
    await t.test("a recipient with a conflicting contact is not silently rebound", async () => {
      const mismatch = await campaign("recipient-mismatch");
      await db.campaignRecipient.update({
        where: { id: mismatch.recipient.id },
        data: { contactId: otherContact.id, conversationId: otherConversation.id }
      });
      const receipt = await capture(await input(mismatch.providerMessageId));
      assert.equal(receipt.reason, "RECIPIENT_SCOPE_MISMATCH");
      assert.equal(receipt.campaignId, null);
    });
    await t.test("context from a legacy conversation without channel cannot match", async () => {
      const legacy = await db.conversation.create({ data: { contactId: contact.id, status: "CLOSED" } });
      const source = await db.message.create({ data: { conversationId: legacy.id, direction: "outbound", body: "Legacy fixture", providerMessageId: "legacy" + suffix } });
      const receipt = await capture(await input(source.providerMessageId));
      assert.equal(receipt.reason, "SOURCE_NOT_FOUND");
      assert.equal(receipt.campaignId, null);
    });
    await t.test("all supported reply types retain only supplied option identity and original timestamp", async () => {
      for (const raw of [
        { type: "text", text: { body: "Synthetic" } },
        { type: "button", button: { text: "Sim" } },
        { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "button:1", title: "Sim" } } },
        { type: "interactive", interactive: { type: "list_reply", list_reply: { id: "row:1", title: "Lista" } } }
      ]) {
        const metadata = readMetaReplyMetadata({ ...raw, timestamp: "1792065600" });
        const request = await input(recent.providerMessageId, "47999999999", metadata);
        const receipt = await capture(request);
        assert.equal(receipt.status, "CONFIRMED");
        assert.equal(receipt.optionId, metadata.optionId);
        assert.equal(receipt.optionTitle, metadata.optionTitle);
        assert.equal(receipt.interactionType, metadata.interactionType);
        assert.equal(receipt.optionIdentity, metadata.optionIdentity);
        assert.equal(receipt.sourceTimestamp?.getTime(), metadata.sourceTimestamp?.getTime());
      }
    });
    await t.test("composite foreign keys reject cross-scope receipt mutations", async () => {
      const receipt = await db.chatbotReplyCorrelation.findFirstOrThrow({ where: { companyId: company.id, status: "CONFIRMED" } });
      for (const data of [
        { companyId: foreign.id }, { channelId: secondChannel.id }, { contactId: otherContact.id },
        { sourceMessageId: wrongContact.source.id }, { campaignId: wrongChannel.campaign.id },
        { campaignRecipientId: wrongContact.recipient.id }
      ]) {
        await assert.rejects(db.chatbotReplyCorrelation.update({ where: { id: receipt.id }, data }));
      }
    });
    await t.test("passive metadata does not prevent existing message deletion", async () => {
      const request = await input(recent.providerMessageId);
      const receipt = await capture(request);
      await db.message.delete({ where: { id: request.incoming.id } });
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { id: receipt.id } }), 0);
    });
    await t.test("historical destination A vs sender/current contact B is rejected, but historical A remains authoritative", async () => {
      const sent = await campaign("historical-phone");
      await db.contact.update({ where: { id: contact.id }, data: { phone: "5547888888888" } });
      const rejected = await capture(await input(sent.providerMessageId, "5547888888888"));
      assert.equal(rejected?.status, "CONFLICT");
      assert.equal(rejected?.reason, "DESTINATION_PHONE_MISMATCH");
      const accepted = await capture(await input(sent.providerMessageId, "47999999999"));
      assert.equal(accepted?.status, "CONFIRMED");
      await db.contact.update({ where: { id: contact.id }, data: { phone: "+5547999999999" } });
      const missing = await campaign("missing-destination");
      await db.campaignRecipient.update({ where: { id: missing.recipient.id }, data: { phone: "" } });
      assert.equal((await capture(await input(missing.providerMessageId)))?.reason, "MISSING_DESTINATION_PHONE");
    });
    await t.test("ORM and direct SQL cannot rebind confirmed evidence, even within the same scope", async () => {
      const request = await input(recent.providerMessageId);
      const receipt = await capture(request);
      assert(receipt?.confirmedAt);
      const alternative = await campaign("immutable-alternative");
      assert.equal(alternative.recipient.contactId, contact.id);
      assert.equal(alternative.recipient.conversationId, conversation.id);
      assert.equal(alternative.source.conversationId, conversation.id);
      const rebind = { campaignId: alternative.campaign.id, campaignRecipientId: alternative.recipient.id, sourceMessageId: alternative.source.id, contextProviderMessageId: alternative.providerMessageId };
      await assert.rejects(db.chatbotReplyCorrelation.update({ where: { id: receipt.id }, data: rebind }), immutableError(/IMMUTABLE_REPLY_EVIDENCE/));
      if (provider === "postgresql") {
        await assert.rejects(db.$executeRawUnsafe('UPDATE "ChatbotReplyCorrelation" SET "campaignId"=$1,"campaignRecipientId"=$2,"sourceMessageId"=$3,"contextProviderMessageId"=$4 WHERE id=$5', rebind.campaignId, rebind.campaignRecipientId, rebind.sourceMessageId, rebind.contextProviderMessageId, receipt.id), /IMMUTABLE_REPLY_EVIDENCE/);
      } else {
        await assert.rejects(db.$executeRawUnsafe('UPDATE ChatbotReplyCorrelation SET campaignId=?,campaignRecipientId=?,sourceMessageId=?,contextProviderMessageId=? WHERE id=?', rebind.campaignId, rebind.campaignRecipientId, rebind.sourceMessageId, rebind.contextProviderMessageId, receipt.id), /IMMUTABLE_REPLY_EVIDENCE/);
      }
      await assert.rejects(db.chatbotReplyCorrelation.update({ where: { id: receipt.id }, data: { confirmedAt: null } }), immutableError(/IMMUTABLE_REPLY_EVIDENCE/));
      await assert.rejects(db.message.update({ where: { id: request.incoming.id }, data: { metaReplySnapshot: "{}" } }), immutableError(/IMMUTABLE_REPLY_SNAPSHOT/));
      await db.chatbotReplyCorrelation.update({ where: { id: receipt.id }, data: { updatedAt: new Date() } });
      await preserveReplyReplay(db, request.incoming, { ...request, contextProviderMessageId: old.providerMessageId }, provider);
      const quarantined = await db.chatbotReplyCorrelation.findUniqueOrThrow({ where: { id: receipt.id } });
      assert.equal(quarantined.status, "CONFLICT"); assert.equal(quarantined.campaignId, recent.campaign.id);
      const marked = await db.message.findUniqueOrThrow({ where: { id: request.incoming.id } });
      assert(marked.metaReplyConflictSnapshot);
      await assert.rejects(db.message.update({ where: { id: marked.id }, data: { metaReplyConflictSnapshot: null } }), immutableError(/IMMUTABLE_REPLY/));
      await assert.rejects(db.chatbotReplyCorrelation.update({ where: { id: receipt.id }, data: { status: "CONFIRMED", reason: "EXACT_PROVIDER_CHAIN" } }), immutableError(/INVALID_REPLY_STATE/));
    });
    await t.test("conflict arriving before processing is durably quarantined; identical replay has no write", async () => {
      const request = await input(recent.providerMessageId);
      await preserveReplyReplay(db, request.incoming, request, provider);
      await preserveReplyReplay(db, request.incoming, { ...request, contextProviderMessageId: old.providerMessageId }, provider);
      const receipt = await capture(request);
      assert.equal(receipt?.status, "CONFLICT");
      assert.equal(receipt?.reason, "REPLAY_CONFLICT");
      assert.equal(receipt?.campaignId, null);
      assert.equal(await db.message.count({ where: { providerMessageId: request.providerMessageId } }), 1);
    });
    await t.test("a different body with identical IDs/option/timestamp is still a conflicting replay", async () => {
      const request = await input(recent.providerMessageId);
      await preserveReplyReplay(db, request.incoming, { ...request, contentDigest: replyContentDigest({ body: "Different synthetic body" }) }, provider);
      const receipt = await capture(request);
      assert.equal(receipt.status, "CONFLICT");
      const stored = await db.message.findUniqueOrThrow({ where: { id: request.incoming.id } });
      assert.equal(stored.body, "Synthetic reply");
      assert.equal(stored.metaReplySnapshot, request.incoming.metaReplySnapshot);
      assert(stored.metaReplyConflictSnapshot);
    });
    await t.test("pending batches are bounded, cursor-based, idempotent and concurrency-safe", async () => {
      await service.processBatch({ ...scope, limit: 50 });
      const requests = [await input(recent.providerMessageId), await input(recent.providerMessageId), await input(recent.providerMessageId)];
      const first = await service.processBatch({ ...scope, limit: 1 });
      assert.equal(first.scanned, 1); assert(first.hasMore); assert(first.nextCursor);
      await Promise.all([service.processBatch({ ...scope, limit: 2 }), service.processBatch({ ...scope, limit: 2 })]);
      await service.processBatch({ ...scope, limit: 50 });
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: { in: requests.map(r => r.incoming.id) } } }), 3);
      assert.equal((await service.processBatch({ ...scope, limit: 50 })).scanned, 0);
      assert.equal((await service.processBatch({ companyId: foreign.id, channelId: channel.id, limit: 50 })).scanned, 0);
      const lateRequest = await input("batch-late" + suffix);
      await service.processBatch({ ...scope, limit: 50 });
      await campaign("batch-late");
      await service.processBatch({ ...scope, reconcile: true, limit: 50 });
      assert.equal((await db.chatbotReplyCorrelation.findUniqueOrThrow({ where: { inboundMessageId: lateRequest.incoming.id } })).status, "CONFIRMED");
    });
    await t.test("failed message/snapshot INSERT does not leave a message or consume an event", async () => {
      const before = await db.message.count();
      await assert.rejects(persistInboundMessage(db, { conversationId: "nonexistent", direction: "inbound", body: "Synthetic failure", providerMessageId: "fail" + suffix },
        { ...scope, contactId: contact.id, senderPhone: contact.phone, metadata: readMetaReplyMetadata({ type: "text" }) }));
      assert.equal(await db.message.count(), before);
    });
    await t.test("a failed correlation stays pending and does not stop the next batch item", async () => {
      await service.processBatch({ ...scope, limit: 50 });
      const requests = [await input(recent.providerMessageId), await input(recent.providerMessageId)];
      let failed = false;
      const faulty = new Proxy(db, { get(target, key) {
        if (key === "$transaction") return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { timeout?: number; maxWait?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) =>
          target.$transaction(tx => operation(new Proxy(tx, { get(inner, name) {
            if (name === "message") return new Proxy(inner.message, { get(delegate, method) {
              if (method === "findMany") return (args: Prisma.MessageFindManyArgs) => {
                if (args.where?.direction === "outbound" && !failed) { failed = true; throw new Error("SYNTHETIC_CORRELATION_FAILURE"); }
                return delegate.findMany(args);
              };
              const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
            } });
            const value = Reflect.get(inner, name); return typeof value === "function" ? value.bind(inner) : value;
          } })), options);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const result = await createMetaReplyCorrelation(faulty, { provider }).processBatch({ ...scope, limit: 2 });
      assert.equal(result.scanned, 2); assert.equal(result.processed, 1); assert.equal(result.errors.length, 1);
      assert.equal(await db.message.count({ where: { id: { in: requests.map(r => r.incoming.id) }, metaReplySnapshot: { not: null } } }), 2);
      await service.processBatch({ ...scope, limit: 50 });
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: { in: requests.map(r => r.incoming.id) } } }), 2);
    });
    await t.test("processing racing a conflicting replay cannot leave confirmed evidence current", async () => {
      const request = await input(recent.providerMessageId);
      await Promise.allSettled([capture(request), preserveReplyReplay(db, request.incoming, { ...request, contextProviderMessageId: old.providerMessageId }, provider)]);
      // A bounded ingestion conflict may require an explicit delivery retry.
      await preserveReplyReplay(db, request.incoming, { ...request, contextProviderMessageId: old.providerMessageId }, provider);
      assert.equal((await capture(request)).status, "CONFLICT");
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: request.incoming.id } }), 1);
    });
    if (provider === "postgresql") await t.test("a 20-second database operation is cancelled server-side, outside the webhook", async () => {
      const request = await input(recent.providerMessageId);
      let attempts = 0;
      const slow = new Proxy(db, { get(target, key) {
        if (key === "$transaction") return (operation: (tx: Prisma.TransactionClient) => Promise<unknown>, options: { timeout?: number; maxWait?: number; isolationLevel?: Prisma.TransactionIsolationLevel }) =>
          target.$transaction(tx => operation(new Proxy(tx, { get(inner, name) {
            if (name === "message") return new Proxy(inner.message, { get(delegate, method) {
              if (method === "findMany") return async () => { attempts++; await inner.$queryRawUnsafe("SELECT 1 FROM pg_sleep(20)"); return []; };
              const value = Reflect.get(delegate, method); return typeof value === "function" ? value.bind(delegate) : value;
            } });
            const value = Reflect.get(inner, name); return typeof value === "function" ? value.bind(inner) : value;
          } })), options);
        const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
      } });
      const start = performance.now();
      await assert.rejects(createMetaReplyCorrelation(slow, { provider }).processMessage({ ...scope, messageId: request.incoming.id }));
      const elapsedMs = performance.now() - start;
      console.info(JSON.stringify({ probe: "20-second query", elapsedMs, attempts, webhookWaitsForCorrelation: false }));
      assert.equal(attempts, 1); assert(elapsedMs < 2000);
      assert.equal(await db.chatbotReplyCorrelation.count({ where: { inboundMessageId: request.incoming.id } }), 0);
      assert.equal((await capture(request)).status, "CONFIRMED");
    });
    await t.test("single-INSERT ingestion overhead benchmark, not a full HTTP benchmark", async () => {
      const baseline: number[] = []; const snapshot: number[] = [];
      for (let n = 0; n < 45; n++) {
        const basic = async () => {
          const start = performance.now();
          await db.message.create({ data: { conversationId: conversation.id, direction: "inbound", senderType: "customer", body: "Synthetic benchmark", providerMessageId: "baseline-" + n + suffix } });
          if (n >= 5) baseline.push(performance.now() - start);
        };
        const durable = async () => {
          const start = performance.now();
          await input(recent.providerMessageId);
          if (n >= 5) snapshot.push(performance.now() - start);
        };
        if (n % 2) { await basic(); await durable(); } else { await durable(); await basic(); }
      }
      const percentile = (values: number[], p: number) => values.sort((a,b) => a-b)[Math.min(values.length-1, Math.floor(values.length*p))];
      console.info(JSON.stringify({ benchmark: "message INSERT vs atomic snapshot INSERT", provider, samples: 40,
        baselineP50: percentile(baseline,.5), baselineP95: percentile(baseline,.95), snapshotP50: percentile(snapshot,.5), snapshotP95: percentile(snapshot,.95) }));
      assert(percentile(snapshot,.95) < percentile(baseline,.95) + 250);
    });
  } finally {
    // Delete only synthetic companies and their fixtures, never preexisting records.
    await db.chatbotReplyCorrelation.deleteMany({ where: { companyId: { in: companies } } });
    await db.campaignRecipient.deleteMany({ where: { campaign: { companyId: { in: companies } } } });
    await db.campaign.deleteMany({ where: { companyId: { in: companies } } });
    await db.message.deleteMany({ where: { conversation: { contact: { companyId: { in: companies } } } } });
    await db.conversation.deleteMany({ where: { contact: { companyId: { in: companies } } } });
    await db.contact.deleteMany({ where: { companyId: { in: companies } } });
    await db.channel.deleteMany({ where: { companyId: { in: companies } } });
    await db.company.deleteMany({ where: { id: { in: companies } } });
    await db.$disconnect();
  }
});
