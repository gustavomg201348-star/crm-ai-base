import type { ProposalFacts } from "@/lib/ai-response-facts";

export const FINANCIAL_VERIFICATION_REPLY =
  "Nao ha informacao suficiente no registro para confirmar essa condicao. E necessaria a validacao de um atendente.";

export type AuthorizedFinancialFacts = {
  // When present (including null), this linked projection is the ONLY authority.
  proposal?: ProposalFacts | null;
  proposalAmounts: string[];
  proposalStatuses: string[];
  proposalProducts: string[];
  proposalBanks: string[];
  installmentAmounts: string[];
  installmentCounts: number[];
  rates: string[];
  cets: string[];
  margins: string[];
  limits: string[];
  paymentDates: string[];
  discountDates: string[];
};

const currencyPattern =
  /R\$\s*\d+(?:\.\d{3})*(?:,\d{1,2})?|R\$\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d+)?\s*(?:mil|reais)\b/gi;
const percentagePattern = /\b\d+(?:[.,]\d+)?\s*%/g;
const installmentPattern = /\b(\d{1,3})\s*(?:x|parcelas?|vezes)\b/gi;
const datePattern =
  /\b(?:0?[1-9]|[12]\d|3[01])[/-](?:0?[1-9]|1[0-2])(?:[/-]\d{2,4})?\b|\bdia\s+\d{1,2}\b/gi;
const financialDateContextPattern =
  /\b(?:credito|parcela|vencimento|folha|liberacao|deposito|pagamento|desconto)\b/i;
const unsupportedFinancialCategoryPattern =
  /\b(?:taxa|cet|margem|limite|parcela|prazo)\b/i;
const concreteAvailabilityPattern =
  /\b(?:credito|valor|limite|margem)\b[^.!?\n]{0,48}\b(?:disponivel|liberad[oa]|aprovad[oa])\b/i;
const approvalPattern =
  /\b(?:foi\s+|esta\s+|ja\s+)?aprovad[oa]\b|\bja\s+aprovou\b/i;
const releasePattern = /\b(?:foi\s+|esta\s+|ja\s+)?liberad[oa]\b|\bliberou\b/i;
const bankClaimPattern =
  /\b(?:banco(?:\s+[A-Za-zÀ-ÿ\d.-]+)?)\s+(?:aprovou|liberou)\b|\b(?:tem|existe|ha)\s+proposta\s+(?:no|na|com)\s+[A-Za-zÀ-ÿ\d.-]+/i;
const namedInstitutionClaimPattern =
  /\b[A-Za-zÀ-ÿ\d.-]{2,24}\s+(?:aprovou|liberou)\b/i;
const verificationLanguagePattern =
  /\b(?:vou|vamos|preciso)\s+(?:verificar|consultar|confirmar)|\bapos\s+(?:verificar|consultar|confirmar)/i;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function numericValue(value: string) {
  const normalizedText = normalize(value);
  const numericText = normalizedText.replace(/[^\d.]/g, "");
  const isThousands = /^\d{1,3}(?:\.\d{3})+$/.test(numericText);
  let compact = normalizedText.replace(/[^\d.,]/g, "");
  if (compact.includes(",")) {
    compact = compact.replace(/\./g, "").replace(",", ".");
  } else if (isThousands) {
    compact = compact.replace(/\./g, "");
  }
  const parsed = Number(compact);
  if (!Number.isFinite(parsed)) return null;
  return /\bmil\b/.test(normalizedText) ? parsed * 1_000 : parsed;
}

function allCurrencyClaimsAreAuthorized(
  reply: string,
  facts: AuthorizedFinancialFacts
) {
  const claims = reply.match(currencyPattern) ?? [];
  if (claims.length === 0) return true;
  const allowed = [...facts.proposalAmounts, ...facts.installmentAmounts]
    .map(numericValue)
    .filter((value): value is number => value !== null);
  return claims.every((claim) => {
    const parsed = numericValue(claim);
    return parsed !== null && allowed.some((value) => Math.abs(value - parsed) < 0.001);
  });
}

function statusClaimsAreAuthorized(reply: string, facts: AuthorizedFinancialFacts) {
  const normalizedReply = normalize(reply);
  const statuses = facts.proposalStatuses.map(normalize);
  if (
    approvalPattern.test(normalizedReply) &&
    !statuses.some((status) => /approved|aprovad/.test(status))
  ) {
    return false;
  }
  if (
    releasePattern.test(normalizedReply) &&
    !statuses.some((status) => /paid|released|liberad|pago/.test(status))
  ) {
    return false;
  }
  return true;
}

