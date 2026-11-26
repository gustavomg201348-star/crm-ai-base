import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCltQualificationDefinition } from "./chatbot-clt-qualification";

test("CLT qualification definition validates and offers human handoff", () => {
  const flow = buildCltQualificationDefinition();
  const entry = flow.steps.find(step => step.id === flow.entryStepId);
  assert.ok(entry && entry.type === "BUTTONS");
  assert.deepEqual(entry.options.map(option => option.next), ["competitor", "need", "final_message"]);
  const need = flow.steps.find(step => step.id === "need");
  assert.ok(need && need.type === "BUTTONS");
  assert.deepEqual(need.options.map(option => option.next), ["amount", "final_message", "final_message"]);
  for (const id of ["competitor", "amount"]) {
    const step = flow.steps.find(item => item.id === id);
    assert.ok(step && step.type === "INPUT");
    assert.equal(step.next, id === "competitor" ? "competitor_check" : "final_message");
  }
  const priority = flow.steps.find(step => step.id === "priority");
  assert.ok(priority?.type === "BUTTONS");
  assert.deepEqual(priority.options.map(option => option.title), ["Maior valor", "Menor parcela", "Menor prazo"]);
  const goodbye = flow.steps.find(step => step.id === "final_message");
  assert.ok(goodbye?.type === "TEXT");
  assert.equal(goodbye.next, "handoff");
  assert.match(goodbye.text, /😊$/);
  assert.deepEqual(flow.steps.find(step => step.id === "handoff"), { id: "handoff", type: "HANDOFF", queue: "DEFAULT" });
});
