// Closed browser-safe presentation only. No provider or ledger transitions.
export type OpenCreditCreateClientReconciliationReview = Readonly<{
  operationId: string; preparedAt: string; dispatchCommittedAt: string; dispatchAuthorizationBound: true;
} & ({ state: "IN_FLIGHT"; revision: 1; reason: "DISPATCH_COMMITTED_RESULT_UNCONFIRMED"; settledAt: null }
  | { state: "UNKNOWN"; revision: 2; reason: "REMOTE_RESULT_AMBIGUOUS"; settledAt: string })>;
export type OpenCreditCreateClientReconciliationContext = Readonly<{ ok: true; review: OpenCreditCreateClientReconciliationReview | null }>;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
function closed(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return null;
  const own = Reflect.ownKeys(v); if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return null;
  const result: Record<string, unknown> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !("value" in d) || !d.enumerable) return null; result[key] = d.value; }
  return result;
}
function iso(v: unknown): v is string {
  return typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z(?![\s\S])/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
export function parseOpenCreditCreateClientReconciliationContext(value: unknown): OpenCreditCreateClientReconciliationContext | null {
  try {
    const root = closed(value, ["ok", "review"]); if (!root || root.ok !== true) return null;
    if (root.review === null) return { ok: true, review: null };
    const r = closed(root.review, ["operationId", "state", "revision", "reason", "preparedAt", "dispatchCommittedAt", "settledAt", "dispatchAuthorizationBound"]);
    if (!r || !id(r.operationId) || !iso(r.preparedAt) || !iso(r.dispatchCommittedAt) || r.dispatchAuthorizationBound !== true
      || r.preparedAt > r.dispatchCommittedAt) return null;
    const common = { operationId: r.operationId, preparedAt: r.preparedAt, dispatchCommittedAt: r.dispatchCommittedAt, dispatchAuthorizationBound: true as const };
    if (r.state === "IN_FLIGHT" && r.revision === 1 && r.reason === "DISPATCH_COMMITTED_RESULT_UNCONFIRMED" && r.settledAt === null)
      return { ok: true, review: { ...common, state: "IN_FLIGHT", revision: 1, reason: r.reason, settledAt: null } };
    if (r.state === "UNKNOWN" && r.revision === 2 && r.reason === "REMOTE_RESULT_AMBIGUOUS" && iso(r.settledAt) && r.settledAt >= r.dispatchCommittedAt)
      return { ok: true, review: { ...common, state: "UNKNOWN", revision: 2, reason: r.reason, settledAt: r.settledAt } };
    return null;
  } catch { return null; }
}
export function reconciliationErrorMessage(value: unknown): string {
  const generic = "Não foi possível confirmar os fatos locais da operação. Não reenvie.";
  try {
    const r = closed(value, ["error"]);
    if (r?.error === "RATE_LIMITED") return "Muitas solicitações. Aguarde antes de atualizar a revisão.";
    if (r?.error === "OPENCREDIT_CREATE_CLIENT_RECONCILIATION_CORRUPT_LEDGER") return "O histórico local não pôde ser validado. Revisão técnica necessária. Não reenvie.";
    return generic;
  } catch { return generic; }
}
