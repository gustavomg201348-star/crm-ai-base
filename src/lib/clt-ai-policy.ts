import { hasUsableCpf } from "./ai-response-facts";
import { parseCltAiIntent, type CltAiIntent } from "./clt-ai-intent";

export type CltAiAction = "REPLY_ONLY" | "ASK_CPF" | "NEED_HUMAN_AUTHORIZATION" | "PREPARE_SIMULATION"
  | "WAIT_SIMULATION" | "PRESENT_OFFERS" | "TRANSFER_HUMAN" | "STOP";
export type CltAiDecision = Readonly<{ intent: CltAiIntent; nextAction: CltAiAction; confidence: number }>;
/** Server-resolved facts; never populate this snapshot from model JSON. */
export type CltAiPolicyFacts = Readonly<{
  currentVerifiedInbound: boolean; bindingValid: boolean; authorityCurrent: boolean; unassigned: boolean; conversationOpen: boolean;
  contactCpf: string | null; commercialAccess: boolean; remoteIdentity: boolean; simulationAuthorization: boolean;
  explicitBankConfigured: boolean; existingOperation: "NONE" | "PENDING" | "UNKNOWN" | "WAITING_AUTHORIZATION" | "COMPLETED";
  persistedOfferFactsReady: boolean;
}>;
export function decideCltAiAction(proposal: unknown, facts: CltAiPolicyFacts): CltAiDecision {
  const parsed = parseCltAiIntent(proposal);
  const decision = (nextAction: CltAiAction): CltAiDecision => Object.freeze({ ...parsed, nextAction });
  if (!facts.currentVerifiedInbound || !facts.bindingValid || !facts.authorityCurrent || !facts.unassigned || !facts.conversationOpen) return decision("STOP");
  if (parsed.intent === "HUMAN_REQUEST") return decision("TRANSFER_HUMAN");
  if (parsed.intent === "NO_INTEREST") return decision("STOP");
  if (parsed.confidence < 0.9 || ["UNKNOWN", "GENERAL_INFO"].includes(parsed.intent)) return decision("REPLY_ONLY");
  if (!hasUsableCpf(facts.contactCpf)) return decision("ASK_CPF");
  if (!facts.commercialAccess || !facts.remoteIdentity || !facts.simulationAuthorization) return decision("NEED_HUMAN_AUTHORIZATION");
  if (facts.existingOperation === "UNKNOWN" || facts.existingOperation === "WAITING_AUTHORIZATION") return decision("TRANSFER_HUMAN");
  if (facts.existingOperation === "PENDING") return decision("WAIT_SIMULATION");
  if (facts.existingOperation === "COMPLETED") return decision(facts.persistedOfferFactsReady ? "PRESENT_OFFERS" : "REPLY_ONLY");
  if (!facts.explicitBankConfigured) return decision("NEED_HUMAN_AUTHORIZATION");
  // Questions about terms/status/bank never authorize a fresh paid consultation.
  return decision(["SIMULATION_REQUEST", "VALUE_REQUEST"].includes(parsed.intent) ? "PREPARE_SIMULATION" : "REPLY_ONLY");
}
