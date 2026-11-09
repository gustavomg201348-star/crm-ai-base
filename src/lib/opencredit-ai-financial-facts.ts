import "server-only";
import type { SimulationResult } from "./opencredit-clt-simulation";
import { safeDiagnosticId } from "./opencredit-create-client-diagnostic";
import { encryptSecret, decryptSecret } from "./secret-encryption";
import { getSecretEncryptionOptionsFromEnv } from "./secret-encryption-env";
import { enforceFinancialReplyGuardrails, type AuthorizedFinancialFacts } from "./ai-response-guardrails";

export type AuthorizedCltOffer = Readonly<{ provider: "OPEN_CREDIT"; simulationId: string; offerId: string; bankId: string;
  releasedAmountCents: number | null; installmentCents: number; termMonths: number; interestRateMonthly: number | null;
  cetMonthly: null; expiresAt: null }>;
type Facts = { version: 1; purpose: "CLT_AI_SIMULATION_FACTS"; workflowId: string; provider: "OPEN_CREDIT"; observedAt: string;
  requestId: string | null; correlationId: string | null; status: SimulationResult["status"]; offers: AuthorizedCltOffer[] };
const cents = (value: number) => {
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || Math.abs(result / 100 - value) > 0.000001) throw Error("INVALID_FINANCIAL_FACT");
  return result;
};
/** Input must be the existing dispatcher's strictly parsed provider result, never model/history JSON. */
export function protectCltFinancialFacts(workflowId: string, result: SimulationResult, provenance: { requestId?: unknown; correlationId?: unknown } = {}) {
  const options = getSecretEncryptionOptionsFromEnv(); if (!options) throw Error("FINANCIAL_STORAGE_UNAVAILABLE");
  // Deterministic display order, not a recommendation or an offer selection at the provider.
  const offers = [...result.offers].sort((a,b) => a.installments-b.installments || a.installmentAmount-b.installmentAmount || a.offerId.localeCompare(b.offerId))
    .slice(0,2).map(o => ({ provider: "OPEN_CREDIT" as const, simulationId: result.simulationId, offerId: o.offerId, bankId: result.bankId,
      releasedAmountCents: o.liquidAmount === null ? null : cents(o.liquidAmount), installmentCents: cents(o.installmentAmount),
      termMonths: o.installments, interestRateMonthly: o.interestRate, cetMonthly: null, expiresAt: null }));
  const facts: Facts = { version: 1, purpose: "CLT_AI_SIMULATION_FACTS", workflowId, provider: "OPEN_CREDIT", observedAt: new Date().toISOString(), requestId: safeDiagnosticId(provenance.requestId), correlationId: safeDiagnosticId(provenance.correlationId), status: result.status, offers };
  return encryptSecret(JSON.stringify(facts), options);
}
export function readCltFinancialFacts(workflowId: string, envelope: string): Facts {
  const options = getSecretEncryptionOptionsFromEnv(); if (!options) throw Error("FINANCIAL_STORAGE_UNAVAILABLE");
  const f = JSON.parse(decryptSecret(envelope, options)) as Facts;
  if (f.purpose !== "CLT_AI_SIMULATION_FACTS" || f.version !== 1 || f.workflowId !== workflowId || f.provider !== "OPEN_CREDIT" || !Array.isArray(f.offers) || f.offers.length > 2) throw Error("INVALID_FINANCIAL_FACT");
  return f;
}
const money = (value: number) => (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export function renderCltFinancialFacts(facts: Facts) {
  if (facts.status !== "aprovado" || !facts.offers.length) return "Não encontrei uma oferta nesta consulta. Isso não confirma uma reprovação definitiva. Um atendente pode verificar o resultado.";
  const amounts = facts.offers.flatMap(o => o.releasedAmountCents === null ? [] : [money(o.releasedAmountCents)]);
  const installments = facts.offers.map(o => money(o.installmentCents));
  const rates = facts.offers.flatMap(o => o.interestRateMonthly === null ? [] : [String(o.interestRateMonthly).replace(".",",") + "%"]);
  const authorized: AuthorizedFinancialFacts = { proposalAmounts: amounts, proposalStatuses: [], proposalProducts: ["CLT"],
    proposalBanks: facts.offers.map(o => o.bankId), installmentAmounts: installments, installmentCounts: facts.offers.map(o => o.termMonths),
    rates, cets: [], margins: [], limits: [], paymentDates: [], discountDates: [] };
  const reply = "Encontrei estas condições na simulação, sujeitas à análise e formalização:\n" + facts.offers.map((o,i) =>
    `Opção ${i+1}: banco ${o.bankId}; ${o.releasedAmountCents === null ? "valor não informado" : "valor simulado de " + money(o.releasedAmountCents)}; parcela de ${money(o.installmentCents)} em ${o.termMonths} vezes` +
    (o.interestRateMonthly === null ? "." : `; taxa de ${String(o.interestRateMonthly).replace(".",",")}% ao mês.`)).join("\n") + "\nQuer que um atendente explique uma destas alternativas?";
  return enforceFinancialReplyGuardrails({ suggestedReply: reply, facts: authorized });
}
