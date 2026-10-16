import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ChatbotError } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";
import {
  assessChatbotActivation, planChatbotExecution,
  type ActivationEvidence, type EngineEvent, type EngineScope, type EngineState, type EngineVersion
} from "./chatbot-execution-engine";

const scope: EngineScope = { companyId: "company", channelId: "channel", conversationId: "conversation", contactId: "contact", flowId: "flow", flowVersionId: "version", sessionId: "simulation-session" };
const version: EngineVersion = {
  companyId: scope.companyId, flowId: scope.flowId, id: scope.flowVersionId, status: "PUBLISHED",
  definition: { schemaVersion: 1, entryStepId: "welcome", steps: [
    { id: "welcome", type: "TEXT", text: "Welcome", next: "choice" },
    { id: "choice", type: "BUTTONS", text: "Choose", options: [
      { id: "yes", title: "Yes", next: "input" }, { id: "no", title: "No", next: "handoff" }
    ] },
    { id: "input", type: "INPUT", text: "Product?", variable: "product", maxLength: 20, next: "condition" },
    { id: "condition", type: "CONDITION", variable: "product", branches: [{ equals: "credit", next: "done" }], otherwise: "handoff" },
    { id: "done", type: "END" }, { id: "handoff", type: "HANDOFF", queue: "DEFAULT" }
  ] }
};
const event = (id: string, fields: { kind: "START" } | { kind: "TEXT"; text: string } | { kind: "OPTION"; optionId: string | null; title: string | null }): EngineEvent =>
  ({ id, occurredAt: "2026-10-16T12:00:00.000Z", ...fields });
const start = () => planChatbotExecution({ scope, version, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) });
// Synthetic transport projections only: no Meta message is actually sent by these fixtures.
const delivery = (state: EngineState) => ({ scope: state.scope, promptId: state.expectedPrompt!.id, providerMessageId: `synthetic-sent-${state.expectedPrompt!.id}` });
const correlated = (state: EngineState, incoming: EngineEvent): EngineEvent => incoming.kind === "START" ? incoming : ({ ...incoming,
  reply: incoming.reply ?? { promptId: state.expectedPrompt!.id, inboundProviderMessageId: `synthetic-inbound-${incoming.id}`, contextProviderMessageId: delivery(state).providerMessageId }
});
const reply = (state: EngineState, incoming: EngineEvent) => planChatbotExecution({ scope, version, state, expectedRevision: state.revision,
  event: state.expectedPrompt ? correlated(state, incoming) : incoming,
  promptDelivery: state.expectedPrompt && incoming.kind !== "START" ? delivery(state) : undefined });
const option = (id = "yes") => event("option", { kind: "OPTION", optionId: id, title: "Yes" });
const code = (expected: string) => (error: unknown) => error instanceof ChatbotError && error.code === expected;

test("linear execution emits only inert plans, waits, and never mutates input", () => {
  const before = JSON.stringify(version);
  const plan = start();
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.commands.map(command => command.payload.type), ["TEXT", "BUTTONS"]);
  assert.equal(plan.state.waiting, true);
  assert.equal(plan.state.stepId, "choice");
  assert.equal(plan.state.revision, 1);
  assert.equal(JSON.stringify(version), before);
  assert.equal(plan.decisions.some(item => Object.hasOwn(item, "text")), false);
});

test("technical option ID takes precedence, INPUT preserves text, CONDITION ends", () => {
  const first = start().state;
  const before = JSON.stringify(first);
  const input = reply(first, option());
  assert.equal(input.state.stepId, "input");
  assert.equal(input.commands[0].payload.type, "INPUT");
  assert.equal(JSON.stringify(first), before);
  const result = reply(input.state, event("text", { kind: "TEXT", text: "credit" }));
  assert.equal(result.outcome, "COMPLETED");
  assert.equal(result.state.authority, "NONE");
  assert.equal(result.state.variables.product, "credit");
  assert.equal(result.state.closureReason, "COMPLETED");
});

