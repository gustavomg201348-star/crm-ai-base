import { createHash } from "node:crypto";
import { ChatbotError, validateChatbotDefinition, type ChatbotStep } from "./chatbot-definition";
import { canonicalChatbotValue } from "./chatbot-canonical";

export type EngineScope = {
  companyId: string; channelId: string; conversationId: string; contactId: string;
  flowId: string; flowVersionId: string; sessionId: string;
};
export type LogicalPrompt = { id: string; stepId: string; issuedRevision: number; kind: "BUTTONS" | "LIST" | "INPUT" };
export type ReplyEvidence = { promptId: string; inboundProviderMessageId: string; contextProviderMessageId: string };
export type PromptDelivery = { scope: EngineScope; promptId: string; providerMessageId: string };
export type EngineVersion = { companyId: string; flowId: string; id: string; status: string; definition: unknown };
export type EngineEvent = { id: string; occurredAt: string; reply?: ReplyEvidence } & (
  | { kind: "START" }
  | { kind: "TEXT"; text: string }
  | { kind: "OPTION"; optionId: string | null; title: string | null }
);
export type EngineState = {
  scope: EngineScope; definitionFingerprint: string; stepId: string; waiting: boolean; revision: number;
  status: "ACTIVE" | "CLOSED"; authority: "CHATBOT" | "HUMAN" | "NONE";
  closureReason: "COMPLETED" | "HUMAN_HANDOFF" | null;
  variables: Record<string, string>; lastOccurredAt: string | null;
  expectedPrompt: LogicalPrompt | null;
  receipts: Array<{ id: string; inboundProviderMessageId: string | null; fingerprint: string }>; stepsExecuted: number;
};
type MessageStep = Extract<ChatbotStep, { type: "TEXT" | "BUTTONS" | "LIST" | "INPUT" }>;
export type EnginePlan = {
  executable: false; state: EngineState; duplicate: boolean;
  outcome: "WAITING" | "COMPLETED" | "HANDOFF" | "INVALID_REPLY" | "AMBIGUOUS_REPLY";
  commands: Array<{ idempotencyKey: string; payload: MessageStep; prompt: LogicalPrompt | null }>;
  confirmation: { status: "CONSISTENT_PROJECTION"; promptId: string; inboundProviderMessageId: string; outboundProviderMessageId: string } | null;
  handoff: { queue: "DEFAULT"; assignTo: null; executionAllowed: false } | null;
  decisions: Array<{ stepId: string; code: string }>;
};

function ensure(value: unknown, code: string): asserts value {
  if (!value) throw new ChatbotError(code);
}
function reference(value: unknown) {
  ensure(typeof value === "string" && value.trim().length > 0 && value.length <= 2048, "INVALID_SCOPE");
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype);
}
function scopeKey(scope: EngineScope) {
  ensure(record(scope), "INVALID_SCOPE");
  const values = [scope.companyId, scope.channelId, scope.conversationId, scope.contactId, scope.flowId, scope.flowVersionId, scope.sessionId];
  values.forEach(reference);
  return JSON.stringify(values);
}
function time(value: unknown) {
  ensure(typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, "INVALID_TIME");
  return Date.parse(value);
}
function promptIdentity(key: string, definitionFingerprint: string, stepId: string, issuedRevision: number) {
  return createHash("sha256").update(canonicalChatbotValue([key, definitionFingerprint, stepId, issuedRevision])).digest("hex");
}
function eventFingerprint(event: EngineEvent, delivery?: PromptDelivery | null) {
  reference(event.id); time(event.occurredAt);
  if (event.reply !== undefined) {
    ensure(event.kind !== "START" && record(event.reply), "INVALID_REPLY_EVIDENCE");
    [event.reply.promptId, event.reply.inboundProviderMessageId, event.reply.contextProviderMessageId].forEach(reference);
  }
  if (delivery !== undefined && delivery !== null) {
    ensure(event.kind !== "START" && record(delivery), "INVALID_PROMPT_DELIVERY");
    scopeKey(delivery.scope); reference(delivery.promptId); reference(delivery.providerMessageId);
  }
  let content: unknown;
  if (event.kind === "START") content = [];
  else if (event.kind === "TEXT") {
    ensure(typeof event.text === "string" && event.text.trim().length > 0 && Array.from(event.text).length <= 2000, "INVALID_EVENT");
    content = [event.text];
  } else {
    ensure(event.kind === "OPTION", "INVALID_EVENT");
    ensure(event.optionId === null || (typeof event.optionId === "string" && event.optionId.length > 0 && event.optionId.length <= 256), "INVALID_EVENT");
    ensure(event.title === null || (typeof event.title === "string" && event.title.length > 0 && event.title.length <= 256), "INVALID_EVENT");
    ensure(event.optionId !== null || event.title !== null, "INVALID_EVENT");
    content = [event.optionId, event.title];
  }
  return createHash("sha256").update(canonicalChatbotValue([
    event.kind, event.occurredAt, content, event.reply ?? null, delivery ?? null
  ])).digest("hex");
}

