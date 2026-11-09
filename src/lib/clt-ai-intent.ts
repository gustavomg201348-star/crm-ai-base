/** An LLM proposes intent only; financial parameters never come from this object. */
export const cltAiIntents = ["GENERAL_INFO", "SIMULATION_REQUEST", "VALUE_REQUEST", "INSTALLMENT_REQUEST", "TERM_REQUEST",
  "BANK_REQUEST", "STATUS_REQUEST", "NO_INTEREST", "HUMAN_REQUEST", "UNKNOWN"] as const;
export type CltAiIntent = typeof cltAiIntents[number];
export type CltAiIntentProposal = Readonly<{ intent: CltAiIntent; confidence: number }>;
const unknown = (): CltAiIntentProposal => ({ intent: "UNKNOWN", confidence: 0 });
export function parseCltAiIntent(value: unknown): CltAiIntentProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unknown();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== 2 || !Object.hasOwn(descriptors, "intent") || !Object.hasOwn(descriptors, "confidence")
    || !Object.values(descriptors).every(d => "value" in d)) return unknown();
  const { intent, confidence } = value as Record<string, unknown>;
  if (!cltAiIntents.includes(intent as CltAiIntent) || typeof confidence !== "number" || !Number.isFinite(confidence)
    || confidence < 0 || confidence > 1) return unknown();
  return Object.freeze({ intent: intent as CltAiIntent, confidence });
}
/** Only the current verified customer message is eligible. No history/instructions. */
export function deterministicCltIntent(text: unknown): CltAiIntent {
  if (typeof text !== "string" || text.length > 240 || /[\u0000-\u001f\u007f]/.test(text)) return "UNKNOWN";
  const message = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[.!?]+$/, "").trim();
  const rules: ReadonlyArray<readonly [CltAiIntent, RegExp]> = [
    ["HUMAN_REQUEST", /^(?:quero|preciso|prefiro) falar com (?:um |uma )?(?:humano|humana|atendente|pessoa)$/],
    ["NO_INTEREST", /^(?:nao tenho interesse|nao quero|pare|parar|cancele|cancelar)$/],
    ["GENERAL_INFO", /^(?:como funciona|o que e (?:clt|consignado clt)|pode explicar)$/],
    ["SIMULATION_REQUEST", /^(?:quero|pode|vamos) (?:simular|fazer uma simulacao)(?: (?:clt|consignado clt))?$/],
    ["VALUE_REQUEST", /^(?:quanto (?:consigo|posso receber)|qual (?:o )?valor(?: (?:disponivel|da simulacao))?)$/],
    ["INSTALLMENT_REQUEST", /^(?:qual (?:a )?parcela|quanto fica a parcela)$/],
    ["TERM_REQUEST", /^(?:qual (?:o )?prazo|em quantas (?:parcelas|vezes))$/],
    ["BANK_REQUEST", /^(?:qual (?:o )?banco|quais bancos)$/],
    ["STATUS_REQUEST", /^(?:qual (?:o )?status|como esta a simulacao|a simulacao terminou)$/],
  ];
  return rules.find(([, pattern]) => pattern.test(message))?.[0] ?? "UNKNOWN";
}
export function validateCltAiIntent(proposal: unknown, currentCustomerText: unknown): CltAiIntentProposal {
  const parsed = parseCltAiIntent(proposal), confirmed = deterministicCltIntent(currentCustomerText);
  return parsed.confidence >= 0.9 && parsed.intent === confirmed ? parsed : unknown();
}
