import { ChatbotError, validateChatbotDefinition } from "./chatbot-definition";
import type { ChatbotStep } from "./chatbot-definition";

type ButtonStep = Extract<ChatbotStep, { type: "BUTTONS" }>;

// Pure payload preparation only. This does not authorize or perform transport.
export function buildChatbotMetaButtonPayload(to: string, step: ButtonStep) {
  if (typeof to !== "string" || !/^[1-9][0-9]{7,14}$/.test(to)) {
    throw new ChatbotError("INVALID_DESTINATION");
  }
  if (!step || step.type !== "BUTTONS" || !Array.isArray(step.options)) {
    throw new ChatbotError("INVALID_DEFINITION");
  }
  const destinations = Array.from(new Set(step.options.map(option => option.next)));
  const validated = validateChatbotDefinition({
    schemaVersion: 1,
    entryStepId: step.id,
    steps: [step, ...destinations.map(id => ({ id, type: "END" }))]
  }).steps[0];
  if (validated.type !== "BUTTONS") throw new ChatbotError("INVALID_DEFINITION");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: validated.text },
      action: {
        buttons: validated.options.map(option => ({
          type: "reply",
          reply: { id: option.id, title: option.title }
        }))
      }
    }
  };
}
