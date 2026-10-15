export type ChatbotOption = { id: string; title: string; next: string; description?: string };
export type ChatbotStep = { id: string } & (
  | { type: "TEXT"; text: string; next: string }
  | { type: "BUTTONS"; text: string; options: ChatbotOption[] }
  | { type: "LIST"; text: string; buttonText: string; options: ChatbotOption[] }
  | { type: "INPUT"; text: string; variable: string; maxLength: number; next: string }
  | { type: "CONDITION"; variable: string; branches: Array<{ equals: string; next: string }>; otherwise: string }
  | { type: "END" }
  | { type: "HANDOFF"; queue: "DEFAULT" }
);
export type ChatbotDefinition = { schemaVersion: 1; entryStepId: string; steps: ChatbotStep[] };

export class ChatbotError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChatbotError";
  }
}

function fail(): never { throw new ChatbotError("INVALID_DEFINITION"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || Array.from(value).length > max) fail();
}
function id(value: unknown): asserts value is string {
  // Opaque labels only; reject common phone/document/email-shaped identifiers.
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(value) || /\d{7}/.test(value)) fail();
}

export function validateChatbotDefinition(input: unknown): ChatbotDefinition {
  let serialized: string;
  try { serialized = JSON.stringify(input); } catch { return fail(); }
  if (!serialized || Buffer.byteLength(serialized) > 65536) return fail();
  const definition = record(JSON.parse(serialized));
  keys(definition, ["schemaVersion", "entryStepId", "steps"]);
  if (definition.schemaVersion !== 1) fail();
  id(definition.entryStepId);
  if (!Array.isArray(definition.steps) || !definition.steps.length || definition.steps.length > 100) fail();
  const edges = new Map<string, string[]>();
  for (const raw of definition.steps) {
    const step = record(raw);
    id(step.id);
    if (edges.has(step.id)) fail();
    const destinations: string[] = [];
    if (step.type === "TEXT" || step.type === "INPUT") {
      keys(step, step.type === "TEXT" ? ["id", "type", "text", "next"] : ["id", "type", "text", "variable", "maxLength", "next"]);
      text(step.text, 1024); id(step.next); destinations.push(step.next);
      if (step.type === "INPUT") {
        id(step.variable);
        if (!Number.isInteger(step.maxLength) || Number(step.maxLength) < 1 || Number(step.maxLength) > 2000) fail();
      }
    } else if (step.type === "BUTTONS" || step.type === "LIST") {
      keys(step, step.type === "BUTTONS" ? ["id", "type", "text", "options"] : ["id", "type", "text", "buttonText", "options"]);
      text(step.text, 1024);
      if (step.type === "LIST") text(step.buttonText, 20);
      if (!Array.isArray(step.options) || !step.options.length || step.options.length > (step.type === "BUTTONS" ? 3 : 10)) fail();
      const options = new Set<string>();
      for (const rawOption of step.options) {
        const option = record(rawOption);
        keys(option, step.type === "LIST" ? ["id", "title", "next", "description"] : ["id", "title", "next"]);
        id(option.id); id(option.next); text(option.title, step.type === "LIST" ? 24 : 20);
        if (option.description !== undefined) text(option.description, 72);
        if (options.has(option.id)) fail();
        options.add(option.id); destinations.push(option.next);
      }
    } else if (step.type === "CONDITION") {
      keys(step, ["id", "type", "variable", "branches", "otherwise"]);
      id(step.variable); id(step.otherwise); destinations.push(step.otherwise);
      if (!Array.isArray(step.branches) || !step.branches.length || step.branches.length > 10) fail();
      const conditions = new Set<string>();
      for (const rawBranch of step.branches) {
        const branch = record(rawBranch);
        keys(branch, ["equals", "next"]); text(branch.equals, 200); id(branch.next);
        if (conditions.has(branch.equals)) fail();
        conditions.add(branch.equals); destinations.push(branch.next);
      }
    } else if (step.type === "END") {
      keys(step, ["id", "type"]);
    } else if (step.type === "HANDOFF") {
      keys(step, ["id", "type", "queue"]);
      if (step.queue !== "DEFAULT") fail();
    } else fail();
    edges.set(step.id, destinations);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(stepId: string) {
    if (!edges.has(stepId) || visiting.has(stepId)) fail();
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    for (const next of edges.get(stepId)!) visit(next);
    visiting.delete(stepId); visited.add(stepId);
  }
  visit(definition.entryStepId);
  if (visited.size !== edges.size) fail();
  return definition as unknown as ChatbotDefinition;
}
