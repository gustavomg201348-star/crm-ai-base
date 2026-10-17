import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { shadowMode, type ShadowAuthority, type ShadowContext, type ShadowMetric } from "./authority-text-shadow-contract";
import { evaluateTextAuthority } from "./authority-text-shadow-evaluator";
import { createTextAuthorityObserver } from "./authority-text-shadow";
import { createInboundMessageWithDurableEvent, inboundEventTransaction } from "./conversation-inbound-event";

const context: ShadowContext = { companyId: "company", channelId: "channel", conversationId: "conversation",
  actorUserId: "actor", assignedUserId: "actor", source: "CHANNEL_TEXT", intentId: null };
const authority: ShadowAuthority = { companyId: "company", channelId: "channel", conversationId: "conversation",
  ownerUserId: "actor", state: "HUMAN", generation: BigInt(2) };
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("OFF is default and neither reads nor emits, even with invalid input", async () => {
  for (const value of [undefined, null, "", "OFF", "shadow", "ENFORCE", true]) {
    assert.equal(shadowMode(value), "OFF");
    const observer = createTextAuthorityObserver({ mode: () => value,
      read: async () => { assert.fail("read in OFF"); }, emit: () => assert.fail("metric in OFF") });
    assert.equal(observer({}, null as never), undefined);
  }
  await tick();
});

test("pure evaluator covers eligibility, scope, owner, assignment, state and generation without mutation", () => {
  assert.equal(evaluateTextAuthority(context, authority).result, "COMPATIBLE");
  assert.equal(evaluateTextAuthority(context, null).result, "AUTHORITY_ABSENT");
  assert.equal(evaluateTextAuthority({ ...context, conversationId: null }, null).reason, "CONVERSATION_UNAVAILABLE");
  assert.equal(evaluateTextAuthority(context, { ...authority, ownerUserId: "other" }).result, "OWNER_MISMATCH");
  assert.equal(evaluateTextAuthority({ ...context, assignedUserId: "other" }, authority).reason, "ASSIGNMENT_DIFFERS");
  for (const field of ["companyId", "channelId", "conversationId"] as const) {
    assert.deepEqual(evaluateTextAuthority(context, { ...authority, [field]: "foreign-sensitive" }),
      { result: "SCOPE_MISMATCH", reason: "SCOPE_DIFFERS", state: null });
  }
  for (const state of ["AI", "CHATBOT", "HUMAN_QUEUE", "CLOSED"]) {
    assert.equal(evaluateTextAuthority(context, { ...authority, state, ownerUserId: null }).result, "STATE_INELIGIBLE");
  }
  assert.equal(evaluateTextAuthority({ ...context, expectedGeneration: BigInt(1) }, authority).result, "GENERATION_MISMATCH");
  assert.equal(evaluateTextAuthority({ ...context, expectedGeneration: BigInt(2) }, authority).result, "COMPATIBLE");
  for (const generation of [-BigInt(1), BigInt("9223372036854775808"), 2, null]) {
    assert.equal(evaluateTextAuthority(context, { ...authority, generation } as never).result, "EVALUATION_ERROR");
  }
  for (const bad of [undefined, null, "", " ", 4, false]) {
    assert.equal(evaluateTextAuthority({ ...context, companyId: bad } as never, authority).result, "EVALUATION_ERROR");
  }
  assert.equal(evaluateTextAuthority(context, { ...authority, state: "secret-invalid" }).state, null);
  assert.deepEqual(authority, { companyId: "company", channelId: "channel", conversationId: "conversation",
    ownerUserId: "actor", state: "HUMAN", generation: BigInt(2) });
});