test("handoff plans default human queue without choosing employee or transferring", () => {
  const result = reply(start().state, option("no"));
  assert.equal(result.outcome, "HANDOFF");
  assert.deepEqual(result.handoff, { queue: "DEFAULT", assignTo: null, executionAllowed: false });
  assert.equal(result.state.authority, "HUMAN");
  assert.equal(result.state.status, "CLOSED");
  assert.equal(result.commands.length, 0);
  assert.throws(() => reply(result.state, event("late", { kind: "TEXT", text: "Late" })), code("SESSION_NOT_ACTIVE"));
});

test("condition otherwise follows the configured human path", () => {
  const input = reply(start().state, option());
  assert.equal(reply(input.state, event("text", { kind: "TEXT", text: "other" })).outcome, "HANDOFF");
});

test("LIST preserves supplied IDs and title-only replies require a single exact match", () => {
  const listVersion: EngineVersion = { ...version, definition: { schemaVersion: 1, entryStepId: "list", steps: [
    { id: "list", type: "LIST", text: "Choose", buttonText: "Options", options: [
      { id: "one", title: "Same", next: "end" }, { id: "two", title: "Same", next: "end" }
    ] }, { id: "end", type: "END" }
  ] } };
  const state = planChatbotExecution({ scope, version: listVersion, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) }).state;
  const run = (incoming: EngineEvent) => planChatbotExecution({ scope, version: listVersion, state, expectedRevision: state.revision, event: correlated(state, incoming), promptDelivery: delivery(state) });
  assert.equal(run(event("title", { kind: "OPTION", optionId: null, title: "Same" })).outcome, "AMBIGUOUS_REPLY");
  assert.equal(run(event("id", { kind: "OPTION", optionId: "two", title: "Different title" })).outcome, "COMPLETED");
  assert.equal(run(event("bad", { kind: "OPTION", optionId: "missing", title: "Same" })).outcome, "INVALID_REPLY");
  assert.equal(reply(start().state, event("title", { kind: "OPTION", optionId: null, title: "Yes" })).state.stepId, "input");
});

test("invalid replies do not move steps, send prompts again, or invent options", () => {
  const state = start().state;
  for (const incoming of [event("text", { kind: "TEXT", text: "Yes" }), option("missing")]) {
    const result = reply(state, incoming);
    assert.equal(result.outcome, "INVALID_REPLY");
    assert.equal(result.state.stepId, state.stepId);
    assert.equal(result.state.waiting, true);
    assert.equal(result.commands.length, 0);
  }
  const input = reply(state, option()).state;
  assert.equal(reply(input, event("long", { kind: "TEXT", text: "x".repeat(21) })).outcome, "INVALID_REPLY");
});

test("duplicate and conflicting event IDs remain distinct; command keys deterministic", () => {
  const initial = event("start", { kind: "START" });
  const plan = start();
  const duplicate = reply(plan.state, initial);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.commands.length, 0);
  assert.deepEqual(duplicate.state, plan.state);
  assert.throws(() => reply(plan.state, event("start", { kind: "TEXT", text: "Changed" })), code("REPLAY_CONFLICT"));
  assert.deepEqual(start(), plan);
});

test("out-of-order input and stale revisions cannot produce a plan", () => {
  const state = start().state;
  assert.throws(() => reply(state, { ...option(), occurredAt: "2026-10-16T11:59:59.000Z" }), code("EVENT_OUT_OF_ORDER"));
  assert.throws(() => planChatbotExecution({ scope, version, state, expectedRevision: 0, event: option() }), code("REVISION_CONFLICT"));
});

test("same version ID cannot change its definition during a simulation", () => {
  const changed = JSON.parse(JSON.stringify(version)) as EngineVersion;
  (changed.definition as { steps: Array<{ text?: string }> }).steps[0].text = "Changed";
  assert.throws(() => planChatbotExecution({ scope, version: changed, state: start().state, expectedRevision: 1, event: option() }), code("VERSION_CHANGED"));
});

