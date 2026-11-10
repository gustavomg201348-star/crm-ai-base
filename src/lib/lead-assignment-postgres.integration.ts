import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Module, { createRequire } from "node:module";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createConversationAuthorityService } from "./conversation-authority.service";

// Explicitly disposable CI database only. Fail before constructing a client.
const url = new URL(process.env.DATABASE_URL ?? "file:invalid");
if (process.env.LEAD_ASSIGNMENT_POSTGRES_TEST !== "1" || process.env.CI !== "true"
  || url.protocol !== "postgresql:" || !["localhost", "127.0.0.1"].includes(url.hostname)
  || !["5432", "55432"].includes(url.port) || url.pathname !== "/qevora_ci"
  || url.username !== "qevora_ci" || url.password !== "qevora_ci_password" || url.search !== "?schema=public" || url.hash) {
  throw Error("DISPOSABLE_ASSIGNMENT_DATABASE_REQUIRED");
}
const db = new PrismaClient({ log: [] });
const originalFetch = globalThis.fetch;
let assignment: typeof import("./lead-assignment");
let inbound: typeof import("./inbound-message");
before(() => {
  globalThis.fetch = async () => { throw Error("EXTERNAL_NETWORK_FORBIDDEN"); };
  const loader = Module as typeof Module & { _load(name: string, ...args: unknown[]): unknown };
  const original = loader._load;
  loader._load = (name, ...args) => {
    if (name === "server-only") return {};
    if (name === "@/lib/db") return { prisma: db };
    if (name === "@/lib/ai-attendant.service") return { maybeSendAutomaticAiReply: async () => null };
    if (name === "@/lib/notification-stream") return { publishInboundNotification() {} };
    if (name === "@/lib/notifications") return { createInboundMessageNotification: async () => ({}), mapNotification: () => ({}) };
    if (name === "@/lib/safe-logger") return { safeLogError() {}, safeLogWarn() {}, safeLogInfo() {} };
    return original.call(loader, name, ...args);
  };
  try {
    const require = createRequire(import.meta.url);
    assignment = require("./lead-assignment"); inbound = require("./inbound-message");
  } finally { loader._load = original; }
});
after(async () => { globalThis.fetch = originalFetch; await db.$disconnect(); });

async function fixture({ role = "AGENT", status = "ONLINE", mode = "ROUND_ROBIN", onlineOnly = true,
  limit = null as number | null, existing = true } = {}) {
  const company = await db.company.create({ data: { name: "Synthetic assignment test", aiMode: "COPILOT" } });
  const admin = await db.user.create({ data: { companyId: company.id, name: "Synthetic admin", email: randomUUID()+"@invalid.test", passwordHash: "synthetic", role: "ADMIN" } });
  const user = await db.user.create({ data: { companyId: company.id, name: "Synthetic attendant", email: randomUUID()+"@invalid.test", passwordHash: "synthetic", role } });
  await assignment.setAttendantStatus({ companyId: company.id, userId: user.id, status: status as import("./lead-assignment").AvailabilityStatus });
  await db.leadAssignmentSetting.create({ data: { companyId: company.id, mode, onlineOnly, maxOpenPerAttendant: limit } });
  const contact = await db.contact.create({ data: { companyId: company.id, name: "Synthetic customer", phone: "5511987654321", normalizedPhone: "5511987654321" } });
  const channel = await db.channel.create({ data: { companyId: company.id, name: "Synthetic channel", type: "whatsapp", provider: "meta", status: "ACTIVE" } });
  const conversation = existing ? await db.conversation.create({ data: { contactId: contact.id, channelId: channel.id, channel: "whatsapp", status: "PENDING" } }) : null;
  const target = { companyId: company.id, conversationId: conversation?.id ?? "missing" };
  const receive = (providerMessageId = randomUUID()) => inbound.processInboundMessage({ companyId: company.id, channelId: channel.id,
    phone: contact.phone, body: "Synthetic inbound", providerMessageId });
  return { company, admin, user, contact, channel, conversation, target, receive };
}