function supportedInstallments(reply: string, facts: AuthorizedFinancialFacts) {
  const claims = Array.from(reply.matchAll(installmentPattern), (match) => Number(match[1]));
  return claims.every((claim) => facts.installmentCounts.includes(claim));
}

function supportedPercentages(reply: string, facts: AuthorizedFinancialFacts) {
  const claims = reply.match(percentagePattern) ?? [];
  const allowed = [...facts.rates, ...facts.cets].map(normalize);
  return claims.every((claim) => allowed.includes(normalize(claim)));
}

function supportedFinancialDates(reply: string, facts: AuthorizedFinancialFacts) {
  const normalizedReply = normalize(reply);
  if (!financialDateContextPattern.test(normalizedReply)) return true;
  const claims = normalizedReply.match(datePattern) ?? [];
  if (claims.length === 0) return true;
  const allowed = [...facts.paymentDates, ...facts.discountDates].map(normalize);
  return claims.every((claim) => allowed.includes(normalize(claim)));
}

function containsUnsupportedConcreteClaim(
  reply: string,
  facts: AuthorizedFinancialFacts
) {
  const normalizedReply = normalize(reply);
  const asksForVerification = verificationLanguagePattern.test(normalizedReply);
  const mentionsUnsupportedCategory = unsupportedFinancialCategoryPattern.test(normalizedReply);
  const availabilityClaim = concreteAvailabilityPattern.test(normalizedReply);
  const bankClaim =
    bankClaimPattern.test(normalizedReply) || namedInstitutionClaimPattern.test(reply);

  if (
    bankClaim &&
    !facts.proposalBanks
      .map(normalize)
      .some((bank) => bank.length >= 2 && normalizedReply.includes(bank))
  ) {
    return true;
  }
  if (mentionsUnsupportedCategory && !asksForVerification) {
    const categories: Array<[RegExp, boolean]> = [
      [/\btaxa\b/, facts.rates.length > 0], [/\bcet\b/, facts.cets.length > 0],
      [/\bmargem\b/, facts.margins.length > 0], [/\blimite\b/, facts.limits.length > 0],
      [/\bparcela\b/, facts.installmentAmounts.length > 0], [/\bprazo\b/, facts.installmentCounts.length > 0]
    ];
    if (categories.some(([pattern, available]) => pattern.test(normalizedReply) && !available)) return true;
  }
  if (availabilityClaim && !asksForVerification) {
    return (
      facts.proposalStatuses.length === 0 ||
      !statusClaimsAreAuthorized(reply, facts)
    );
  }
  return false;
}

export function enforceFinancialReplyGuardrails({
  suggestedReply,
  facts
}: {
  suggestedReply: string;
  facts: AuthorizedFinancialFacts;
}) {
  if (Object.prototype.hasOwnProperty.call(facts, "proposal")) {
    const proposal = facts.proposal;
    facts = { proposalAmounts: proposal?.amount ? [proposal.amount.value] : [],
      proposalStatuses: proposal ? [proposal.normalizedStatus] : [],
      proposalProducts: proposal ? [proposal.product] : [], proposalBanks: proposal?.bank ? [proposal.bank] : [],
      installmentAmounts: proposal?.installmentAmount ? [proposal.installmentAmount] : [],
      installmentCounts: proposal?.term ? [proposal.term] : [],
      rates: [], cets: [], margins: [], limits: [], paymentDates: [], discountDates: [] };
    // A recorded status/value never proves availability, release or payment today.
    const normalized = normalize(suggestedReply);
    if (/\b(?:tem|esta|foi|ja|valor|credito)\b[^.!?\n]{0,45}\b(?:liberad[oa]|disponivel)\b|\b(?:cai|caira|depositado)\b/.test(normalized)) {
      return FINANCIAL_VERIFICATION_REPLY;
    }
  }
  const unsupported =
    !allCurrencyClaimsAreAuthorized(suggestedReply, facts) ||
    !supportedPercentages(suggestedReply, facts) ||
    !supportedInstallments(suggestedReply, facts) ||
    !supportedFinancialDates(suggestedReply, facts) ||
    !statusClaimsAreAuthorized(suggestedReply, facts) ||
    containsUnsupportedConcreteClaim(suggestedReply, facts);

  return unsupported ? FINANCIAL_VERIFICATION_REPLY : suggestedReply;
}