test("pure concurrency returns identical proposals, not two committed sessions", async () => {
  const state = start().state;
  const [a, b] = await Promise.all([Promise.resolve().then(() => reply(state, option())), Promise.resolve().then(() => reply(state, option()))]);
  assert.deepEqual(a, b);
  assert.equal(a.executable, false);
  assert.equal(state.revision, 1);
  // Durable winner selection is deliberately NOT claimed by this pure planner.
});

test("missing, draft and invalid versions and cyclic definitions fail closed", () => {
  for (const [candidate, expected] of [[null, "VERSION_NOT_FOUND"], [{ ...version, status: "DRAFT" }, "VERSION_NOT_PUBLISHED"], [{ ...version, definition: {} }, "INVALID_DEFINITION"]] as const) {
    assert.throws(() => planChatbotExecution({ scope, version: candidate, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) }), code(expected));
  }
  const cyclic = { ...version, definition: { schemaVersion: 1, entryStepId: "loop", steps: [{ id: "loop", type: "TEXT", text: "Loop", next: "loop" }] } };
  assert.throws(() => planChatbotExecution({ scope, version: cyclic, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) }), code("INVALID_DEFINITION"));
});

test("scope rejects invalid runtime values and mismatched company/channel/conversation", () => {
  for (const field of Object.keys(scope)) for (const invalid of [undefined, null, "", " ", 42]) {
    assert.throws(() => planChatbotExecution({ scope: { ...scope, [field]: invalid } as EngineScope, version, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) }), code("INVALID_SCOPE"));
  }
  for (const field of ["companyId", "channelId", "conversationId", "contactId"]) {
    assert.throws(() => planChatbotExecution({ scope: { ...scope, [field]: "other" }, version, state: start().state, expectedRevision: 1, event: option() }), code(field === "companyId" ? "VERSION_SCOPE_MISMATCH" : "STATE_SCOPE_MISMATCH"));
  }
});

test("limits reject oversized execution and exhausted receipt memory", () => {
  assert.throws(() => planChatbotExecution({ scope, version, state: null, expectedRevision: 0, event: event("start", { kind: "START" }), maxSteps: 1 }), code("STEP_LIMIT"));
  const state = start().state;
  state.stepsExecuted = 100;
  assert.throws(() => reply(state, option()), code("STEP_LIMIT"));
  state.receipts = Array.from({ length: 100 }, (_, index) => ({ id: `receipt-${index}`, inboundProviderMessageId: `provider-${index}`, fingerprint: "a".repeat(64) }));
  state.revision = state.receipts.length;
  assert.throws(() => reply(state, option()), code("EVENT_LIMIT"));
});

test("revision equals consumed receipts across START, internal steps, replies and terminals", () => {
  const check = (state: EngineState, revision: number) => {
    assert.equal(state.revision, revision);
    assert.equal(state.receipts.length, revision);
    assert(Number.isSafeInteger(state.revision));
  };
  const initial = start().state;
  check(initial, 1);
  assert.equal(initial.stepsExecuted, 2);
  const invalid = reply(initial, event("invalid", { kind: "TEXT", text: "not an option" })).state;
  check(invalid, 2);
  assert.equal(invalid.stepsExecuted, initial.stepsExecuted);
  const input = reply(invalid, option()).state;
  check(input, 3);
  const completed = reply(input, event("complete", { kind: "TEXT", text: "credit" })).state;
  check(completed, 4);
  assert.equal(completed.closureReason, "COMPLETED");
  assert.equal(completed.stepsExecuted, 5);
  const handoff = reply(initial, option("no")).state;
  check(handoff, 2);
  assert.equal(handoff.closureReason, "HUMAN_HANDOFF");
  const before = structuredClone(initial);
  const duplicate = reply(initial, event("start", { kind: "START" }));
  check(duplicate.state, 1);
  assert.deepEqual(duplicate.state, before);
  assert.throws(() => reply(initial, event("start", { kind: "TEXT", text: "conflict" })), code("REPLAY_CONFLICT"));
  assert.throws(() => planChatbotExecution({ scope, version, state: initial, expectedRevision: 1,
    event: option() }), code("PROMPT_CORRELATION_REQUIRED"));
  assert.deepEqual(initial, before);
});

