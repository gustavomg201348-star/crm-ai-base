import { ChatbotError } from "./chatbot-definition";
import { planChatbotExecution, type EngineEvent, type EngineState, type EngineVersion, type PromptDelivery } from "./chatbot-execution-engine";
import { readReplySnapshot, replyContentDigest } from "./meta-reply-snapshot";

// Pure adapter. Caller must separately prove persisted provenance, no quarantine,
// immutable delivery mapping and shared authority. No runtime activation.
export function projectChatbotMetaReply(input: {
  state: EngineState; version: EngineVersion; delivery: PromptDelivery;
  snapshot: string; body: string; messageType: string;
}) {
  const snapshot = readReplySnapshot(input.snapshot);
  const scope = input.state.scope;
  if (snapshot.companyId !== scope.companyId || snapshot.channelId !== scope.channelId ||
      snapshot.conversationId !== scope.conversationId || snapshot.contactId !== scope.contactId) {
    throw new ChatbotError("REPLY_SCOPE_MISMATCH");
  }
  if (!snapshot.contextProviderMessageId || !snapshot.metadata.sourceTimestamp ||
      !input.state.expectedPrompt) throw new ChatbotError("PROMPT_CORRELATION_REQUIRED");
  if (snapshot.contentDigest !== replyContentDigest({ body: input.body, type: input.messageType })) {
    throw new ChatbotError("REPLY_CONTENT_MISMATCH");
  }
  const evidence = {
    id: snapshot.providerMessageId,
    occurredAt: snapshot.metadata.sourceTimestamp,
    reply: { promptId: input.state.expectedPrompt.id, inboundProviderMessageId: snapshot.providerMessageId,
      contextProviderMessageId: snapshot.contextProviderMessageId }
  };
  let event: EngineEvent;
  if (snapshot.metadata.interactionType === "INTERACTIVE_BUTTON" && input.messageType === "interactive" &&
      snapshot.metadata.optionIdentity === "PROVIDER_ID" && snapshot.metadata.optionId) {
    event = { ...evidence, kind: "OPTION", optionId: snapshot.metadata.optionId, title: snapshot.metadata.optionTitle };
  } else if (snapshot.metadata.interactionType === "TEXT" && input.messageType === "text") {
    event = { ...evidence, kind: "TEXT", text: input.body };
  } else {
    throw new ChatbotError("UNSUPPORTED_CHATBOT_REPLY");
  }
  return planChatbotExecution({ scope, version: input.version, state: input.state,
    expectedRevision: input.state.revision, event, promptDelivery: input.delivery });
}