test("one request performs one scoped read and one sanitized event; identifiers never become labels", async () => {
  const metrics: ShadowMetric[] = [];
  const reads: unknown[] = [];
  const observe = createTextAuthorityObserver({ mode: () => "SHADOW", read: async scope => {
    reads.push(scope); return { ...authority, companyId: "foreign-secret-company" };
  }, emit: metric => metrics.push(metric) });
  const request = {};
  observe(request, { ...context, intentId: "sensitive-intent" });
  observe(request, context);
  await tick();
  assert.deepEqual(reads, [{ companyId: "company", channelId: "channel", conversationId: "conversation" }]);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].result, "SCOPE_MISMATCH");
  assert.equal(metrics[0].state, null);
  assert.deepEqual(Object.keys(metrics[0]).sort(), ["durationMs", "event", "reason", "result", "source", "state"]);
  assert.doesNotMatch(JSON.stringify(metrics), /foreign-secret|sensitive-intent|actor|companyId|channelId|conversationId/);
});

test("absent conversation and invalid scope never query; snapshots cannot change after scheduling", async () => {
  let reads = 0;
  const metrics: ShadowMetric[] = [];
  const observe = createTextAuthorityObserver({ mode: () => "SHADOW", read: async scope => {
    reads++; assert.equal(scope.companyId, "company"); return authority;
  }, emit: metric => metrics.push(metric) });
  observe({}, { ...context, conversationId: null });
  observe({}, { ...context, companyId: undefined } as never);
  const mutable = { ...context };
  observe({}, mutable);
  mutable.companyId = "changed";
  await tick();
  assert.equal(reads, 1);
  assert.deepEqual(metrics.map(item => item.result), ["AUTHORITY_ABSENT", "COMPATIBLE"]);
});

test("reader, configuration and logger exceptions cannot escape or leak errors", async () => {
  const metrics: ShadowMetric[] = [];
  createTextAuthorityObserver({ mode: () => "SHADOW", read: () => { throw new Error("secret-phone-cpf-token"); },
    emit: metric => { metrics.push(metric); throw new Error("logger unavailable"); } })({}, context);
  createTextAuthorityObserver({ mode: () => { throw new Error("bad config"); }, read: async () => authority,
    emit: () => assert.fail("config failed") })({}, context);
  await tick();
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].reason, "READ_FAILED");
  assert.doesNotMatch(JSON.stringify(metrics), /secret-phone|token|stack/);
});

test("slow reads never delay callers; timeout emits once and late reads retain bounded capacity", async () => {
  let reads = 0;
  const releases: Array<(row: ShadowAuthority) => void> = [];
  const metrics: ShadowMetric[] = [];
  const observe = createTextAuthorityObserver({ mode: () => "SHADOW", read: async () => {
    reads++; return new Promise(resolve => releases.push(resolve));
  }, emit: metric => metrics.push(metric) });
  for (let i = 0; i < 8; i++) assert.equal(observe({}, context), undefined);
  await tick();
  assert.equal(reads, 4);
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(metrics.filter(item => item.reason === "TIME_BUDGET").length, 4);
  observe({}, context);
  await tick();
  assert.equal(reads, 4);
  for (const release of releases) release(authority);
  await tick();
  assert.equal(metrics.length, 9);
  observe({}, context);
  await tick();
  assert.equal(reads, 5);
  releases[4](authority);
  await tick();
});