test("ONLINE + ROUND_ROBIN: new inbound conversation is really assigned", async () => {
  const f = await fixture({ existing: false }); const result = await f.receive();
  assert.equal(result.agent?.id, f.user.id);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: result.id } })).agentId, f.user.id);
  assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: result.id } }), 1);
});
test("existing unassigned conversation receives an owner on a new inbound; replay is idempotent", async () => {
  const f = await fixture(); const event = randomUUID(); const result = await f.receive(event);
  assert.equal(result.id, f.conversation!.id); assert.equal(result.agent?.id, f.user.id);
  await f.receive(event); await f.receive();
  assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: result.id } }), 1);
  assert.equal(await db.conversation.count({ where: { contactId: f.contact.id } }), 1);
});
for (const status of ["PAUSED", "OFFLINE", "BUSY"]) for (const onlineOnly of [true, false]) {
  test(status + " never receives automatic work; onlineOnly=" + onlineOnly, async () => {
    const f = await fixture({ status, onlineOnly }); await f.receive();
    assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } })).agentId, null);
    assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: f.conversation!.id } }), 0);
  });
}
for (const role of ["ADMIN", "SUPERVISOR", "AGENT"]) test(role + " ONLINE is operationally eligible", async () => {
  const f = await fixture({ role }); assert.equal((await assignment.maybeAutoAssignConversation(f.target))?.agent?.id, f.user.id);
});
for (const mode of ["CLAIM_FIRST", "ADMIN_MANUAL"]) test(mode + " does not autoassign on inbound", async () => {
  const f = await fixture({ mode }); assert.equal((await f.receive()).agent, null);
  assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: f.conversation!.id } }), 0);
});
test("existing owner and native authority are never redistributed", async () => {
  const f = await fixture(); await assignment.assignConversationToUser({ ...f.target, assignedToUserId: f.admin.id });
  await createConversationAuthorityService({ db, provider: "postgresql" }).initialize({ ...f.target, channelId: f.channel.id,
    actorUserId: f.admin.id, logicalKey: randomUUID(), reason: "SYNTHETIC", state: "HUMAN", ownerUserId: f.admin.id });
  const authorityBefore = await db.conversationAuthority.findUniqueOrThrow({ where: { conversationId: f.conversation!.id } });
  const before = await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } });
  await f.receive();
  assert.deepEqual(await db.conversationAuthority.findUniqueOrThrow({ where: { id: authorityBefore.id } }), authorityBefore); assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: before.id } })).agentId, f.admin.id);
  assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: before.id } }), 1);
});
for (const limit of [0, 1]) test("maxOpenPerAttendant=" + limit + " is enforced", async () => {
  const f = await fixture({ limit });
  if (limit) {
    const other = await db.contact.create({ data: { companyId: f.company.id, name: "Synthetic workload", phone: "5511987654322" } });
    await db.conversation.create({ data: { contactId: other.id, channelId: f.channel.id, agentId: f.user.id, status: "OPEN" } });
  }
  assert.equal(await assignment.maybeAutoAssignConversation(f.target), null);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } })).agentId, null);
});
test("status changes affect the next real assignment, not only the displayed presence", async () => {
  const f = await fixture({ status: "PAUSED" }); await f.receive();
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } })).agentId, null);
  await assignment.setAttendantStatus({ companyId: f.company.id, userId: f.user.id, status: "ONLINE" });
  assert.equal((await f.receive()).agent?.id, f.user.id);
});
test("two concurrent attempts assign once and write one history record", async () => {
  const f = await fixture(); const results = await Promise.all([assignment.maybeAutoAssignConversation(f.target), assignment.maybeAutoAssignConversation(f.target)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await db.leadAssignmentHistory.count({ where: { conversationId: f.conversation!.id } }), 1);
});
test("concurrent conversations cannot exceed a single available capacity slot", async () => {
  const f = await fixture({ limit: 1 });
  const contact = await db.contact.create({ data: { companyId: f.company.id, name: "Synthetic other customer", phone: "5511987654322" } });
  const other = await db.conversation.create({ data: { contactId: contact.id, channelId: f.channel.id, status: "PENDING" } });
  await Promise.all([assignment.maybeAutoAssignConversation(f.target), assignment.maybeAutoAssignConversation({ companyId: f.company.id, conversationId: other.id })]);
  assert.equal(await db.conversation.count({ where: { contact: { companyId: f.company.id }, agentId: f.user.id } }), 1);
});
test("native authority handoff remains atomic with the assignment", async () => {
  const f = await fixture();
  await createConversationAuthorityService({ db, provider: "postgresql" }).initialize({ ...f.target, channelId: f.channel.id,
    actorUserId: f.admin.id, logicalKey: randomUUID(), reason: "SYNTHETIC", state: "HUMAN_QUEUE" });
  await f.receive(); const a = await db.conversationAuthority.findUniqueOrThrow({ where: { conversationId: f.conversation!.id } });
  assert.equal(a.state, "HUMAN"); assert.equal(a.ownerUserId, f.user.id); assert.equal(a.generation, BigInt(1));
  await f.receive(); assert.equal((await db.conversationAuthority.findUniqueOrThrow({ where: { id: a.id } })).generation, a.generation);
});
test("foreign tenant and missing conversation cannot be assigned", async () => {
  const f = await fixture(), foreign = await fixture();
  assert.equal(await assignment.maybeAutoAssignConversation({ companyId: foreign.company.id, conversationId: f.conversation!.id }), null);
  assert.equal(await assignment.maybeAutoAssignConversation({ companyId: f.company.id, conversationId: "missing" }), null);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } })).agentId, null);
});

test("missing presence is never treated as ONLINE", async () => {
  const f = await fixture(); await db.userAvailability.delete({ where: { userId: f.user.id } });
  assert.equal(await assignment.maybeAutoAssignConversation(f.target), null);
});
test("PAUSED stops new assignments without taking away an existing conversation", async () => {
  const f = await fixture(); await f.receive();
  await assignment.setAttendantStatus({ companyId: f.company.id, userId: f.user.id, status: "PAUSED" });
  const contact = await db.contact.create({ data: { companyId: f.company.id, name: "Synthetic next customer", phone: "5511987654323" } });
  const other = await inbound.processInboundMessage({ companyId: f.company.id, channelId: f.channel.id, phone: contact.phone,
    body: "Synthetic next inbound", providerMessageId: randomUUID() });
  assert.equal(other.agent, null);
  assert.equal((await db.conversation.findUniqueOrThrow({ where: { id: f.conversation!.id } })).agentId, f.user.id);
});
