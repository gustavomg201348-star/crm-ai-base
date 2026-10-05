export const FINANCIAL_VERIFICATION_REPLY =
  "Vou verificar essa informacao para voce e retorno com os dados corretos.";

export type AuthorizedFinancialFacts = {
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
  const allowed = facts.proposalAmounts
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
    const hasAuthorizedCategory =
      facts.installmentAmounts.length > 0 ||
      facts.installmentCounts.length > 0 ||
      facts.rates.length > 0 ||
      facts.cets.length > 0 ||
      facts.margins.length > 0 ||
      facts.limits.length > 0;
    if (!hasAuthorizedCategory) return true;
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
  const unsupported =
    !allCurrencyClaimsAreAuthorized(suggestedReply, facts) ||
    !supportedPercentages(suggestedReply, facts) ||
    !supportedInstallments(suggestedReply, facts) ||
    !supportedFinancialDates(suggestedReply, facts) ||
    !statusClaimsAreAuthorized(suggestedReply, facts) ||
    containsUnsupportedConcreteClaim(suggestedReply, facts);

  return unsupported ? FINANCIAL_VERIFICATION_REPLY : suggestedReply;
}