// Simulation only. There is deliberately no Prisma, session writer, outbox writer or sender.
export function planChatbotExecution(input: {
  scope: EngineScope; version: EngineVersion | null; state: EngineState | null;
  expectedRevision: number; event: EngineEvent; maxSteps?: number; promptDelivery?: PromptDelivery | null;
}): EnginePlan {
  ensure(record(input), "INVALID_INPUT");
  ensure(input.state === null || record(input.state), "INVALID_STATE");
  if (input.state !== null) {
    const required = ["scope", "definitionFingerprint", "stepId", "waiting", "revision", "status", "authority", "closureReason", "variables", "lastOccurredAt", "expectedPrompt", "receipts", "stepsExecuted"];
    ensure(required.every(field => Object.hasOwn(input.state!, field)) && Object.keys(input.state).every(field => required.includes(field)), "INVALID_STATE");
    ensure(Number.isSafeInteger(input.state.revision) && input.state.revision >= 0, "INVALID_REVISION");
  }
  const key = scopeKey(input.scope);
  ensure(input.version, "VERSION_NOT_FOUND");
  ensure(input.version.companyId === input.scope.companyId && input.version.flowId === input.scope.flowId
    && input.version.id === input.scope.flowVersionId, "VERSION_SCOPE_MISMATCH");
  ensure(input.version.status === "PUBLISHED", "VERSION_NOT_PUBLISHED");
  const definition = validateChatbotDefinition(input.version.definition);
  canonicalChatbotValue(input.version.definition);
  const definitionFingerprint = createHash("sha256").update(canonicalChatbotValue(definition)).digest("hex");
  const steps = new Map(definition.steps.map(step => [step.id, step]));
  ensure(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision >= 0, "INVALID_REVISION");
  const maxSteps = input.maxSteps ?? 100;
  ensure(Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 100, "INVALID_STEP_LIMIT");
  ensure(record(input.event), "INVALID_EVENT");
  const fingerprint = eventFingerprint(input.event, input.promptDelivery);
  const state: EngineState = input.state !== null ? JSON.parse(canonicalChatbotValue(input.state)) : {
    scope: { ...input.scope }, definitionFingerprint, stepId: definition.entryStepId, waiting: false, revision: 0,
    status: "ACTIVE", authority: "CHATBOT", closureReason: null, variables: {},
    lastOccurredAt: null, expectedPrompt: null, receipts: [], stepsExecuted: 0
  };
  ensure(scopeKey(state.scope) === key, "STATE_SCOPE_MISMATCH");
  ensure(state.definitionFingerprint === definitionFingerprint, "VERSION_CHANGED");
  ensure(Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision === input.expectedRevision, "REVISION_CONFLICT");
  ensure(typeof state.waiting === "boolean" && steps.has(state.stepId), "INVALID_STATE");
  ensure(Number.isInteger(state.stepsExecuted) && state.stepsExecuted >= 0 && state.stepsExecuted <= 100, "INVALID_STATE");
  ensure(Array.isArray(state.receipts) && state.receipts.length <= 100, "INVALID_STATE");
  ensure(state.revision === state.receipts.length, "INVALID_STATE_REVISION");
  ensure(record(state.variables), "INVALID_STATE");
  ensure(Object.keys(state.variables).length <= 100 && Object.entries(state.variables).every(([name, value]) =>
    /^[a-z][a-z0-9_-]{0,63}$/.test(name) && typeof value === "string" && Array.from(value).length <= 2000), "INVALID_STATE");
  const ids = new Set<string>();
  const inboundIds = new Set<string>();
  for (const receipt of state.receipts) {
    ensure(record(receipt), "INVALID_STATE");
    reference(receipt.id);
    ensure(!ids.has(receipt.id) && /^[a-f0-9]{64}$/.test(receipt.fingerprint), "INVALID_STATE");
    ensure(Object.keys(receipt).length === 3 && Object.hasOwn(receipt, "inboundProviderMessageId"), "INVALID_STATE");
    if (receipt.inboundProviderMessageId !== null) {
      reference(receipt.inboundProviderMessageId);
      ensure(!inboundIds.has(receipt.inboundProviderMessageId), "INVALID_STATE");
      inboundIds.add(receipt.inboundProviderMessageId);
    }
    ids.add(receipt.id);
  }
  ensure(state.lastOccurredAt === null || typeof state.lastOccurredAt === "string", "INVALID_STATE");
  if (state.lastOccurredAt !== null) time(state.lastOccurredAt);
  ensure(["ACTIVE", "CLOSED"].includes(state.status) && ["CHATBOT", "HUMAN", "NONE"].includes(state.authority), "INVALID_STATE");
  ensure(state.status === "ACTIVE" ? state.closureReason === null :
    !state.waiting && ((state.closureReason === "COMPLETED" && state.authority === "NONE" && steps.get(state.stepId)!.type === "END") ||
      (state.closureReason === "HUMAN_HANDOFF" && state.authority === "HUMAN" && steps.get(state.stepId)!.type === "HANDOFF")), "INVALID_STATE");
  if (input.state !== null) ensure(state.revision >= 1 && state.stepsExecuted >= 1
    && state.lastOccurredAt !== null && state.receipts.length >= 1
    && (state.status === "CLOSED" || state.waiting), "INVALID_STATE");
  if (state.waiting) {
    const prompt = state.expectedPrompt;
    ensure(record(prompt) && prompt.stepId === state.stepId && prompt.kind === steps.get(state.stepId)!.type
      && ["BUTTONS", "LIST", "INPUT"].includes(prompt.kind)
      && Number.isSafeInteger(prompt.issuedRevision) && prompt.issuedRevision >= 1 && prompt.issuedRevision <= state.revision
      && prompt.id === promptIdentity(key, definitionFingerprint, prompt.stepId, prompt.issuedRevision), "INVALID_STATE");
  } else ensure(state.expectedPrompt === null, "INVALID_STATE");
  const result: EnginePlan = {
    executable: false, state, duplicate: false, outcome: "WAITING", commands: [], confirmation: null, handoff: null, decisions: []
  };
  const inboundProviderMessageId = input.event.reply?.inboundProviderMessageId ?? null;
  const receipt = state.receipts.find(item => item.id === input.event.id);
  const inboundReceipt = inboundProviderMessageId === null ? undefined :
    state.receipts.find(item => item.inboundProviderMessageId === inboundProviderMessageId);
  ensure(!receipt || !inboundReceipt || receipt === inboundReceipt, "REPLAY_CONFLICT");
  const existing = receipt ?? inboundReceipt;
  if (existing) {
    ensure(existing.inboundProviderMessageId === inboundProviderMessageId && existing.fingerprint === fingerprint, "REPLAY_CONFLICT");
    result.duplicate = true;
    result.outcome = state.closureReason === "HUMAN_HANDOFF" ? "HANDOFF" : state.status === "CLOSED" ? "COMPLETED" : "WAITING";
    return result;
  }
  ensure(state.status === "ACTIVE" && state.closureReason === null, "SESSION_NOT_ACTIVE");
  ensure(state.authority === "CHATBOT", "AUTHORITY_UNAVAILABLE");
  ensure(state.receipts.length < 100, "EVENT_LIMIT");
  ensure(state.lastOccurredAt === null || time(input.event.occurredAt) >= time(state.lastOccurredAt), "EVENT_OUT_OF_ORDER");
  ensure(input.state !== null ? input.event.kind !== "START" && state.waiting : input.event.kind === "START", "INVALID_TRANSITION");
  if (state.waiting) {
    const evidence = input.event.reply;
    const delivery = input.promptDelivery;
    ensure(evidence && delivery, "PROMPT_CORRELATION_REQUIRED");
    ensure(evidence.promptId === state.expectedPrompt!.id && delivery.promptId === state.expectedPrompt!.id
      && scopeKey(delivery.scope) === key && evidence.contextProviderMessageId === delivery.providerMessageId, "PROMPT_CORRELATION_MISMATCH");
    result.confirmation = { status: "CONSISTENT_PROJECTION", promptId: evidence.promptId,
      inboundProviderMessageId: evidence.inboundProviderMessageId, outboundProviderMessageId: delivery.providerMessageId };
  }
  const nextRevision = state.revision + 1;
  ensure(Number.isSafeInteger(nextRevision), "REVISION_OVERFLOW");
  state.receipts.push({ id: input.event.id, inboundProviderMessageId, fingerprint });
  state.lastOccurredAt = input.event.occurredAt;
  state.revision = nextRevision;
  const decision = (stepId: string, code: string) => result.decisions.push({ stepId, code });

  if (state.waiting) {
    const step = steps.get(state.stepId)!;
    let next: string | undefined;
    if (step.type === "INPUT" && input.event.kind === "TEXT" && Array.from(input.event.text).length <= step.maxLength) {
      state.variables[step.variable] = input.event.text;
      next = step.next;
    } else if ((step.type === "BUTTONS" || step.type === "LIST") && input.event.kind === "OPTION") {
      const event = input.event;
      // A supplied provider ID is authoritative: never rescue an invalid ID using a title.
      const matches = step.options.filter(option => event.optionId !== null ? option.id === event.optionId : option.title === event.title);
      if (matches.length > 1) {
        decision(step.id, "AMBIGUOUS_TITLE"); result.outcome = "AMBIGUOUS_REPLY"; return result;
      }
      if (matches.length === 1) next = matches[0].next;
    }
    if (!next) {
      decision(step.id, "INVALID_REPLY"); result.outcome = "INVALID_REPLY"; return result;
    }
    decision(step.id, "REPLY_ACCEPTED");
    state.stepId = next; state.waiting = false; state.expectedPrompt = null;
  }

  const visited = new Set<string>();
  while (!state.waiting && state.status === "ACTIVE") {
    ensure(!visited.has(state.stepId) && state.stepsExecuted < maxSteps, "STEP_LIMIT");
    visited.add(state.stepId); state.stepsExecuted++;
    const step = steps.get(state.stepId);
    ensure(step, "STEP_NOT_FOUND");
    decision(step.id, step.type);
    if (step.type === "CONDITION") {
      const value = Object.hasOwn(state.variables, step.variable) ? state.variables[step.variable] : undefined;
      state.stepId = step.branches.find(branch => branch.equals === value)?.next ?? step.otherwise;
    } else if (step.type === "END" || step.type === "HANDOFF") {
      state.status = "CLOSED";
      state.closureReason = step.type === "END" ? "COMPLETED" : "HUMAN_HANDOFF";
      state.authority = step.type === "END" ? "NONE" : "HUMAN";
      result.outcome = step.type === "END" ? "COMPLETED" : "HANDOFF";
      if (step.type === "HANDOFF") result.handoff = { queue: "DEFAULT", assignTo: null, executionAllowed: false };
    } else {
      const prompt: LogicalPrompt | null = step.type === "TEXT" ? null : {
        id: promptIdentity(key, definitionFingerprint, step.id, state.revision),
        stepId: step.id, issuedRevision: state.revision, kind: step.type
      };
      result.commands.push({
        idempotencyKey: createHash("sha256").update(JSON.stringify([key, input.event.id, fingerprint, step.id])).digest("hex"),
        payload: step, prompt
      });
      if (step.type === "TEXT") state.stepId = step.next;
      else { state.waiting = true; state.expectedPrompt = prompt; }
    }
  }
  return result;
}