test("inconsistent revision is rejected before duplicate START despite matching expectedRevision", () => {
  const initial = start().state;
  const closed = reply(initial, option("no")).state;
  for (const source of [initial, closed]) {
    for (const revision of [source.revision + 1, 101, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
      const state = { ...source, revision };
      const before = structuredClone(state);
      for (const incoming of [event("start", { kind: "START" }), option()]) {
        assert.throws(() => planChatbotExecution({ scope, version, state,
          expectedRevision: revision, event: incoming }), code("INVALID_STATE_REVISION"));
        assert.deepEqual(state, before);
      }
    }
  }
});

test("negative, fractional, infinite and unsafe runtime revisions are rejected without mutation", () => {
  for (const revision of [-1, 0.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const state = { ...start().state, revision };
    const before = structuredClone(state);
    for (const expectedRevision of [1, revision]) {
      assert.throws(() => planChatbotExecution({ scope, version, state, expectedRevision,
        event: event("start", { kind: "START" }) }), code("INVALID_REVISION"));
      assert.deepEqual(state, before);
    }
  }
});

test("real revision limit is 100; duplicates still work at the cap without receipt pruning", () => {
  let state = start().state;
  const firstPrompt = delivery(state);
  let last: EngineEvent = event("start", { kind: "START" });
  for (let index = 1; index < 100; index++) {
    last = correlated(state, event(`invalid-${index}`, { kind: "OPTION", optionId: "unknown", title: null }));
    const result = reply(state, last);
    assert.equal(result.outcome, "INVALID_REPLY");
    state = result.state;
    assert.equal(state.revision, index + 1);
    assert.equal(state.receipts.length, index + 1);
  }
  const before = structuredClone(state);
  const duplicate = planChatbotExecution({ scope, version, state, expectedRevision: 100,
    event: { ...last, id: "alias-at-cap" }, promptDelivery: firstPrompt });
  assert(duplicate.duplicate);
  assert.deepEqual(duplicate.state, before);
  assert.equal(duplicate.commands.length, 0);
  assert.throws(() => reply(state, event("over-cap", { kind: "TEXT", text: "new" })), code("EVENT_LIMIT"));
  assert.deepEqual(state, before);
});

test("provider identity deduplicates local aliases without consuming receipts or revisions", () => {
  const initial = start().state;
  const incoming = correlated(initial, option("missing"));
  const sent = delivery(initial);
  const run = (state: EngineState, message: EngineEvent) => planChatbotExecution({
    scope, version, state, expectedRevision: state.revision, event: message, promptDelivery: sent
  });
  const accepted = run(initial, incoming);
  assert.equal(accepted.outcome, "INVALID_REPLY");
  let state = accepted.state;
  for (let index = 0; index < 99; index++) {
    const duplicate = run(state, { ...incoming, id: `alias-${index}` });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.commands.length, 0);
    assert.equal(duplicate.confirmation, null);
    assert.deepEqual(duplicate.state, accepted.state);
    state = duplicate.state;
  }
  assert.equal(state.receipts.length, 2);
  assert.equal(state.revision, 2);
  const conflict = (change: Partial<EngineEvent>) =>
    assert.throws(() => run(state, { ...incoming, ...change } as EngineEvent), code("REPLAY_CONFLICT"));
  conflict({ id: "changed-content", optionId: "yes" });
  conflict({ id: "changed-context", reply: { ...incoming.reply!, contextProviderMessageId: "another-outbound" } });
  conflict({ reply: { ...incoming.reply!, inboundProviderMessageId: "another-inbound" } });
  const distinct = run(state, { ...incoming, id: "new-local", reply: { ...incoming.reply!, inboundProviderMessageId: "new-inbound" } });
  assert.equal(distinct.duplicate, false);
  assert.equal(distinct.state.revision, 3);
  assert.equal(distinct.state.receipts.length, 3);
  assert.throws(() => run(distinct.state, { ...incoming, id: "new-local" }), code("REPLAY_CONFLICT"));
});

test("provider identity is scoped and duplicate receipt identities fail closed", () => {
  const initial = start().state;
  const incoming = correlated(initial, option("missing"));
  const state = reply(initial, incoming).state;
  for (const field of ["channelId", "sessionId", "companyId"] as const) {
    const altered = { ...scope, [field]: "other" };
    assert.throws(() => planChatbotExecution({ scope: altered,
      version: { ...version, companyId: altered.companyId }, state,
      expectedRevision: state.revision, event: incoming, promptDelivery: delivery(initial) }), code("STATE_SCOPE_MISMATCH"));
    const independent = planChatbotExecution({ scope: altered,
      version: { ...version, companyId: altered.companyId }, state: null,
      expectedRevision: 0, event: event("start", { kind: "START" }) }).state;
    const ownDelivery = delivery(independent);
    const ownEvent = correlated(independent, { ...incoming, reply: undefined });
    ownEvent.reply!.inboundProviderMessageId = incoming.reply!.inboundProviderMessageId;
    const result = planChatbotExecution({ scope: altered, version: { ...version, companyId: altered.companyId },
      state: independent, expectedRevision: independent.revision, event: ownEvent, promptDelivery: ownDelivery });
    assert.equal(result.duplicate, false);
  }
  const malformed = structuredClone(state);
  malformed.receipts.push({ ...malformed.receipts[1], id: "duplicate-provider" });
  malformed.revision = malformed.receipts.length;
  assert.throws(() => reply(malformed, option()), code("INVALID_STATE"));
  const legacy = structuredClone(state);
  delete (legacy.receipts[1] as Partial<EngineState["receipts"][number]>).inboundProviderMessageId;
  assert.throws(() => reply(legacy, option()), code("INVALID_STATE"));
});

test("an accepted inbound alias cannot advance a later prompt or change its original context", () => {
  const initial = start().state;
  const incoming = correlated(initial, option());
  const advanced = reply(initial, incoming).state;
  const run = (message: EngineEvent) => planChatbotExecution({ scope, version, state: advanced,
    expectedRevision: advanced.revision, event: message, promptDelivery: delivery(initial) });
  const duplicate = run({ ...incoming, id: "accepted-alias" });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.state, advanced);
  assert.equal(duplicate.commands.length, 0);
  assert.throws(() => run({ ...incoming, id: "changed-reply",
    reply: { ...incoming.reply!, promptId: advanced.expectedPrompt!.id } }), code("REPLAY_CONFLICT"));
  const distinct = reply(advanced, event("separate-message", { kind: "TEXT", text: "credit" }));
  assert.equal(distinct.duplicate, false);
  assert.equal(distinct.outcome, "COMPLETED");
  assert.equal(distinct.state.revision, advanced.revision + 1);
});

