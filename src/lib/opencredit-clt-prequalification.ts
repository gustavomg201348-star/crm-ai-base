/** Browser-safe closed contract for automatic CLT multi-bank prequalification. */
export const prequalificationReasonTypes = [
  "waiting_authorization", "no_offer", "timeout", "unavailable", "business_rule", "pre_validation"
] as const;
export type PrequalificationReasonType = typeof prequalificationReasonTypes[number] | null;
export type PrequalificationOffer = Readonly<{
  offerId: string;
  installments: number;
  installmentAmount: number;
  liquidAmount: number | null;
  interestRate: number | null;
  totalAmount: number | null;
  hasInsurance: boolean | null;
}>;
export type PrequalificationBankResult = Readonly<{
  bankId: string;
  bankName: string;
  simulationId: string;
  status: "aprovado" | "recusado" | "pendente" | "waiting_authorization";
  reasonType: PrequalificationReasonType;
  simulationType: "margem_maxima" | "valor_parcela" | "valor_liberado" | null;
  offers: PrequalificationOffer[];
}>;
export type PrequalificationResult = Readonly<{
  banks: PrequalificationBankResult[];
  requestedBanks: number;
  observedAt: string;
}>;
export type PrequalificationView = Readonly<{
  state: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
  result: PrequalificationResult | null;
  errorCode: "PROVIDER_UNAVAILABLE" | "INVALID_RESPONSE" | "CONFIGURATION" | null;
}>;

const invalid = (): never => { throw Error("INVALID_CLT_PREQUALIFICATION_CONTRACT"); };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
};
const safeId = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(value)
    || /^(?:\d{11}|\d{13})$/.test(value)) return invalid();
  return value;
};
const finite = (value: unknown) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return invalid();
  return value;
};
const nullableNumber = (value: unknown) => value === null ? null : finite(value);
function offers(value: unknown): PrequalificationOffer[] {
  if (!Array.isArray(value) || value.length > 100) return invalid();
  return value.map(raw => {
    const offer = object(raw);
    const installments = finite(offer.installments);
    if (!Number.isSafeInteger(installments) || installments < 1
      || typeof offer.hasInsurance !== "boolean" && offer.hasInsurance !== null) return invalid();
    return {
      offerId: safeId(offer.offerId),
      installments,
      installmentAmount: finite(offer.installmentAmount),
      liquidAmount: nullableNumber(offer.liquidAmount),
      interestRate: nullableNumber(offer.interestRate),
      totalAmount: nullableNumber(offer.totalAmount),
      hasInsurance: offer.hasInsurance as boolean | null,
    };
  });
}

export function buildPrequalificationPayload(cpf: string, bankIds: readonly string[]) {
  if (!/^\d{11}$/.test(cpf) || !Array.isArray(bankIds) || bankIds.length < 1 || bankIds.length > 100) return invalid();
  const banks = bankIds.map(safeId);
  if (new Set(banks).size !== banks.length) return invalid();
  return Object.freeze({ cpf, banks: Object.freeze([...banks]) });
}

