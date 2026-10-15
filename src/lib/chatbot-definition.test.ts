import assert from "node:assert/strict";
import test from "node:test";
import { validateChatbotDefinition } from "./chatbot-definition";

const valid = () => ({ schemaVersion: 1, entryStepId: "intro", steps: [
  { id: "intro", type: "TEXT", text: "Bem-vindo", next: "menu" },
  { id: "menu", type: "BUTTONS", text: "Como podemos ajudar?", options: [{ id: "service", title: "Atendimento", next: "human" }, { id: "other", title: "Outra opcao", next: "list" }] },
  { id: "list", type: "LIST", text: "Escolha", buttonText: "Opcoes", options: [{ id: "answer", title: "Continuar", next: "input", description: "Pergunta" }] },
  { id: "input", type: "INPUT", text: "Sua preferencia?", variable: "preference", maxLength: 100, next: "condition" },
  { id: "condition", type: "CONDITION", variable: "preference", branches: [{ equals: "humano", next: "human" }], otherwise: "end" },
  { id: "human", type: "HANDOFF", queue: "DEFAULT" }, { id: "end", type: "END" }
] });

test("definition supports all seven step types and default human queue", () => {
  assert.equal(validateChatbotDefinition(valid()).steps.length, 7);
});
test("definition is cloned and preserves stable option identifiers", () => {
  const input = valid();
  const output = validateChatbotDefinition(input);
  assert.deepEqual(output, input);
  assert.notEqual(output, input);
});
test("definition rejects missing destinations, duplicate steps and unreachable nodes", () => {
  const missing = valid(); missing.steps[0].next = "missing";
  assert.throws(() => validateChatbotDefinition(missing));
  const duplicate = valid(); duplicate.steps.push(duplicate.steps[0]);
  assert.throws(() => validateChatbotDefinition(duplicate));
  const unreachable = valid(); unreachable.steps.push({ id: "unused", type: "END" });
  assert.throws(() => validateChatbotDefinition(unreachable));
});
test("definition rejects cycles including cycles through input or conditions", () => {
  const cycle = valid(); cycle.steps[0].next = "intro";
  assert.throws(() => validateChatbotDefinition(cycle));
  const condition = valid(); condition.steps[4].otherwise = "input";
  assert.throws(() => validateChatbotDefinition(condition));
});
test("definition rejects excessive options, invalid labels and sensitive-shaped IDs", () => {
  const buttons = valid(); buttons.steps[1].options = Array.from({ length: 4 }, (_, i) => ({ id: `option_${i}`, title: "Opcao", next: "end" }));
  assert.throws(() => validateChatbotDefinition(buttons));
  const list = valid(); list.steps[2].options = Array.from({ length: 11 }, (_, i) => ({ id: `option_${i}`, title: "Opcao", next: "input" }));
  assert.throws(() => validateChatbotDefinition(list));
  const pii = valid(); pii.steps[1].options![0].id = "customer_5511999999999";
  assert.throws(() => validateChatbotDefinition(pii));
  const duplicate = valid(); duplicate.steps[1].options![1].id = "service";
  assert.throws(() => validateChatbotDefinition(duplicate));
});
test("definition rejects unknown fields, empty text, wrong schema and oversized graph", () => {
  assert.throws(() => validateChatbotDefinition({ ...valid(), execute: "code" }));
  assert.throws(() => validateChatbotDefinition({ ...valid(), schemaVersion: 2 }));
  const empty = valid(); empty.steps[0].text = " ";
  assert.throws(() => validateChatbotDefinition(empty));
  assert.throws(() => validateChatbotDefinition({ schemaVersion: 1, entryStepId: "end", steps: Array.from({ length: 101 }, (_, i) => ({ id: `end_${i}`, type: "END" })) }));
});
