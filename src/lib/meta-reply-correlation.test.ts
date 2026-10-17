import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { readMetaReplyMetadata } from "./meta-reply-metadata";
import { parseMetaWebhookMessages } from "./meta-whatsapp";
import { createMetaReplyCorrelation } from "./meta-reply-correlation.service";
import { createReplySnapshot, readReplySnapshot, replyContentDigest } from "./meta-reply-snapshot";
import { persistInboundMessage, preserveReplyReplay, ReplyEvidencePersistenceError } from "./meta-reply-ingestion";
import { REPLY_IMMUTABLE_FIELDS } from "./meta-reply-sqlite-integrity";

const fixtures = [
  { type: "button", button: { payload: "option:yes", text: "Sim" }, expected: "TEMPLATE_BUTTON", id: "option:yes", title: "Sim", body: "Sim" },
  { type: "button", button: { text: "Sim" }, expected: "TEMPLATE_BUTTON", id: null, title: "Sim", body: "Sim" },
  { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "btn:1", title: "Confirmar" } }, expected: "INTERACTIVE_BUTTON", id: "btn:1", title: "Confirmar", body: "Resposta interativa: Confirmar" },
  { type: "interactive", interactive: { type: "list_reply", list_reply: { id: "row:2", title: "Opcao 2" } }, expected: "INTERACTIVE_LIST", id: "row:2", title: "Opcao 2", body: "Resposta interativa: Opcao 2" },
  { type: "text", text: { body: "Resposta livre" }, expected: "TEXT", id: null, title: null, body: "Resposta livre" }
];
test("SQLite immutable columns cover every scalar except the explicit operational allowlist", () => {
  const model = Prisma.dmmf.datamodel.models.find(item => item.name === "ChatbotReplyCorrelation");
  assert(model);
  const expected = model.fields.filter(field => field.kind !== "object" && !["status", "reason", "updatedAt"].includes(field.name)).map(field => field.name).sort();
  assert.deepEqual([...REPLY_IMMUTABLE_FIELDS].sort(), expected);
});
fixtures.forEach((fixture, index) => {
  test("Meta fixture " + index + ": preserves technical identity separately and existing display", () => {
    const raw = { ...fixture, from: "5547999999999", id: "inbound-fixture", timestamp: "1792065600", context: { id: "outbound-fixture" } };
    const result = parseMetaWebhookMessages({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "number-fixture" }, messages: [raw] } }] }] })[0];
    assert.equal(result.body, fixture.body);
    assert.equal(result.contextMessageId, "outbound-fixture");
    assert.equal(result.messageId, "inbound-fixture");
    assert.equal(result.replyMetadata.interactionType, fixture.expected);
    assert.equal(result.replyMetadata.optionId, fixture.id);
    assert.equal(result.replyMetadata.optionTitle, fixture.title);
    assert.equal(result.replyMetadata.sourceTimestamp?.getTime(), 1792065600000);
    if (index === 1) {
      assert.equal(result.replyMetadata.optionIdentity, "TITLE_ONLY");
      assert(result.replyMetadata.limitations.includes("MISSING_OPTION_ID"));
    }
  });
});

test("malformed and unsupported reply metadata is bounded, never fabricated", () => {
  assert.equal(readMetaReplyMetadata({ type: "button", button: { payload: "x".repeat(2049), text: " " } }).optionId, null);
  assert.equal(readMetaReplyMetadata({ type: "text", timestamp: "not-a-timestamp" }).sourceTimestamp, null);
  assert(readMetaReplyMetadata({ type: "interactive", interactive: { type: "unknown" } }).limitations.includes("UNSUPPORTED_INTERACTION"));
  assert.equal(readMetaReplyMetadata(null).interactionType, "OTHER");
});

const base = { companyId: "company", channelId: "channel", conversationId: "conversation", contactId: "contact", providerMessageId: "inbound",
  senderPhone: "5547999999999", contextProviderMessageId: "outbound", contentDigest: replyContentDigest({ body: "Synthetic" }),
  metadata: readMetaReplyMetadata({ type: "button", button: { text: "Never a technical ID" } }) };

