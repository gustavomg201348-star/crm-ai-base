import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_DRAFT_RECENT_ID_LIMIT, createAutoDraftController, type AutoDraftTrigger } from "./ai-auto-draft-state";
import { claimAutoDraft, resolveAutoDraftEligibility, latestUnansweredAutoDraftMessage, type AutoDraftMessage, type AutoDraftSnapshot } from "./ai-auto-draft-policy";
import type { RateLimitStore } from "./rate-limit";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createAiReplyRequestState, createDetailedSnapshotAcceptance, isExpectedAutoDraftSkip, reduceAiReplyRequestState } from "./ai-reply-request-state";

function message(id: string, time: number, overrides: Partial<AutoDraftMessage> = {}): AutoDraftMessage {
  return { id, createdAt: new Date(time), direction: "inbound", senderType: "customer",
    type: "text", providerMessageId: `provider-${id}`, body: "ok", ...overrides };
}
function snapshot(messages: AutoDraftMessage[], overrides: Partial<AutoDraftSnapshot> = {}): AutoDraftSnapshot {
  return { id: "conversation-a", status: "OPEN", aiPaused: false, messages, ...overrides };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(run: (trigger: AutoDraftTrigger, current: () => boolean) => Promise<void> = async () => {}) {
  let nextTimer = 0;
  const timers = new Map<number, () => void>();
  const calls: AutoDraftTrigger[] = [];
  const invalidations: string[] = [];
  let busy = false;
  const controller = createAutoDraftController({
    run: async (trigger, current) => { calls.push(trigger); await run(trigger, current); },
    invalidate: (id) => invalidations.push(id),
    isBusy: () => busy,
    schedule: (callback, delay) => {
      assert.equal(delay, 3000);
      timers.set(++nextTimer, callback);
      return nextTimer as unknown as ReturnType<typeof setTimeout>;
    },
    cancel: (id) => { timers.delete(id as unknown as number); }
  });
  controller.select("conversation-a");
  return { controller, calls, invalidations, setBusy: (value: boolean) => { busy = value; },
    fire: async () => {
      const callbacks = Array.from(timers.values()); timers.clear();
      callbacks.forEach((callback) => callback()); await flush();
    } };
}

for (const type of ["text", "button", "interactive"]) {
  test(`policy aceita ${type} persistido e texto comercial curto`, () => {
    for (const body of ["ok", "sim", "👍", "Resposta interativa: Sim"]) {
      assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1, { type, body })]), "COPILOT")?.id, "m1");
    }
  });
}
for (const type of ["audio", "image", "video", "document", "sticker", "reaction", "location", "contacts", "unknown", "status", "delivery", "read"]) {
  test(`policy rejeita ${type}`, () => {
    assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1, { type })]), "COPILOT"), null);
  });
}
test("policy fail-closed: origem, placeholder, pausa, resolvida e modos", () => {
  for (const overrides of [{ direction: "outbound" }, { senderType: "agent" },
    { providerMessageId: " " }, { body: " " }, { body: "Resposta interativa recebida" }]) {
    assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1, overrides)]), "COPILOT"), null);
  }
  for (const mode of ["OFF", "AUTO", "HYBRID"]) {
    assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1)]), mode), null);
    assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1)], { aiMode: mode }), "COPILOT"), null);
  }
  for (const overrides of [{ status: "RESOLVED" }, { aiPaused: true }]) {
    assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1)], overrides), "COPILOT"), null);
  }
});
test("timeline nao depende de ordem; outbound posterior e timestamp ambiguo bloqueiam", () => {
  assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m2", 2), message("m1", 1)]), "COPILOT")?.id, "m2");
  assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1), message("m2", 2, { direction: "outbound" })]), "COPILOT"), null);
  assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1), message("m2", 1)]), "COPILOT"), null);
  assert.equal(latestUnansweredAutoDraftMessage(snapshot([message("m1", 1, { createdAt: "invalid" })]), "COPILOT"), null);
});
test("initial load, snapshots repetidos e reconstrucoes nao geram", async () => {
  const h = harness();
  h.controller.observe(snapshot([message("old", 1)]), "COPILOT", true);
  h.controller.observe(snapshot([message("old", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 0);
  h.controller.dispose();
  const recreated = harness();
  recreated.controller.observe(snapshot([message("old", 1)]), "COPILOT", true);
  await recreated.fire(); assert.equal(recreated.calls.length, 0);
});
test("rajada m1..m4 coalesce para m4; polling/SSE repetido nao duplica", async () => {
  const h = harness(); h.controller.observe(snapshot([]), "COPILOT", true);
  for (let i = 1; i <= 4; i++) h.controller.observe(snapshot([message(`m${i}`, i)]), "COPILOT", true);
  h.controller.observe(snapshot([message("m4", 4)]), "COPILOT", true);
  await h.fire(); await h.fire();
  assert.deepEqual(h.calls.map((call) => call.triggerMessageId), ["m4"]);
});
test("flight m1/m2: sem paralelo, resultado stale, novo debounce apos terminar", async () => {
  let finish!: () => void;
  let isCurrent!: () => boolean;
  const h = harness(async (_trigger, current) => {
    isCurrent = current; await new Promise<void>((resolve) => { finish = resolve; });
  });
  h.controller.observe(snapshot([]), "COPILOT", true);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(isCurrent(), true);
  h.controller.observe(snapshot([message("m1", 1), message("m2", 2)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 1); assert.equal(isCurrent(), false);
  finish(); await flush(); await h.fire();
  assert.equal(h.calls.length, 2); assert.equal(h.calls[1].triggerMessageId, "m2");
  finish(); await flush();
});
test("A/B e retorno A estabelecem baseline; resposta de A nao invade B", async () => {
  let finish!: () => void; let current!: () => boolean;
  const h = harness(async (_trigger, isCurrent) => {
    current = isCurrent; await new Promise<void>((resolve) => { finish = resolve; });
  });
  h.controller.observe(snapshot([]), "COPILOT", true);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true); await h.fire();
  h.controller.select("conversation-b");
  h.controller.observe(snapshot([message("b1", 2)], { id: "conversation-b" }), "COPILOT", true);
  assert.equal(current(), false); finish(); await flush(); await h.fire();
  h.controller.select("conversation-a"); h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 1);
});
test("erro sem loop, suspend/resume sem history-trigger e manual ocupado preserva pendente", async () => {
  const h = harness(async () => { throw new Error("mock-provider-error"); });
  h.controller.observe(snapshot([]), "COPILOT", true);
  h.setBusy(true); h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 0);
  h.setBusy(false); h.controller.notifyIdle(); await h.fire();
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 1);
  h.controller.suspend(); h.controller.observe(snapshot([message("m2", 2)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 1);
});
test("outbound/mode change durante debounce cancela; hidden observation nao gera", async () => {
  const h = harness(); h.controller.observe(snapshot([]), "COPILOT", true);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  h.controller.observe(snapshot([message("out", 2, { direction: "outbound" })]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 0);
  h.controller.observe(snapshot([message("m2", 3)]), "COPILOT", false);
  h.controller.observe(snapshot([message("m2", 3)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 0);
});
test("gate compartilhado: duas abas/operadores, um vencedor; expiry e falha fechada", async () => {
  let count = 0;
  const now = new Date(1000);
  const store: RateLimitStore = { increment: async ({ expiresAt }) => ({ count: ++count, expiresAt }) };
  assert.deepEqual(await Promise.all([claimAutoDraft(store, "tenant:conversation:message", now),
    claimAutoDraft(store, "tenant:conversation:message", now)]), ["allowed", "claimed"]);
  assert.equal(await claimAutoDraft({ increment: async () => { throw new Error("db-unavailable"); } }, "key"), "unavailable");
  assert.equal(await claimAutoDraft({ increment: async () => ({ count: 0, expiresAt: new Date(0) }) }, "key"), "unavailable");
});

test("query real da policy exige tenant+conversation; trigger externo nao passa", async (t) => {
  const read = t.mock.fn(async (args: Prisma.ConversationFindFirstArgs) => {
    assert.deepEqual(args?.select?.messages, {
      orderBy: { createdAt: "desc" }, take: 2,
      select: { id: true, createdAt: true, direction: true, senderType: true,
        type: true, providerMessageId: true, body: true }
    });
    const where = args?.where as { id: string; contact: { companyId: string } };
    if (where.id !== "conversation-a" || where.contact.companyId !== "tenant-a") return null;
    return { ...snapshot([message("m1", 1)]), contact: { company: { aiMode: "COPILOT" } } } as never;
  });
  const db = { conversation: { findFirst: read } } as unknown as Pick<PrismaClient, "conversation">;
  const input = { companyId: "tenant-a", conversationId: "conversation-a", triggerMessageId: "m1" };
  assert.equal(await resolveAutoDraftEligibility(db, input), true);
  assert.equal(await resolveAutoDraftEligibility(db, { ...input, companyId: "tenant-b" }), false);
  assert.equal(await resolveAutoDraftEligibility(db, { ...input, conversationId: "conversation-b" }), false);
  assert.equal(await resolveAutoDraftEligibility(db, { ...input, triggerMessageId: "other-conversation-message" }), false);
  assert.equal(read.mock.callCount(), 4);
});

test("gate usa expiry deslizante, permite novo claim so apos janela e nao vaza IDs", async () => {
  const buckets = new Map<string, { count: number; expiresAt: Date }>();
  const store: RateLimitStore = { increment: async ({ key, now, expiresAt }) => {
    const old = buckets.get(key);
    const result = old && old.expiresAt > now ? { ...old, count: old.count + 1 } : { count: 1, expiresAt };
    buckets.set(key, result); return result;
  } };
  const start = new Date(999);
  assert.equal(await claimAutoDraft(store, "hashed-key", start), "allowed");
  assert.equal(await claimAutoDraft(store, "hashed-key", new Date(1000)), "claimed");
  assert.equal(await claimAutoDraft(store, "hashed-key", new Date(999 + 24 * 60 * 60_000 - 1)), "claimed");
  assert.equal(await claimAutoDraft(store, "hashed-key", new Date(999 + 24 * 60 * 60_000)), "allowed");
});

test("loading/error/success/invalidate permanecem por conversa sem afetar composer/reply", () => {
  let state = createAiReplyRequestState<string>();
  state = reduceAiReplyRequestState(state, { type: "begin", conversationId: "a", requestId: 1 });
  assert.equal(state.loadingByConversation.a, true);
  state = reduceAiReplyRequestState(state, { type: "error", conversationId: "a", requestId: 1, error: "safe-error" });
  state = reduceAiReplyRequestState(state, { type: "finish", conversationId: "a", requestId: 1 });
  assert.equal(state.loadingByConversation.a, false);
  state = reduceAiReplyRequestState(state, { type: "begin", conversationId: "a", requestId: 2 });
  assert.equal(state.errorByConversation.a, undefined);
  state = reduceAiReplyRequestState(state, { type: "success", conversationId: "a", requestId: 2, analysis: "suggestion" });
  state = reduceAiReplyRequestState(state, { type: "invalidate", conversationId: "a" });
  assert.equal(state.analysisByConversation.a, undefined);
  assert.equal(state.analysisByConversation.b, undefined);
  assert.equal(state.loadingByConversation.a, true);
  state = reduceAiReplyRequestState(state, { type: "finish", conversationId: "a", requestId: 2 });
  assert.equal(state.loadingByConversation.a, false);
});

test("polling 3s com respostas 4s aceita R1/R2/R3 e inbound chega ao controller", async () => {
  const h = harness();
  const acceptance = createDetailedSnapshotAcceptance();
  const events: Array<{ at: number; run: () => void }> = [];
  const accepted: number[] = [];
  for (let i = 0; i < 3; i++) {
    events.push({ at: i * 3000, run: () => {
      const ticket = acceptance.begin("conversation-a", 1);
      const response = snapshot(i === 0 ? [] : [message(`m${i}`, i)]);
      events.push({ at: i * 3000 + 4000, run: () => {
        if (acceptance.accept(ticket, "conversation-a", 1)) {
          accepted.push(ticket.sequence);
          h.controller.observe(response, "COPILOT", true);
        }
      } });
    } });
  }
  while (events.length) {
    events.sort((a, b) => a.at - b.at);
    events.shift()!.run();
  }
  assert.deepEqual(accepted, [1, 2, 3]);
  await h.fire();
  assert.deepEqual(h.calls.map((call) => call.triggerMessageId), ["m2"]);
});

test("latest accepted rejeita resposta fora de ordem, conversa e epoch antigas", () => {
  const acceptance = createDetailedSnapshotAcceptance();
  const old = acceptance.begin("a", 1);
  const newer = acceptance.begin("a", 1);
  assert.equal(acceptance.accept(newer, "a", 1), true);
  assert.equal(acceptance.accept(old, "a", 1), false);
  const switched = acceptance.begin("a", 1);
  assert.equal(acceptance.accept(switched, "b", 2), false);
  assert.equal(acceptance.accept(switched, "a", 3), false);
  assert.equal(acceptance.accept(acceptance.begin("a", 3), "a", 3), true);
});

test("retencao limitada, ID podado nao rearma e inbound futura continua elegivel", async () => {
  const h = harness();
  h.controller.observe(snapshot([]), "COPILOT", true);
  for (let i = 1; i <= 2000; i++) {
    h.controller.observe(snapshot([message(`m${i}`, i)]), "COPILOT", true);
    await h.fire();
    assert.ok(h.controller.retainedState().seen <= AUTO_DRAFT_RECENT_ID_LIMIT);
    assert.ok(h.controller.retainedState().attempted <= AUTO_DRAFT_RECENT_ID_LIMIT);
  }
  assert.equal(h.calls.length, 2000);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 2000);
  h.controller.observe(snapshot([message("same-time", 2000)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 2000);
  h.controller.observe(snapshot([message("future", 2001)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 2001);
  h.controller.observe(snapshot([message("future", 2001)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 2001);
});

test("suspend/dispose limpam memoria e timer sem liberar lock de flight prematuramente", async () => {
  let finish!: () => void;
  let current!: () => boolean;
  const h = harness(async (_trigger, isCurrent) => {
    current = isCurrent;
    await new Promise<void>((resolve) => { finish = resolve; });
  });
  h.controller.observe(snapshot([]), "COPILOT", true);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire();
  h.controller.suspend();
  assert.equal(current(), false);
  assert.deepEqual(h.controller.retainedState(), { seen: 0, attempted: 0, initialized: false,
    pending: false, timer: false, running: true });
  h.controller.dispose();
  h.controller.select("conversation-a");
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  h.controller.observe(snapshot([message("m2", 2)]), "COPILOT", true);
  await h.fire(); assert.equal(h.calls.length, 1);
  finish(); await flush(); await h.fire();
  assert.equal(h.calls.length, 2);
  finish(); await flush(); h.controller.dispose();
  assert.deepEqual(h.controller.retainedState(), { seen: 0, attempted: 0, initialized: false,
    pending: false, timer: false, running: false });
});

test("skips 409 sao neutros, encerram loading sem erro e nao escondem falhas reais", () => {
  for (const code of ["AUTO_DRAFT_NOT_ELIGIBLE", "AUTO_DRAFT_ALREADY_CLAIMED", "AUTO_DRAFT_STALE"]) {
    let state = reduceAiReplyRequestState(createAiReplyRequestState<string>(),
      { type: "begin", conversationId: "a", requestId: 1 });
    assert.equal(isExpectedAutoDraftSkip(409, code), true);
    if (!isExpectedAutoDraftSkip(409, code)) {
      state = reduceAiReplyRequestState(state, { type: "error", conversationId: "a", requestId: 1, error: code });
    }
    state = reduceAiReplyRequestState(state, { type: "finish", conversationId: "a", requestId: 1 });
    assert.equal(state.errorByConversation.a, undefined);
    assert.equal(state.loadingByConversation.a, false);
  }
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(isExpectedAutoDraftSkip(status, "AUTO_DRAFT_STALE"), false);
  }
  assert.equal(isExpectedAutoDraftSkip(409, "UNEXPECTED"), false);
  assert.equal(isExpectedAutoDraftSkip(503, "AUTO_DRAFT_GATE_UNAVAILABLE"), false);
});

test("skip esperado nao rearma em polling repetido da mesma Message", async () => {
  const h = harness(async () => {
    assert.equal(isExpectedAutoDraftSkip(409, "AUTO_DRAFT_ALREADY_CLAIMED"), true);
  });
  h.controller.observe(snapshot([]), "COPILOT", true);
  h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
  await h.fire();
  for (let i = 0; i < 20; i++) {
    h.controller.observe(snapshot([message("m1", 1)]), "COPILOT", true);
    h.controller.notifyIdle(); await h.fire();
  }
  assert.equal(h.calls.length, 1);
});
