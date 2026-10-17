import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createInboundMessageWithDurableEvent, inboundEventTransaction, InboundEventError } from "./conversation-inbound-event";
import { assertInboundEventTestDatabase } from "./conversation-inbound-event-test.guard";

const root = "src/lib/conversation-inbound-event.ts";
type Row = { id: string; conversationId: string; providerMessageId?: string; direction: string };
function fixture() {
  let state = { sequence: BigInt("0"), messages: [] as Row[], events: [] as Record<string, unknown>[] };
  let tail: Promise<unknown> = Promise.resolve();
  let failEvent = false;
  let observed = false;
  const tx = {
    $queryRaw: async (query: Prisma.Sql) => {
      if (query.values[2] !== "company" || state.sequence >= BigInt("9223372036854775807")
        || (query.values.length > 4 && (query.values[4] !== "contact" || query.values[5] !== null))) return [];
      state.sequence++;
      return [{ id: "conversation", contactId: "contact", channelId: null, inboundEventSequence: state.sequence }];
    },
    conversation: {
      findFirst: async (args: { where: { contact: { companyId: string } } }) => args.where.contact.companyId === "company"
        ? { id: "conversation", contactId: "contact", channelId: null, inboundEventSequence: state.sequence } : null,
      updateMany: async () => { if (state.sequence >= BigInt("9223372036854775807")) return { count: 0 }; state.sequence++; return { count: 1 }; },
      findUniqueOrThrow: async () => ({ inboundEventSequence: state.sequence }),
    },
    message: { create: async ({ data }: { data: Row }) => {
      if (data.providerMessageId && state.messages.some(row => row.providerMessageId === data.providerMessageId)) {
        throw new Prisma.PrismaClientKnownRequestError("synthetic unique", { code: "P2002", clientVersion: "5.22.0", meta: { target: ["providerMessageId"] } });
      }
      const row = { ...data, id: "message-" + (state.messages.length + 1) }; state.messages.push(row); return row;
    } },
    conversationInboundEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
      observed = state.messages.length > 0 && state.sequence > BigInt("0");
      if (failEvent) throw new Error("SYNTHETIC_EVENT_FAILURE");
      state.events.push(data); return data;
    } },
  };
  const db = { $transaction: async (work: (value: typeof tx) => Promise<unknown>) => {
    const run = tail.then(async () => { const previous = structuredClone(state); try { return await work(tx); } catch (error) { state = previous; throw error; } });
    tail = run.catch(() => undefined); return run;
  } } as unknown as Pick<PrismaClient, "$transaction">;
  const write = (providerMessageId: string, companyId = "company") => inboundEventTransaction(db,
    inner => createInboundMessageWithDurableEvent(inner, companyId, { conversationId: "conversation", direction: "inbound", senderType: "customer", body: "Synthetic private text", providerMessageId }));
  return { db, tx, write, state: () => state, fail: () => { failEvent = true; }, observed: () => observed, exhaust: () => { state.sequence = BigInt("9223372036854775807"); } };
}
test("initial sequence, monotonic allocation, exact linkage and no copied content", async () => {
  const f = fixture(); const a = await f.write("a"); const b = await f.write("b");
  assert.equal(f.state().sequence, BigInt("2"));
  assert.deepEqual(f.state().events.map(row => row.sequence), [BigInt("1"), BigInt("2")]);
  assert.deepEqual(f.state().events.map(row => row.messageId), [a.id, b.id]);
  assert.deepEqual(Object.keys(f.state().events[0]).sort(), ["companyId", "contactId", "channelId", "conversationId", "messageId", "sequence"].sort());
  assert.equal(f.state().events[0].channelId, null);
});
test("same provider ID race loses atomically and consumes only one sequence", async () => {
  const f = fixture(); const results = await Promise.allSettled([f.write("same"), f.write("same")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.ok(failure?.status === "rejected" && failure.reason.code === "P2002");
  assert.equal(f.state().messages.length, 1); assert.equal(f.state().events.length, 1);
  assert.equal(f.state().sequence, BigInt("1"));
  await f.write("next"); assert.equal(f.state().events[1].sequence, BigInt("2"));
});
test("distinct concurrent messages allocate distinct consecutive local sequences", async () => {
  const f = fixture(); await Promise.all([f.write("a"), f.write("b")]);
  assert.deepEqual(f.state().events.map(row => row.sequence), [BigInt("1"), BigInt("2")]);
});
test("event failure rolls back the observed Message and counter", async () => {
  const f = fixture(); f.fail(); await assert.rejects(f.write("a"), /SYNTHETIC_EVENT_FAILURE/);
  assert.equal(f.observed(), true); assert.equal(f.state().sequence, BigInt("0"));
  assert.equal(f.state().messages.length, 0); assert.equal(f.state().events.length, 0);
});
test("cross-company and outbound input fail before writes", async () => {
  const f = fixture(); await assert.rejects(f.write("a", "other"), InboundEventError);
  await assert.rejects(createInboundMessageWithDurableEvent(f.tx as unknown as Prisma.TransactionClient, "company", {
    conversationId: "conversation", direction: "outbound", body: "Synthetic",
  }), InboundEventError);
  assert.equal(f.state().sequence, BigInt("0"));
});
test("exhausted counter fails closed without Message/Event", async () => {
  const f = fixture(); f.exhaust(); await assert.rejects(f.write("a"), error => error instanceof InboundEventError && error.code === "SEQUENCE_EXHAUSTED");
  assert.equal(f.state().messages.length, 0);
});
test("expected snapshot binding cannot override or disagree with persisted scope", async () => {
  const f = fixture();
  for (const binding of [{ contactId: "wrong", channelId: null }, { contactId: "contact", channelId: "wrong" }]) {
    await assert.rejects(inboundEventTransaction(f.db, tx => createInboundMessageWithDurableEvent(tx, "company", {
      conversationId: "conversation", direction: "inbound", body: "Synthetic",
    }, binding)), error => error instanceof InboundEventError && error.code === "INVALID_SCOPE");
  }
  assert.equal(f.state().sequence, BigInt("0")); assert.equal(f.state().messages.length, 0);
});
test("only bounded serialization retries, no retries of uniqueness or arbitrary failures", async () => {
  for (const [code, sqlState, expectedCalls] of [
    ["P2034", "", 4], ["P1008", "", 4], ["P2028", "", 4], ["P2002", "", 1], ["P2003", "", 1],
    ["P2010", "40001", 4], ["P2010", "40P01", 4], ["P2010", "23514", 1],
  ] as const) {
    let calls = 0;
    const db = { $transaction: async () => { calls++; throw new Prisma.PrismaClientKnownRequestError("synthetic", { code, clientVersion: "5.22.0", meta: { code: sqlState } }); } } as unknown as PrismaClient;
    await assert.rejects(inboundEventTransaction(db, async () => null));
    assert.equal(calls, expectedCalls);
  }
});
test("schema parity and additive no-backfill migration", () => {
  const sqlite = readFileSync("prisma/schema.prisma", "utf8"); const pg = readFileSync("prisma/schema.postgres.prisma", "utf8");
  const model = (schema: string) => schema.match(/model ConversationInboundEvent \{[\s\S]*?\n\}/)![0].replace(/, map: "[^"]+"/g, "");
  assert.equal(model(sqlite), model(pg));
  const declaration = model(sqlite);
  for (const forbidden of ["body", "phone", "cpf", "email", "payload", "token", "status", "lease", "attempt", "session"]) assert.doesNotMatch(declaration, new RegExp("\\b" + forbidden + "\\w*\\b", "i"));
  const migration = readFileSync("prisma/migrations/20261017180000_add_conversation_inbound_event/migration.sql", "utf8");
  assert.doesNotMatch(migration.split("\n").filter(line => !line.trim().startsWith("--")).join("\n"), /^\s*(?:INSERT\s+INTO|UPDATE\s+"|DELETE\s+FROM|DROP|TRUNCATE)\b/im);
  assert.match(migration, /IS NOT DISTINCT FROM NEW\."channelId"/);
  assert.match(migration, /m.direction = 'inbound'/);
});
test("writer inventory: exactly the two production ingress adapters use atomic primitive", () => {
  const writes: string[] = [];
  for (const file of readdirSync("src", { recursive: true, encoding: "utf8" })) {
    if (!/\.tsx?$/.test(file) || /(?:\.test|\.integration)\.ts$/.test(file)) continue;
    const normalized = file.replace(/\\/g, "/");
    const source = readFileSync("src/" + file, "utf8");
    if (/\.message\.(?:create|createMany|upsert)\(/.test(source)) writes.push(normalized);
    if (normalized !== "lib/conversation-inbound-event.ts") assert.doesNotMatch(source, /\.conversationInboundEvent\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\(/);
  }
  assert.deepEqual(writes.sort(), ["app/api/channels/[id]/messages/route.ts", "app/api/conversations/[id]/messages/route.ts", "lib/campaigns.ts", "lib/conversation-inbound-event.ts", "lib/conversation-message.service.ts", "lib/message-delivery.ts"].sort());
  for (const file of writes.filter(file => !["lib/conversation-inbound-event.ts", "app/api/conversations/[id]/messages/route.ts"].includes(file))) {
    assert.doesNotMatch(readFileSync("src/" + file, "utf8"), /direction:\s*["']inbound["']/);
  }
  const route = readFileSync("src/app/api/conversations/[id]/messages/route.ts", "utf8");
  assert.match(route, /inboundEventTransaction\(prisma/);
  assert.match(route, /if \(direction === "inbound"\)\s*\{\s*await createInboundMessageWithDurableEvent/);
  assert.match(route, /else\s*\{\s*await tx.message.create/);
  const ingestion = readFileSync("src/lib/meta-reply-ingestion.ts", "utf8");
  assert.match(ingestion, /inboundEventTransaction\(db, tx => createInboundMessageWithDurableEvent/);
  const inbound = readFileSync("src/lib/inbound-message.ts", "utf8");
  assert.match(inbound, /isProviderMessageIdUniqueViolation\(error\)/);
  assert.match(inbound, /return mapConversation\(existingMessage.conversation\)/);
  assert.match(inbound, /void maybeSendAutomaticAiReply/);
});
test("no worker, transport, AI or side effects after commit introduced by primitive", () => {
  const source = readFileSync(root, "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|console|OpenCredit|Prospecta|maybeSendAutomaticAiReply|sendMeta|Notification|ChatbotOutbox)\b/);
  assert.doesNotMatch(source, /\.conversationInboundEvent\.(?:update|delete|upsert|createMany)/);
  assert.doesNotMatch(source, /MAX\s*\(/i);
  assert.match(source, /SET "inboundEventSequence" = "inboundEventSequence" \+ 1/);
  assert.match(source, /RETURNING "id", "contactId", "channelId", "inboundEventSequence"/);
});
const good = { CI: "true", GITHUB_ACTIONS: "true", INBOUND_EVENT_POSTGRES_TEST: "1", DATABASE_URL: "postgresql://qevora_ci:qevora_ci_password@127.0.0.1:5432/qevora_ci?schema=public" };
test("material PostgreSQL guard accepts only exact disposable CI context", () => {
  assert.equal(assertInboundEventTestDatabase(good), "postgresql");
  for (const key of Object.keys(good)) assert.throws(() => assertInboundEventTestDatabase({ ...good, [key]: "" }));
  for (const url of [good.DATABASE_URL.replace("127.0.0.1", "remote.invalid"), good.DATABASE_URL + "&host=remote.invalid", good.DATABASE_URL.replace("qevora_ci?", "production?"), good.DATABASE_URL.replace(":5432", ":9999"), good.DATABASE_URL + "#x"])
    assert.throws(() => assertInboundEventTestDatabase({ ...good, DATABASE_URL: url }));
});
