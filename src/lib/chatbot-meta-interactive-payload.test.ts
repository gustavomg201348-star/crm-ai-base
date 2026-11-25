import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";
import { buildChatbotMetaButtonPayload } from "./chatbot-meta-interactive-payload";

test("CLT buttons produce stable Meta reply identifiers", () => {
  const flow = buildCltQualificationDefinition();
  for (const step of flow.steps) {
    if (step.type !== "BUTTONS") continue;
    const payload = buildChatbotMetaButtonPayload("5531999999999", step);
    assert.equal(payload.messaging_product, "whatsapp");
    assert.equal(payload.type, "interactive");
    assert.equal(payload.interactive.type, "button");
    assert.equal(payload.interactive.body.text, step.text);
    assert.deepEqual(payload.interactive.action.buttons, step.options.map(option => ({
      type: "reply", reply: { id: option.id, title: option.title }
    })));
    assert.throws(() => buildChatbotMetaButtonPayload("+5531999999999", step), /INVALID_DESTINATION/);
    assert.throws(() => buildChatbotMetaButtonPayload("5531999999999", { ...step, options: [] }), /INVALID_DEFINITION/);
    assert.throws(() => buildChatbotMetaButtonPayload("5531999999999", { ...step, options: [...step.options, step.options[0]] }), /INVALID_DEFINITION/);
  }
});