test("terminal semantics are validated before duplicate START or inbound replay", () => {
  const initial = start().state;
  const handoffEvent = correlated(initial, option("no"));
  const handoff = reply(initial, handoffEvent).state;
  const input = reply(initial, option()).state;
  const endEvent = correlated(input, event("finish", { kind: "TEXT", text: "credit" }));
  const completed = reply(input, endEvent).state;
  for (const [state, original, sent, outcome] of [
    [handoff, handoffEvent, delivery(initial), "HANDOFF"],
    [completed, endEvent, delivery(input), "COMPLETED"]
  ] as const) {
    for (const id of [original.id, "terminal-alias"]) {
      const result = planChatbotExecution({ scope, version, state, expectedRevision: state.revision,
        event: { ...original, id }, promptDelivery: sent });
      assert.equal(result.duplicate, true);
      assert.equal(result.outcome, outcome);
      assert.deepEqual(result.state, state);
      assert.equal(result.commands.length, 0);
      assert.equal(result.handoff, null);
    }
    assert.equal(reply(state, event("start", { kind: "START" })).duplicate, true);
    assert.throws(() => planChatbotExecution({ scope, version, state, expectedRevision: state.revision,
      event: { ...original, id: "conflicting-terminal-alias", occurredAt: "2026-10-16T12:00:01.000Z" },
      promptDelivery: sent }), code("REPLAY_CONFLICT"));
    assert.throws(() => reply(state, event("new", { kind: "TEXT", text: "New" })), code("SESSION_NOT_ACTIVE"));
    for (const change of [
      { stepId: "choice" }, { stepId: state === handoff ? "done" : "handoff" },
      { waiting: true }, { expectedPrompt: initial.expectedPrompt }, { revision: 0 },
      { authority: "CHATBOT" }, { closureReason: null }, { closureReason: "EXPIRED" },
      { status: "SUSPENDED" }
    ]) {
      const invalid = { ...state, ...change } as EngineState;
      assert.throws(() => reply(invalid, event("start", { kind: "START" })),
        code("revision" in change ? "INVALID_STATE_REVISION" : "INVALID_STATE"));
    }
  }
  const fakeCompleted: EngineState = { ...initial, status: "CLOSED", authority: "NONE",
    closureReason: "COMPLETED", waiting: false, expectedPrompt: null };
  assert.throws(() => reply(fakeCompleted, event("start", { kind: "START" })), code("INVALID_STATE"));
  assert.throws(() => reply({ ...initial, waiting: false, expectedPrompt: null }, event("start", { kind: "START" })), code("INVALID_STATE"));
});