// Execute the real route bodies in memory; every dependency is explicit and fake.
function loadRoute(source: string, mocks: Record<string, unknown>) {
  const compiled = ts.transpileModule(readFileSync(source, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const loaded = { exports: {} as { POST: (request: object, params: unknown) => Promise<Response> } };
  new Function("require", "module", "exports", compiled)((name: string) => {
    assert(name in mocks, `Unexpected route dependency: ${name}`);
    return mocks[name];
  }, loaded, loaded.exports);
  return loaded.exports.POST;
}

async function routeScenario(channel: boolean, mode: "OFF" | "SHADOW", row: ShadowAuthority | null | "error" | "pending",
  options: { denied?: boolean; failed?: boolean; inbound?: boolean } = {}) {
  const metrics: ShadowMetric[] = [];
  let reads = 0;
  const effects: string[] = [];
  const observe = createTextAuthorityObserver({ mode: () => mode, read: async scope => {
    reads++; assert.deepEqual(scope, { companyId: "company", channelId: "channel", conversationId: "conversation" });
    if (row === "error") throw new Error("secret provider error");
    if (row === "pending") return new Promise<ShadowAuthority | null>(() => {});
    return row;
  }, emit: metric => metrics.push(metric) });
  const conversation = { id: "conversation", agentId: "actor", contactId: "contact", status: "OPEN", contact: { phone: "5500000000000" } };
  const integration = { id: "channel", provider: "meta", phoneNumberId: "fake", accessToken: "fake" };
  const tx = { message: { create: async ({ data }: { data: Record<string, unknown> }) => {
    assert.equal(data.conversationId, conversation.id);
    effects.push("message"); return { id: "synthetic-message" };
  } },
    $queryRaw: async (query: { values: unknown[] }) => {
      assert.deepEqual(query.values, [conversation.id, BigInt("9223372036854775807"), "company", "company"]);
      return [{ id: conversation.id, contactId: conversation.contactId, channelId: integration.id, inboundEventSequence: BigInt(1) }];
    },
    conversationInboundEvent: { create: async ({ data }: { data: Record<string, unknown> }) => {
      assert.deepEqual(data, { companyId: "company", contactId: conversation.contactId, channelId: integration.id,
        conversationId: conversation.id, messageId: "synthetic-message", sequence: BigInt(1) });
      assert.equal(effects.at(-1), "message"); effects.push("inbound-event"); return data;
    } },
    conversation: { update: async () => conversation } };
  class InvalidMessageReplyError extends Error {}
  const mocks = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => new Response(JSON.stringify(body), init) } },
    "@/lib/auth": { getSessionFromRequest: async () => ({ id: "actor", companyId: "company", role: "AGENT" }) },
    "@/lib/authority-text-shadow-runtime": { observeTextOutboundAuthority: observe },
    "@/lib/conversation-inbound-event": { createInboundMessageWithDurableEvent, inboundEventTransaction },
    "@/lib/activities": { createActivity: async () => {} },
    "@/lib/db": { prisma: { conversation: { findFirst: async () => conversation }, channel: { findFirst: async () => integration },
      $transaction: async (fn: (value: typeof tx) => Promise<unknown>, settings?: unknown) => {
        if (options.inbound) assert.deepEqual(settings, { isolationLevel: "Serializable", maxWait: 2000, timeout: 5000 });
        return fn(tx);
      } } },
    "@/lib/channel-secrets": { resolveChannelAccessToken: () => "fake" },
    "@/lib/conversation-channel.service": { conversationMatchesChannel: () => true },
    "@/lib/conversation-lifecycle.service": {}, "@/lib/contacts": { normalizeContactPhone: (phone: string) => phone, getContactNormalizedPhone: (phone: string) => phone },
    "@/lib/conversation-message.service": { getConversationIntegration: async () => ({ conversation, channel: integration }),
      saveOutboundMessage: async () => { effects.push("message"); return conversation; } },
    "@/lib/conversations": { conversationInclude: {}, mapConversation: (value: unknown) => value },
    "@/lib/http-error-response": { publicErrorResponse: ({ status }: { status: number }) => new Response("failure", { status }) },
    "@/lib/message-delivery": { saveFailedOutboundMessage: async () => { effects.push("failed-message"); } },
    "@/lib/meta-whatsapp": { readMetaMessageId: () => "fake-provider-id", sendMetaTextMessage: async () => {
      effects.push("meta"); if (options.failed) throw new Error("fake failure"); return {};
    } },
    "@/lib/permissions": { canAccessConversation: () => !options.denied },
    "@/lib/outbound-message-reply": { InvalidMessageReplyError, resolveOutboundReplyContext: async () => null },
    "@/lib/phone-normalization.service": { digitsOnlyPhone: (phone: string) => phone },
    "@/lib/prisma-errors": {}, "@/lib/safe-logger": { safeLogError: () => {} },
    "@/lib/rate-limit": { enforceRateLimits: async () => null, rateLimitPolicies: { messageSend: {} } }
  };
  const post = loadRoute(`src/app/api/${channel ? "channels" : "conversations"}/[id]/messages/route.ts`, mocks);
  const response = await post({ json: async () => ({ conversationId: "conversation", to: conversation.contact.phone,
    body: "synthetic", companyId: "untrusted-company", ownerUserId: "untrusted-owner", direction: options.inbound ? "inbound" : "outbound" }) },
  { params: Promise.resolve({ id: channel ? "channel" : "conversation" }) });
  const result = { status: response.status, body: await response.text(), effects };
  await tick();
  return { result, reads, metrics };
}

