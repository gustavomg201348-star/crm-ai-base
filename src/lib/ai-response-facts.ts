// Read-only projection. CRM records are not proof of an external bank decision.
export type CustomerFacts = {
  hasCpf: boolean;
  hasLocallyValidCpf: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  hasResponsibleAgent: boolean;
};

export type ProposalRecord = {
  companyId: string;
  contactId: string;
  product: string;
  bank: string;
  status: string;
  amount: { toString(): string };
  financedAmount: { toString(): string } | null;
  releasedAmount: { toString(): string } | null;
  installmentAmount: { toString(): string } | null;
  term: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ProposalStatus = "DRAFT" | "APPROVED" | "PROCESSING" | "COMPLETED" | "CLOSED" | "UNKNOWN";
export type ProposalFacts = {
  source: "STRUCTURED_CRM_PROPOSAL";
  product: string;
  bank: string | null;
  normalizedStatus: ProposalStatus;
  freshness: "RECENT";
  // No writer provenance: DRAFT is only a recorded draft proposal.
  amount: { value: string; meaning: "DRAFT_PROPOSAL_AMOUNT" | "PROPOSAL_AMOUNT" } | null;
  financedAmount: { value: string; meaning: "FINANCED_AMOUNT" } | null;
  releasedAmount: { value: string; meaning: "RECORDED_RELEASED_AMOUNT" } | null;
  installmentAmount: string | null;
  term: number | null;
  createdAt: string;
  updatedAt: string;
};

export function normalizeFactText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function hasUsableCpf(value?: string | null) {
  const digits = (value ?? "").replace(/[.\-\s]/g, "");
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  for (const length of [9, 10]) {
    const sum = Array.from(digits.slice(0, length))
      .reduce((total, digit, index) => total + Number(digit) * (length + 1 - index), 0);
    const check = (sum * 10) % 11;
    if ((check === 10 ? 0 : check) !== Number(digits[length])) return false;
  }
  return true; // Local format/check digits only; no external validation or consent.
}

export function normalizeProposalStatus(status: string): ProposalStatus {
  switch (status) {
    case "DRAFT": return "DRAFT";
    case "APPROVED": return "APPROVED";
    case "NEW": case "TYPED": case "ANALYSIS": case "PENDING":
    case "FORMALIZING": case "REWORK": return "PROCESSING";
    case "PAID": return "COMPLETED";
    case "CANCELED": case "REJECTED": return "CLOSED";
    default: return "UNKNOWN";
  }
}

export type ProductIntent = { state: "NO_MENTION" | "SINGLE_POSITIVE" | "AMBIGUOUS" | "NEGATED"; product: string | null };

export function classifyProductIntent(text: string): ProductIntent {
  const normalized = normalizeFactText(text);
  const products = ["CLT", "FGTS", "INSS", "MULTICRED", "PORTABILIDADE", "SEGURO"]
    .filter((product) => new RegExp(`\\b${product.toLowerCase()}\\b`).test(normalized));
  if (!products.length) return { state: "NO_MENTION", product: null };
  if (products.length > 1) return { state: "AMBIGUOUS", product: null };
  // Conservative clause-local negation; uncertainty never confirms a product.
  const clauses = normalized.split(/[.!?;,\n]/);
  const negated = clauses.some((clause) => new RegExp(`\\b${products[0].toLowerCase()}\\b`).test(clause) &&
    /\b(?:nao|sem|nem|nunca)\b/.test(clause));
  return negated ? { state: "NEGATED", product: null } : { state: "SINGLE_POSITIVE", product: products[0] };
}

export function productFromText(text: string): string | null {
  return classifyProductIntent(text).product;
}

export function resolveProductIntent(currentText: string, history: string[]) {
  const current = classifyProductIntent(currentText);
  if (current.state !== "NO_MENTION") return { ...current, source: "CURRENT_MESSAGE" as const };
  const historical = history.map(classifyProductIntent).filter((intent) => intent.state !== "NO_MENTION");
  const products = new Set(historical.map((intent) => intent.product));
  if (historical.length && historical.every((intent) => intent.state === "SINGLE_POSITIVE") && products.size === 1) {
    return { state: "SINGLE_POSITIVE" as const, product: historical[0].product, source: "HISTORY" as const };
  }
  return { ...current, source: "UNKNOWN" as const };
}

export function decimalFact(value: { toString(): string } | null) {
  if (!value) return null;
  const text = value.toString();
  return /^\d+(?:\.\d{1,2})?$/.test(text) && Number(text) > 0 && Number.isFinite(Number(text)) &&
    Number(text) <= Number.MAX_SAFE_INTEGER / 100
    ? text : null;
}

export const COPILOT_PROPOSAL_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const COPILOT_PROPOSAL_SCAN_LIMIT = 50;
export type HistoricalProposal = { product: string; normalizedStatus: ProposalStatus; freshness: "RECENT" | "STALE" };

export function selectProposalFacts({ records, companyId, contactId, requestedProduct, now, sanitize }: {
  records: ProposalRecord[];
  companyId: string;
  contactId: string;
  requestedProduct: string | null;
  now: Date;
  sanitize(value: string, maxLength: number): string | null;
}): { selection: "SELECTED" | "NONE" | "UNKNOWN"; proposal: ProposalFacts | null; history: HistoricalProposal[] } {
  // One extra row detects truncation. Never silently select from an incomplete scan.
  if (records.length > COPILOT_PROPOSAL_SCAN_LIMIT) return { selection: "UNKNOWN", proposal: null, history: [] };
  const scoped = records.filter((record) => record.companyId === companyId && record.contactId === contactId);
  const relevant = scoped.filter((record) => !requestedProduct || productFromText(record.product) === requestedProduct);
  const dated = relevant.filter((record) => {
    const age = now.getTime() - record.updatedAt.getTime();
    const status = normalizeProposalStatus(record.status);
    return status !== "UNKNOWN" && status !== "CLOSED" && Number.isFinite(age) && age >= 0 &&
      record.createdAt <= record.updatedAt;
  });
  // Historical metadata has no amounts/bank/terms and is not financial authority.
  const history: HistoricalProposal[] = dated.map((record) => ({
    product: sanitize(record.product, 120) || "UNKNOWN",
    normalizedStatus: normalizeProposalStatus(record.status),
    freshness: now.getTime() - record.updatedAt.getTime() <= COPILOT_PROPOSAL_MAX_AGE_MS ? "RECENT" : "STALE"
  }));
  if (dated.length !== 1 || history[0].freshness === "STALE") {
    return { selection: scoped.length ? "UNKNOWN" : "NONE", proposal: null, history };
  }
  const record = dated[0];
  const product = sanitize(record.product, 120);
  if (!product) return { selection: "UNKNOWN", proposal: null, history };
  const status = normalizeProposalStatus(record.status);
  const amount = decimalFact(record.amount);
  const financed = decimalFact(record.financedAmount);
  const released = decimalFact(record.releasedAmount);
  return { selection: "SELECTED", history, proposal: {
    source: "STRUCTURED_CRM_PROPOSAL",
    freshness: "RECENT",
    product,
    bank: sanitize(record.bank, 80),
    normalizedStatus: status,
    amount: amount ? { value: amount, meaning: status === "DRAFT" ? "DRAFT_PROPOSAL_AMOUNT" : "PROPOSAL_AMOUNT" } : null,
    financedAmount: financed ? { value: financed, meaning: "FINANCED_AMOUNT" } : null,
    releasedAmount: released ? { value: released, meaning: "RECORDED_RELEASED_AMOUNT" } : null,
    installmentAmount: decimalFact(record.installmentAmount),
    term: Number.isInteger(record.term) && record.term! > 0 && record.term! <= 1_200 ? record.term : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  } };
}
