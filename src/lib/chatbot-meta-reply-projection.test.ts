import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";
import { planChatbotExecution, type EngineState } from "./chatbot-execution-engine";
import { projectChatbotMetaReply } from "./chatbot-meta-reply-projection";
import { createReplySnapshot, replyContentDigest } from "./meta-reply-snapshot";

const scope = { companyId: "company", channelId: "channel", conversationId: "conversation", contactId: "contact", flowId: "flow", flowVersionId: "version", sessionId: "session" };
const version = { companyId: scope.companyId, flowId: scope.flowId, id: scope.flowVersionId, status: "PUBLISHED", definition: buildCltQualificationDefinition() };
const time = "2026-11-25T12:00:00.000Z";
const start = () => planChatbotExecution({ scope, version, state: null, expectedRevision: 0, event: { id: "start", kind: "START", occurredAt: time } }).state;
function fixture(state: EngineState, id: string | null, body: string, sequence: number, overrides: { companyId?: string; contextProviderMessageId?: string | null } = {}) {
  const delivery = { scope, promptId: state.expectedPrompt!.id, providerMessageId: "sent-" + state.expectedPrompt!.id };
  const messageType = id ? "interactive" : "text";
  const snapshot = createReplySnapshot({ ...scope, providerMessageId: "inbound-" + sequence,
    contextProviderMessageId: delivery.providerMessageId, senderPhone: "5531999999999",
    metadata: { interactionType: id ? "INTERACTIVE_BUTTON" : "TEXT", optionId: id, optionTitle: id ? "Resposta" : null,
      optionIdentity: id ? "PROVIDER_ID" : "NOT_APPLICABLE", sourceTimestamp: new Date(time), timestampRaw: null, limitations: [] },
    contentDigest: replyContentDigest({ body, type: messageType }), ...overrides });
  return { state, version, delivery, snapshot, body, messageType };
}

test("CLT competitor and desired amount paths reach inert handoff", () => {
  const competitor = projectChatbotMetaReply(fixture(start(), "clt_received", "Resposta interativa: Resposta", 1));
  assert.equal(competitor.state.stepId, "competitor");
  const done = projectChatbotMetaReply(fixture(competitor.state, null, "R$ 8000, 24x de 490", 2));
  assert.equal(done.outcome, "HANDOFF");
  assert.equal(done.state.variables.competitor_offer, "R$ 8000, 24x de 490");
  assert.equal(done.executable, false);
  const need = projectChatbotMetaReply(fixture(start(), "clt_not_received", "Resposta interativa: Resposta", 3));
  const amount = projectChatbotMetaReply(fixture(need.state, "clt_specific_amount", "Resposta interativa: Resposta", 4));
  const desired = projectChatbotMetaReply(fixture(amount.state, null, "R$ 5000", 5));
  assert.equal(desired.outcome, "HANDOFF");
  assert.equal(desired.state.variables.desired_amount, "R$ 5000");
  assert.equal(projectChatbotMetaReply(fixture(need.state, "clt_max_amount", "Resposta interativa: Resposta", 6)).outcome, "HANDOFF");
  assert.equal(projectChatbotMetaReply(fixture(start(), "clt_human", "Resposta interativa: Resposta", 7)).outcome, "HANDOFF");
});

test("rejects cross-tenant, stale context, missing context and altered content", () => {
  const state = start();
  const body = "Resposta interativa: Resposta";
  assert.throws(() => projectChatbotMetaReply(fixture(state, "clt_received", body, 1, { companyId: "foreign" })), /REPLY_SCOPE_MISMATCH/);
  assert.throws(() => projectChatbotMetaReply(fixture(state, "clt_received", body, 1, { contextProviderMessageId: "old" })), /PROMPT_CORRELATION_MISMATCH/);
  assert.throws(() => projectChatbotMetaReply(fixture(state, "clt_received", body, 1, { contextProviderMessageId: null })), /PROMPT_CORRELATION_REQUIRED/);
  assert.throws(() => projectChatbotMetaReply({ ...fixture(state, "clt_received", body, 1), body: "altered" }), /REPLY_CONTENT_MISMATCH/);
});