export function parsePrequalificationProviderResponse(
  raw: unknown,
  expected: { cpf: string; banks: readonly { bankId: string; bankName: string }[]; observedAt?: string }
): PrequalificationResult {
  const root = object(raw), data = object(root.data), client = object(data.client);
  const names = new Map<string, string>();
  for (const entry of expected.banks) {
    const bankId = safeId(entry.bankId);
    if (typeof entry.bankName !== "string" || !entry.bankName.trim() || entry.bankName.length > 200 || /[\u0000-\u001f\u007f]/.test(entry.bankName) || names.has(bankId)) return invalid();
    names.set(bankId, entry.bankName.trim());
  }
  const expectedBanks = new Set(names.keys());
  if (!/^\d{11}$/.test(expected.cpf) || client.cpf !== expected.cpf
    || typeof data.fromCache !== "boolean" || data.blocked !== false
    || !Array.isArray(data.barriers) || data.barriers.length !== 0
    || !Array.isArray(data.banks) || data.banks.length > expectedBanks.size || data.banks.length > 100) return invalid();
  const seen = new Set<string>();
  const banks = data.banks.map(rawBank => {
    const bank = object(rawBank), bankId = safeId(bank.bankId);
    if (!expectedBanks.has(bankId) || seen.has(bankId)) return invalid();
    seen.add(bankId);
    if (!["aprovado", "recusado", "pendente"].includes(bank.status as string)) return invalid();
    if (bank.reasonType !== null && !(prequalificationReasonTypes as readonly unknown[]).includes(bank.reasonType)) return invalid();
    if (![null, "margem_maxima", "valor_parcela", "valor_liberado"].includes(bank.simulationType as never)) return invalid();
    const reasonType = bank.reasonType as PrequalificationReasonType;
    const status = reasonType === "waiting_authorization"
      ? "waiting_authorization"
      : bank.status as PrequalificationBankResult["status"];
    const parsedOffers = offers(bank.offers);
    if (status !== "aprovado" && parsedOffers.length !== 0) return invalid();
    const simulationId = safeId(bank.simulationId);
    if ([simulationId, ...parsedOffers.map(o => o.offerId)].some(value => value.includes(expected.cpf))) return invalid();
    return {
      bankId,
      bankName: names.get(bankId)!,
      simulationId,
      status,
      reasonType,
      simulationType: bank.simulationType as PrequalificationBankResult["simulationType"],
      offers: parsedOffers,
    };
  });
  const observedAt = expected.observedAt ?? new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt)) return invalid();
  return { banks, requestedBanks: expectedBanks.size, observedAt };
}

export function parsePrequalificationView(raw: unknown): PrequalificationView {
  const root = object(raw);
  if (!["PENDING", "PROCESSING", "COMPLETED", "FAILED"].includes(root.state as string)
    || !Object.hasOwn(root, "result") || !Object.hasOwn(root, "errorCode")
    || Object.keys(root).some(k => !["state", "result", "errorCode"].includes(k))) return invalid();
  const state = root.state as PrequalificationView["state"];
  const errorCode = root.errorCode === null ? null
    : ["PROVIDER_UNAVAILABLE", "INVALID_RESPONSE", "CONFIGURATION"].includes(root.errorCode as string)
      ? root.errorCode as PrequalificationView["errorCode"] : invalid();
  if (root.result === null) return { state, result: null, errorCode };
  const result = object(root.result);
  if (!Array.isArray(result.banks) || !Number.isSafeInteger(result.requestedBanks) || (result.requestedBanks as number) < 1
    || typeof result.observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.observedAt)
    || Object.keys(result).some(k => !["banks", "requestedBanks", "observedAt"].includes(k))) return invalid();
  const banks = result.banks.map(rawBank => {
    const bank = object(rawBank);
    if (!["aprovado", "recusado", "pendente", "waiting_authorization"].includes(bank.status as string)
      || bank.reasonType !== null && !(prequalificationReasonTypes as readonly unknown[]).includes(bank.reasonType)
      || ![null, "margem_maxima", "valor_parcela", "valor_liberado"].includes(bank.simulationType as never)
      || typeof bank.bankName !== "string" || !bank.bankName.trim() || bank.bankName.length > 200 || /[\u0000-\u001f\u007f]/.test(bank.bankName)
      || Object.keys(bank).some(k => !["bankId", "bankName", "simulationId", "status", "reasonType", "simulationType", "offers"].includes(k))) return invalid();
    return {
      bankId: safeId(bank.bankId),
      bankName: bank.bankName.trim(),
      simulationId: safeId(bank.simulationId),
      status: bank.status as PrequalificationBankResult["status"],
      reasonType: bank.reasonType as PrequalificationReasonType,
      simulationType: bank.simulationType as PrequalificationBankResult["simulationType"],
      offers: offers(bank.offers),
    };
  });
  return { state, result: { banks, requestedBanks: result.requestedBanks as number, observedAt: result.observedAt }, errorCode };
}