export type ActivationEvidence = {
  scope: EngineScope; correlationScope: EngineScope; correlationStatus: string;
  explicitBindingVerified: boolean; inboundValid: boolean; humanActive: boolean;
  existingAiHasAuthority: boolean; metaWindowOpen: boolean;
};

// Even complete projected evidence cannot authorize writes without shared arbitration.
export function assessChatbotActivation(input: ActivationEvidence): { allowed: false; reasons: string[] } {
  ensure(input && typeof input === "object", "INVALID_INPUT");
  const sameScope = scopeKey(input.scope) === scopeKey(input.correlationScope);
  for (const field of [input.explicitBindingVerified, input.inboundValid, input.humanActive, input.existingAiHasAuthority, input.metaWindowOpen]) {
    ensure(typeof field === "boolean", "INVALID_ACTIVATION_EVIDENCE");
  }
  const reasons = ["SHARED_AUTHORITY_NOT_INTEGRATED", "ACTIVATION_NOT_IMPLEMENTED"];
  if (!sameScope) reasons.push("CORRELATION_SCOPE_MISMATCH");
  if (input.correlationStatus !== "CONFIRMED") reasons.push("CORRELATION_NOT_CONFIRMED");
  if (!input.explicitBindingVerified) reasons.push("EXPLICIT_FLOW_BINDING_REQUIRED");
  if (!input.inboundValid) reasons.push("VALID_INBOUND_REQUIRED");
  if (input.humanActive) reasons.push("HUMAN_CONTROL_REQUIRED");
  if (input.existingAiHasAuthority) reasons.push("AI_AUTHORITY_OCCUPIED");
  if (!input.metaWindowOpen) reasons.push("META_WINDOW_UNVERIFIED_OR_CLOSED");
  return { allowed: false, reasons };
}