test("runtime scope and snapshot validation reject invalid references without touching Prisma", async () => {
  let accesses = 0;
  const db = new Proxy({}, { get() { accesses++; throw new Error("Unexpected database access"); } }) as PrismaClient;
  const service = createMetaReplyCorrelation(db, { provider: "sqlite" });
  for (const key of ["companyId", "channelId", "contactId", "conversationId", "providerMessageId", "senderPhone"]) {
    for (const value of [undefined, null, "", " ", 1, {}, []]) assert.throws(() => createReplySnapshot({ ...base, [key]: value } as typeof base));
  }
  for (const key of ["companyId", "channelId", "messageId"]) {
    for (const value of [undefined, null, "", " ", 1, {}, []]) await assert.rejects(service.processMessage({ companyId: "company", channelId: "channel", messageId: "message", [key]: value } as Parameters<typeof service.processMessage>[0]));
  }
  for (const key of ["companyId", "channelId", "id"]) {
    for (const value of [undefined, null, "", " ", 1]) await assert.rejects(service.refresh({ companyId: "company", channelId: "channel", id: "receipt", [key]: value } as Parameters<typeof service.refresh>[0]));
  }
  for (const limit of [0, -1, 51, NaN, 1.5]) await assert.rejects(service.processBatch({ companyId: "company", channelId: "channel", limit }));
  await assert.rejects(service.processBatch({ companyId: "company", channelId: "channel", afterId: " " }));
  assert.throws(() => createReplySnapshot({ ...base, metadata: undefined } as unknown as typeof base));
  assert.equal(accesses, 0);
});

test("snapshot serialization is canonical, bounded and contains no raw sender phone or text", () => {
  const encoded = createReplySnapshot(base);
  const snapshot = readReplySnapshot(encoded);
  assert.equal(snapshot.providerMessageId, base.providerMessageId);
  assert.equal(snapshot.metadata.optionId, null);
  assert(!encoded.includes(base.senderPhone));
  assert.equal(Buffer.byteLength(encoded) < 24576, true);
  assert.throws(() => readReplySnapshot("x".repeat(24577)));
  assert.throws(() => readReplySnapshot(JSON.stringify({ ...snapshot, senderIdentityHash: "fake" })));
});

test("message INSERT retains original snapshot inside the durable-event transaction", async () => {
  let writes = 0;
  let stored: Record<string, unknown> | undefined;
  const tx = {
    $queryRaw: async () => [{ id: "conversation", contactId: base.contactId, channelId: base.channelId, inboundEventSequence: BigInt("1") }],
    conversation: {
      findFirst: async () => ({ id: "conversation", contactId: base.contactId, channelId: base.channelId, updatedAt: new Date(0), channelRef: { companyId: base.companyId } }),
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => ({ inboundEventSequence: BigInt("1") }),
    },
    message: { create: async ({ data }: { data: Record<string, unknown> }) => { writes++; stored = data; return { ...data, id: "message" }; } },
    conversationInboundEvent: { create: async () => ({ id: "event" }) },
  };
  const db = { $transaction: async (work: (value: unknown) => unknown) => work(tx) } as unknown as PrismaClient;
  const start = performance.now();
  await persistInboundMessage(db, { conversationId: "conversation", providerMessageId: "inbound", direction: "inbound", senderType: "customer", body: "Synthetic" }, base, base.companyId);
  assert.equal(writes, 1);
  assert.equal(readReplySnapshot(stored!.metaReplySnapshot as string).providerMessageId, "inbound");
  assert(performance.now() - start < 1000);
  const failed = { $transaction: async (work: (value: unknown) => unknown) => work({
    ...tx, message: { create: async () => { writes++; throw new Error("SYNTHETIC_STORAGE_FAILURE"); } },
  }) } as unknown as PrismaClient;
  await assert.rejects(persistInboundMessage(failed, { conversationId: "conversation", providerMessageId: "inbound", direction: "inbound", body: "Synthetic" }, base, base.companyId), /SYNTHETIC_STORAGE_FAILURE/);
  assert.equal(writes, 2);
});