const evidence: ActivationEvidence = {
  scope, correlationScope: scope, correlationStatus: "CONFIRMED", explicitBindingVerified: true,
  inboundValid: true, humanActive: false, existingAiHasAuthority: false, metaWindowOpen: true
};
for (const [name, change, reason] of [
  ["not confirmed", { correlationStatus: "NOT_FOUND" }, "CORRELATION_NOT_CONFIRMED"],
  ["campaign without configured chatbot", { explicitBindingVerified: false }, "EXPLICIT_FLOW_BINDING_REQUIRED"],
  ["invalid inbound", { inboundValid: false }, "VALID_INBOUND_REQUIRED"],
  ["human active", { humanActive: true }, "HUMAN_CONTROL_REQUIRED"],
  ["current AI", { existingAiHasAuthority: true }, "AI_AUTHORITY_OCCUPIED"],
  ["closed Meta window", { metaWindowOpen: false }, "META_WINDOW_UNVERIFIED_OR_CLOSED"],
  ["foreign company", { correlationScope: { ...scope, companyId: "other" } }, "CORRELATION_SCOPE_MISMATCH"],
  ["foreign channel", { correlationScope: { ...scope, channelId: "other" } }, "CORRELATION_SCOPE_MISMATCH"]
] as const) {
  test(`activation rejects ${name}`, () => {
    const result = assessChatbotActivation({ ...evidence, ...change });
    assert.equal(result.allowed, false);
    assert(result.reasons.includes(reason));
  });
}

test("activation always blocked, including two simultaneous attempts and complete evidence", async () => {
  const results = await Promise.all([Promise.resolve(assessChatbotActivation(evidence)), Promise.resolve(assessChatbotActivation(evidence))]);
  results.forEach(result => {
    assert.equal(result.allowed, false);
    assert(result.reasons.includes("SHARED_AUTHORITY_NOT_INTEGRATED"));
  });
  const state = start().state;
  state.authority = "HUMAN";
  assert.throws(() => reply(state, option()), code("AUTHORITY_UNAVAILABLE"));
});

test("planner has no runtime database, transport, foundation-service or processor dependency", () => {
  const source = readFileSync("src/lib/chatbot-execution-engine.ts", "utf8");
  const imports = source.split("\n").filter(line => line.startsWith("import "));
  assert.equal(imports.length, 3);
  assert(imports[0].includes("node:crypto"));
  assert(imports[1].includes('"./chatbot-definition"'));
  assert(imports[2].includes('"./chatbot-canonical"'));
  assert(!source.includes("fetch("));
});

