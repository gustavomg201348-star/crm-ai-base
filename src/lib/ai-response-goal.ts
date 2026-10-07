import { normalizeFactText, productFromText, type CustomerFacts, type ProposalFacts } from "@/lib/ai-response-facts";
import type { ValidatedAiReply } from "@/lib/ai-response-schema";

export type ResponseGoal = {
  intent: "AMOUNT" | "INSTALLMENT" | "TERM" | "BANK" | "APPROVAL" | "PAYMENT_DATE" | "CPF" | "UNSUPPORTED_FINANCIAL_FACT" | "UNKNOWN";
  action: "ANSWER_RECORDED_FACT" | "ASK_FOR_MISSING_INFO" | "HUMAN_VALIDATION" | "CLARIFY_REQUEST";
  nextRequiredInformation: "PRODUCT" | null;
  canAnswerDirectly: boolean;
  nextAction: string;
  safeReply: string;
  shouldTransferToHuman: boolean;
};

function money(value: string) {
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function buildResponseGoal({ question, customer, proposal, proposalSelection, requestedProduct }: {
  question: string | null;
  customer: CustomerFacts;
  proposal: ProposalFacts | null;
  proposalSelection: "SELECTED" | "NONE" | "UNKNOWN";
  requestedProduct?: string | null;
}): ResponseGoal {
  const text = normalizeFactText(question ?? "");
  const intents: ResponseGoal["intent"][] = [];
  if (/\b(?:quanto|valor)\b/.test(text) && (!/\bparcela\b/.test(text) || /\b(?:libera|liberado|recebo)\b/.test(text))) intents.push("AMOUNT");
  if (/\bparcela\b/.test(text)) intents.push("INSTALLMENT");
  if (/\b(?:prazo|quantas parcelas|quantos meses)\b/.test(text)) intents.push("TERM");
  if (/\bqual (?:o )?banco\b/.test(text)) intents.push("BANK");
  if (/\b(?:aprovou|aprovad[oa])\b/.test(text)) intents.push("APPROVAL");
  if (/\b(?:quando|hoje)\b.*\b(?:cai|deposit|pagamento|descont)|\bquando\b.*\blibera/.test(text)) intents.push("PAYMENT_DATE");
  if (/\bcpf\b/.test(text)) intents.push("CPF");
  if (/\b(?:taxa|cet|margem|limite|amortizar|amortizacao)\b/.test(text)) intents.push("UNSUPPORTED_FINANCIAL_FACT");
  const intent = intents.length === 1 ? intents[0] : "UNKNOWN";
  const base = { intent, nextRequiredInformation: null, canAnswerDirectly: false };
  const answer = (safeReply: string, nextAction: string): ResponseGoal => ({ ...base,
    action: "ANSWER_RECORDED_FACT", canAnswerDirectly: true, safeReply, nextAction, shouldTransferToHuman: false });
  if (intent === "CPF" && customer.hasCpf) return answer(
    "Seu CPF ja esta cadastrado; nao precisa envia-lo novamente neste atendimento.", "Informar que o CPF ja esta cadastrado.");
  if (proposal?.freshness === "RECENT") {
    if (intent === "AMOUNT" && proposal.amount) return answer(
      `${proposal.normalizedStatus === "DRAFT" ? "A proposta em rascunho" : "A proposta"} registrada tem valor de ${money(proposal.amount.value)}. Isso nao confirma liberacao nem pagamento hoje.`,
      "Informar o valor registrado da proposta, sem prometer liberacao ou pagamento.");
    if (intent === "INSTALLMENT" && proposal.installmentAmount) return answer(
      `A parcela registrada na proposta e de ${money(proposal.installmentAmount)}.`, "Informar a parcela registrada na proposta.");
    if (intent === "TERM" && proposal.term) return answer(
      `O prazo registrado na proposta e de ${proposal.term} parcelas.`, "Informar o prazo registrado na proposta.");
    if (intent === "BANK" && proposal.bank) return answer(
      `O banco registrado na proposta e ${proposal.bank}.`, "Informar o banco registrado na proposta, sem atribuir aprovacao.");
    if (intent === "APPROVAL") return answer(
      `O CRM registra a proposta como ${({ DRAFT: "rascunho", APPROVED: "aprovada", PROCESSING: "em processamento", COMPLETED: "paga", CLOSED: "encerrada", UNKNOWN: "status desconhecido" })[proposal.normalizedStatus]}. Isso nao confirma pagamento ou dinheiro em conta.`,
      "Informar somente o status registrado, sem prometer pagamento.");
  }
  if (intent === "AMOUNT" && proposalSelection === "NONE" && !requestedProduct && !productFromText(question ?? "")) return {
    ...base, action: "ASK_FOR_MISSING_INFO", nextRequiredInformation: "PRODUCT",
    safeReply: "Ainda nao ha um valor de proposta identificado. Qual produto de credito voce quer consultar?",
    nextAction: "Perguntar qual produto de credito o cliente quer consultar.", shouldTransferToHuman: false
  };
  if (intent !== "UNKNOWN" || intents.length > 1 || proposalSelection === "UNKNOWN" || /\b(?:retorno|verificar|amortizar)\b/.test(text)) return {
    ...base, action: "HUMAN_VALIDATION", safeReply: "Nao ha informacao suficiente no registro para confirmar essa condicao. E necessaria a validacao de um atendente.",
    nextAction: "Solicitar validacao humana da condicao antes de informar valores ou datas.", shouldTransferToHuman: true
  };
  return { ...base, action: "CLARIFY_REQUEST", safeReply: "Qual informacao voce gostaria de esclarecer neste atendimento?",
    nextAction: "Esclarecer o pedido atual do cliente.", shouldTransferToHuman: false };
}

// Every goal owns all operational fields, including clarification.
// Only temperature, confidence and tags remain model-provided. Never retry.
export function reconcileResponseGoal({ reply, goal, customer, guarded }: {
  reply: ValidatedAiReply;
  goal: ResponseGoal;
  customer: CustomerFacts;
  guarded: boolean;
}) {
  if (guarded && goal.action === "CLARIFY_REQUEST") {
    goal = buildResponseGoal({ question: "Quando cai?", customer, proposal: null, proposalSelection: "UNKNOWN" });
  }
  const normalized = normalizeFactText(reply.suggestedReply);
  // This policy has no objective rule requiring a new CPF. Never manufacture one,
  // including when hasCpf is false, or hide the request in nextAction.
  const requestText = `${normalized} ${normalizeFactText(reply.nextAction)}`;
  const asksAvailableCpf = /(?:pedir|solicitar|envie|informe|passe|qual|preciso|precisamos).*\bcpf\b/.test(requestText) ||
    (customer.hasPhone && /(?:pedir|solicitar|envie|informe|qual).*\btelefone\b/.test(requestText)) ||
    (customer.hasEmail && /(?:pedir|solicitar|envie|informe|qual).*\bemail\b/.test(requestText));
  const vague = /\b(?:vou|estou|vamos) (?:verificar|analisar|conferir)|\b(?:aguarde|em breve retorno)\b/.test(normalized);
  const mismatch = normalizeFactText(reply.suggestedReply) !== normalizeFactText(goal.safeReply) ||
    normalizeFactText(reply.nextAction) !== normalizeFactText(goal.nextAction) || reply.shouldTransferToHuman !== goal.shouldTransferToHuman;
  return { ...reply, summary: "Pedido atual tratado com base apenas nos fatos disponiveis no CRM.",
    suggestedReply: goal.safeReply, nextAction: goal.nextAction,
    reason: "Resposta alinhada aos fatos disponiveis e ao objetivo seguro do atendimento.",
    shouldTransferToHuman: goal.shouldTransferToHuman,
    source: guarded || asksAvailableCpf || vague || mismatch ? "guardrail" as const : "openai" as const };
}