test("webhook has no correlation consumer, async fire-and-forget or campaign resolution", () => {
  const route = readFileSync("src/app/api/webhooks/whatsapp/route.ts", "utf8");
  assert.doesNotMatch(route, /createMetaReplyCorrelation|captureMetaReplySafely|processBatch|Promise\.race|waitUntil/);
  assert.match(route, /processInboundMessage\(\{ \.\.\.input, provenance: capability \}\)/);
  assert.match(readFileSync("src/lib/meta-inbound-provenance.ts", "utf8"), /replyMetadata: message.replyMetadata/);
  assert.match(route, /ReplyEvidencePersistenceError/);
  assert.match(route, /status: 503/);
  const inbound = readFileSync("src/lib/inbound-message.ts", "utf8");
  assert.match(inbound, /persistInboundMessage\(prisma/);
  assert.match(inbound, /void maybeSendAutomaticAiReply/);
});

test("timeouts are not retried by the explicit processor", async () => {
  let attempts = 0;
  const db = { $transaction: async (_op: unknown, options: { timeout: number }) => {
    attempts++; assert.equal(options.timeout, 2000);
    throw new Prisma.PrismaClientKnownRequestError("Synthetic timeout", { code: "P2028", clientVersion: "5.22.0" });
  } } as unknown as PrismaClient;
  await assert.rejects(createMetaReplyCorrelation(db, { provider: "sqlite" }).processMessage({ companyId: "company", channelId: "channel", messageId: "message" }));
  assert.equal(attempts, 1);
});

test("conflicting replay persistence failure is retryable, not acknowledged or silently discarded", async () => {
  let attempts = 0;
  const db = { $transaction: async (_op: unknown, options: { timeout: number; maxWait: number }) => {
    attempts++; assert.equal(options.timeout, 200); assert.equal(options.maxWait, 50); throw new Error("Synthetic timeout");
  } } as unknown as PrismaClient;
  const existing = { id: "message", conversationId: "conversation", metaReplySnapshot: createReplySnapshot(base), metaReplyConflictSnapshot: null };
  await assert.rejects(preserveReplyReplay(db, existing, { ...base, contextProviderMessageId: "different" }, "sqlite"), ReplyEvidencePersistenceError);
  assert.equal(attempts, 1);
  await preserveReplyReplay(db, existing, base, "sqlite");
  assert.equal(attempts, 1, "An identical replay does not write at all");
});

for (const scenario of [
  { name: "multiple outbound candidates", sources: 2, recipients: 1, status: "AMBIGUOUS", reason: "MULTIPLE_SOURCE_MESSAGES" },
  { name: "multiple campaign candidates", sources: 1, recipients: 2, status: "AMBIGUOUS", reason: "MULTIPLE_CAMPAIGN_RECIPIENTS" },
  { name: "insufficient proof", sources: 0, recipients: 1, status: "NOT_FOUND", reason: "SOURCE_NOT_FOUND" },
  { name: "conflicting conversation ID", sources: 1, recipients: 1, otherConversation: true, status: "CONFLICT", reason: "SOURCE_CONVERSATION_MISMATCH" },
  { name: "historical destination mismatch", sources: 1, recipients: 1, otherPhone: true, status: "CONFLICT", reason: "DESTINATION_PHONE_MISMATCH" },
  { name: "missing historical destination", sources: 1, recipients: 1, missingPhone: true, status: "CONFLICT", reason: "MISSING_DESTINATION_PHONE" },
  { name: "two historical flow versions", sources: 1, recipients: 1, versions: 2, status: "CONFIRMED", reason: "EXACT_PROVIDER_CHAIN" },
  { name: "one explicit historical version", sources: 1, recipients: 1, versions: 1, status: "CONFIRMED", reason: "EXACT_PROVIDER_CHAIN" }
]) {
  test("CI executes: " + scenario.name, async () => {
    const tx = {
      message: {
        findFirst: async () => ({ id: "message", conversationId: "conversation", providerMessageId: "inbound", metaReplySnapshot: createReplySnapshot(base), metaReplyConflictSnapshot: null, conversation: { contactId: "contact" } }),
        findMany: async ({ where }: { where: { providerMessageId: string; direction: string; conversation: { channelId: string; contact: { companyId: string } } } }) => {
          assert.equal(where.providerMessageId, "outbound"); assert.equal(where.direction, "outbound");
          assert.deepEqual(where.conversation, { channelId: "channel", contact: { companyId: "company" } });
          return Array.from({ length: scenario.sources }, () => ({ id: "source", conversationId: scenario.otherConversation ? "other" : "conversation", templateName: "template", templateLanguage: "pt_BR" }));
        }
      },
      campaignRecipient: { findMany: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { providerMessageId: "outbound", campaign: { companyId: "company", channelId: "channel" } });
        return Array.from({ length: scenario.recipients }, () => ({ id: "recipient", campaignId: "campaign", contactId: "contact", conversationId: "conversation", phone: scenario.missingPhone ? "" : scenario.otherPhone ? "5547888888888" : "5547999999999" }));
      } },
      chatbotSession: { groupBy: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, { companyId: "company", channelId: "channel", contactId: "contact", conversationId: "conversation", campaignId: "campaign", campaignRecipientId: "recipient" });
        return Array.from({ length: scenario.versions ?? 0 }, (_, i) => ({ flowId: "flow", flowVersionId: "version-" + i }));
      } },
      chatbotReplyCorrelation: { findUnique: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "receipt", ...data }) }
    };
    const db = { $transaction: async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx) } as unknown as PrismaClient;
    const receipt = await createMetaReplyCorrelation(db, { provider: "sqlite" }).processMessage({ companyId: "company", channelId: "channel", messageId: "message" });
    assert(receipt); assert.equal(receipt.status, scenario.status); assert.equal(receipt.reason, scenario.reason);
    if (scenario.versions) assert.equal(receipt.flowCandidateStatus, scenario.versions === 1 ? "IDENTIFIED" : "AMBIGUOUS");
  });
}