for (const channel of [false, true]) {
  test(`real ${channel ? "channel" : "conversation"} text route preserves response and one Meta call for every shadow outcome`, async () => {
    const baseline = await routeScenario(channel, "OFF", authority);
    assert.equal(baseline.reads, 0);
    assert.deepEqual(baseline.result.effects, ["meta", "message"]);
    const pending = await Promise.race([routeScenario(channel, "SHADOW", "pending"),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Route waited for shadow")), 500))]);
    assert.deepEqual(pending.result, baseline.result);
    assert.equal(pending.metrics.length, 0, "route returned while shadow read was still pending");
    for (const row of [authority, null, "error", { ...authority, ownerUserId: "other" },
      { ...authority, companyId: "foreign" }, { ...authority, channelId: "foreign" },
      { ...authority, state: "AI", ownerUserId: null }] as const) {
      const shadow = await routeScenario(channel, "SHADOW", row);
      assert.deepEqual(shadow.result, baseline.result);
      assert.equal(shadow.reads, 1);
      assert.equal(shadow.metrics.length, 1);
    }
    for (const options of [{ denied: true }, { failed: true }]) {
      const off = await routeScenario(channel, "OFF", authority, options);
      const shadow = await routeScenario(channel, "SHADOW", "error", options);
      assert.deepEqual(shadow.result, off.result);
      if (options.denied) assert.equal(shadow.reads, 0);
    }
    if (!channel) {
      const off = await routeScenario(false, "OFF", authority, { inbound: true });
      const shadow = await routeScenario(false, "SHADOW", authority, { inbound: true });
      assert.equal(shadow.result.status, 200);
      assert.deepEqual(shadow.result, off.result);
      assert.deepEqual(shadow.result.effects, ["message", "inbound-event"]);
      assert.equal(shadow.reads, 0); assert.equal(shadow.metrics.length, 0);
    }
  });
}

test("runtime has one scoped read-only projection, no ledger mutation or transport; CI retains the suite", () => {
  const runtime = readFileSync("src/lib/authority-text-shadow-runtime.ts", "utf8");
  const reader = readFileSync("src/lib/authority-text-shadow-reader.ts", "utf8");
  assert.match(reader, /conversationAuthority\.findFirst/);
  assert.match(reader, /log: \[\]/);
  assert.doesNotMatch(runtime + reader, /from ["']\.\/db["']/);
  for (const file of ["authority-text-shadow-runtime.ts", "authority-text-shadow.ts", "authority-text-shadow-evaluator.ts"]) {
    const source = readFileSync(`src/lib/${file}`, "utf8");
    assert.doesNotMatch(source, /\.(create|update|delete|upsert|reserve|transition|initialize|authorizeDispatch)\(/);
    assert.doesNotMatch(source, /fetch\(|sendMeta|outboundOperation|authorityEvent/);
  }
  assert.match(readFileSync(".github/workflows/ci.yml", "utf8"), /--test src\/lib\/authority-text-shadow\.test\.ts/);
});