test("consecutive BUTTONS with yes reject two distinct replies to the first prompt at equal timestamps", () => {
  const sequential: EngineVersion = { ...version, definition: { schemaVersion: 1, entryStepId: "first", steps: [
    { id: "first", type: "BUTTONS", text: "First?", options: [{ id: "yes", title: "Yes", next: "second" }] },
    { id: "second", type: "BUTTONS", text: "Second?", options: [{ id: "yes", title: "Yes", next: "end" }] },
    { id: "end", type: "END" }
  ] } };
  const initial = planChatbotExecution({ scope, version: sequential, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) });
  const firstDelivery = delivery(initial.state);
  const firstEvent = correlated(initial.state, event("first-reply", { kind: "OPTION", optionId: "yes", title: "Yes" }));
  const next = planChatbotExecution({ scope, version: sequential, state: initial.state, expectedRevision: 1, event: firstEvent, promptDelivery: firstDelivery });
  assert.equal(next.state.stepId, "second");
  assert.notEqual(next.state.expectedPrompt!.id, initial.state.expectedPrompt!.id);
  const late = correlated(initial.state, event("second-reply-to-first", { kind: "OPTION", optionId: "yes", title: "Yes" }));
  assert.equal(late.occurredAt, firstEvent.occurredAt);
  const before = JSON.stringify(next.state);
  assert.throws(() => planChatbotExecution({ scope, version: sequential, state: next.state, expectedRevision: 2, event: late, promptDelivery: firstDelivery }), code("PROMPT_CORRELATION_MISMATCH"));
  assert.equal(JSON.stringify(next.state), before);
  const duplicate = planChatbotExecution({ scope, version: sequential, state: next.state, expectedRevision: 2, event: firstEvent, promptDelivery: firstDelivery });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.commands.length, 0);
  const current = correlated(next.state, event("current-reply", { kind: "OPTION", optionId: "yes", title: "Yes" }));
  assert.equal(planChatbotExecution({ scope, version: sequential, state: next.state, expectedRevision: 2, event: current, promptDelivery: delivery(next.state) }).outcome, "COMPLETED");
});

test("BUTTONS, LIST and INPUT all require actual-context projections, never timestamp inference", () => {
  for (const type of ["BUTTONS", "LIST", "INPUT"] as const) {
    const question = type === "INPUT" ? { id: "ask", type, text: "?", variable: "answer", maxLength: 20, next: "end" }
      : { id: "ask", type, text: "?", ...(type === "LIST" ? { buttonText: "Options" } : {}), options: [{ id: "yes", title: "Yes", next: "end" }] };
    const v = { ...version, definition: { schemaVersion: 1, entryStepId: "ask", steps: [question, { id: "end", type: "END" }] } };
    const initial = planChatbotExecution({ scope, version: v, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) });
    const raw = type === "INPUT" ? event("response", { kind: "TEXT", text: "answer" }) : option();
    const base = { scope, version: v, state: initial.state, expectedRevision: 1 };
    const bound = correlated(initial.state, raw);
    const sent = delivery(initial.state);
    assert.throws(() => planChatbotExecution({ ...base, event: raw }), code("PROMPT_CORRELATION_REQUIRED"));
    assert.throws(() => planChatbotExecution({ ...base, event: bound }), code("PROMPT_CORRELATION_REQUIRED"));
    assert.throws(() => planChatbotExecution({ ...base, event: bound, promptDelivery: { ...sent, providerMessageId: "different-sent-id" } }), code("PROMPT_CORRELATION_MISMATCH"));
    for (const field of Object.keys(scope)) {
      assert.throws(() => planChatbotExecution({ ...base, event: bound, promptDelivery: { ...sent, scope: { ...scope, [field]: "other" } } }), code("PROMPT_CORRELATION_MISMATCH"));
    }
    const result = planChatbotExecution({ ...base, event: bound, promptDelivery: sent });
    assert.equal(result.outcome, "COMPLETED");
    assert.equal(result.confirmation!.status, "CONSISTENT_PROJECTION");
    assert.equal(initial.commands[0].prompt!.id, initial.state.expectedPrompt!.id);
  }
  assert.equal(start().commands[0].prompt, null);
});

test("prompt identity is stable, session/version scoped and retained after invalid input", () => {
  const first = start();
  assert.deepEqual(start().commands, first.commands);
  const otherScope = { ...scope, sessionId: "another-session" };
  const other = planChatbotExecution({ scope: otherScope, version, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) });
  assert.notEqual(other.state.expectedPrompt!.id, first.state.expectedPrompt!.id);
  const otherVersion = planChatbotExecution({ scope: { ...scope, flowVersionId: "v2" }, version: { ...version, id: "v2" }, state: null, expectedRevision: 0, event: event("start", { kind: "START" }) });
  assert.notEqual(otherVersion.state.expectedPrompt!.id, first.state.expectedPrompt!.id);
  const invalid = reply(first.state, event("bad", { kind: "TEXT", text: "not an option" }));
  assert.deepEqual(invalid.state.expectedPrompt, first.state.expectedPrompt);
  const accepted = reply(invalid.state, option());
  assert.equal(accepted.state.stepId, "input");
  const original = correlated(first.state, option());
  const changed = { ...original, reply: { ...original.reply!, contextProviderMessageId: "changed-context" } };
  assert.throws(() => planChatbotExecution({ scope, version, state: accepted.state, expectedRevision: accepted.state.revision, event: changed, promptDelivery: delivery(first.state) }), code("REPLAY_CONFLICT"));
});

test("canonical fingerprint ignores nested object property order, including parsed persisted JSON", () => {
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
  const original = start();
  for (const definition of [reorder(version.definition), JSON.parse(canonicalChatbotValue(version.definition))]) {
    const result = planChatbotExecution({ scope, version: { ...version, definition }, state: original.state, expectedRevision: 1,
      event: correlated(original.state, option()), promptDelivery: delivery(original.state) });
    assert.equal(result.state.definitionFingerprint, original.state.definitionFingerprint);
    assert.equal(result.state.stepId, "input");
  }
  assert.equal(canonicalChatbotValue({ b: { y: 2, x: 1 }, a: [1, 2] }), canonicalChatbotValue({ a: [1, 2], b: { x: 1, y: 2 } }));
  assert.notEqual(canonicalChatbotValue([1, 2]), canonicalChatbotValue([2, 1]));
  const changed = JSON.parse(JSON.stringify(version)) as EngineVersion;
  (changed.definition as { steps: Array<{ options?: unknown[] }> }).steps[1].options!.reverse();
  assert.throws(() => planChatbotExecution({ scope, version: changed, state: original.state, expectedRevision: 1, event: option() }), code("VERSION_CHANGED"));
  for (const invalid of [undefined, NaN, Infinity, new Date(), () => null, { value: undefined }]) assert.throws(() => canonicalChatbotValue(invalid));
  const cycle: { self?: unknown } = {}; cycle.self = cycle;
  assert.throws(() => canonicalChatbotValue(cycle), code("INVALID_PAYLOAD"));
  assert.throws(() => canonicalChatbotValue(new Array(2)), code("INVALID_PAYLOAD"));
  const shared = { value: "same" };
  assert.equal(canonicalChatbotValue([shared, shared]), '[{"value":"same"},{"value":"same"}]');
});

test("only explicit null starts; malformed runtime state never becomes a fresh session", () => {
  for (const state of [undefined, false, 0, "", "state", [], {}, { ...start().state, status: "BOGUS" },
    { ...start().state, expectedPrompt: null }, { ...start().state, receipts: [null] }]) {
    const expectedRevision = state && typeof state === "object" && "revision" in state ? Number(state.revision) : 0;
    assert.throws(() => planChatbotExecution({ scope, version, state: state as EngineState | null, expectedRevision, event: event("start", { kind: "START" }) }), code("INVALID_STATE"));
  }
  assert.equal(start().state.revision, 1);
  const malformed = { ...start().state, status: "BOGUS" } as unknown as EngineState;
  assert.throws(() => planChatbotExecution({ scope, version, state: malformed, expectedRevision: malformed.revision, event: event("start", { kind: "START" }) }), code("INVALID_STATE"));
});

test("CI explicitly executes this engine test file without ignore flags", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const command = workflow.split("\n").find(line => line.includes("run:") && line.includes("src/lib/chatbot-execution-engine.test.ts"));
  assert(command?.includes("--test"));
  assert(!command?.includes("continue-on-error") && !command?.includes("||"));
});
