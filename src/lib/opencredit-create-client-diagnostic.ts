// Closed browser-safe DTO. No raw provider text, payloads, customer identifiers or credentials.
export const diagnosticCategories = ["NONE", "HTTP_NON_201", "NETWORK_ERROR", "REQUEST_TIMEOUT", "RESPONSE_TIMEOUT",
  "RESPONSE_TOO_LARGE", "INVALID_UTF8", "INVALID_JSON", "INVALID_CONTRACT", "INVALID_RESPONSE",
  "PROVIDER_SUCCESS_FALSE", "AUTH_ERROR", "UNKNOWN_TRANSPORT"] as const;
export type DiagnosticCategory = typeof diagnosticCategories[number];
export const diagnosticMessages: Readonly<Record<DiagnosticCategory, string>> = {
  NONE: "Resposta positiva observada; conferir settlement local.", HTTP_NON_201: "HTTP diferente de 201; efeito remoto não confirmado.",
  NETWORK_ERROR: "Falha de rede; efeito remoto não confirmado.", REQUEST_TIMEOUT: "Timeout de transporte; não reenviar.",
  RESPONSE_TIMEOUT: "Timeout na leitura da resposta; não reenviar.", RESPONSE_TOO_LARGE: "Resposta excedeu o limite local.",
  INVALID_UTF8: "Resposta com UTF-8 inválido.", INVALID_JSON: "JSON inválido ou ambíguo.",
  INVALID_CONTRACT: "Resposta fora do contrato local.", INVALID_RESPONSE: "Resposta HTTP não legível pelo contrato local.",
  PROVIDER_SUCCESS_FALSE: "Provider não confirmou sucesso; efeito remoto não confirmado.",
  AUTH_ERROR: "Autenticação não concluída antes da reserva.", UNKNOWN_TRANSPORT: "Falha técnica não reconhecida; não reenviar.",
};
export type OpenCreditCreateClientDiagnostic = Readonly<{
  version: 1; category: DiagnosticCategory; stage: "AUTHENTICATION" | "TRANSPORT" | "RESPONSE";
  providerHttpStatus: number | null; providerRequestId: string | null; providerCorrelationId: string | null;
  providerSuccess: boolean | null; providerCreated: boolean | null;
  providerErrorCode: "VALIDATION_ERROR" | "UNAUTHORIZED" | null;
  responseReadable: boolean; responseParsed: boolean;
  observedAt: string; dispatchCommittedAt: string | null; respondedAt: string | null;
  settlement: "NOT_ATTEMPTED" | "NOT_CONFIRMED" | "ERROR" | "CONFIRMED";
}>;
const keys = ["version", "category", "stage", "providerHttpStatus", "providerRequestId", "providerCorrelationId",
  "providerSuccess", "providerCreated", "providerErrorCode", "responseReadable", "responseParsed", "observedAt",
  "dispatchCommittedAt", "respondedAt", "settlement"] as const;
export function safeDiagnosticId(value: unknown): string | null {
  return typeof value === "string" && !/\d{11}/.test(value)
    && /^(?:req_[0-9a-f]{12,32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![\s\S])/i.test(value) ? value : null;
}
function iso(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z(?![\s\S])/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
export function parseCreateClientDiagnostic(value: unknown): OpenCreditCreateClientDiagnostic | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
    const own = Reflect.ownKeys(value); if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k as typeof keys[number]))) return null;
    const v: Record<string, unknown> = {};
    for (const key of keys) { const d = Object.getOwnPropertyDescriptor(value, key); if (!d?.enumerable || !("value" in d)) return null; v[key] = d.value; }
    if (v.version !== 1 || !diagnosticCategories.some(c => c === v.category) || !["AUTHENTICATION", "TRANSPORT", "RESPONSE"].includes(v.stage as string)
      || !["NOT_ATTEMPTED", "NOT_CONFIRMED", "ERROR", "CONFIRMED"].includes(v.settlement as string)
      || v.providerHttpStatus !== null && (typeof v.providerHttpStatus !== "number" || !Number.isInteger(v.providerHttpStatus) || v.providerHttpStatus < 100 || v.providerHttpStatus > 599)
      || ![null, "VALIDATION_ERROR", "UNAUTHORIZED"].includes(v.providerErrorCode as string | null)
      || typeof v.responseReadable !== "boolean" || typeof v.responseParsed !== "boolean" || v.responseParsed && !v.responseReadable
      || !iso(v.observedAt)) return null;
    for (const key of ["providerRequestId", "providerCorrelationId"]) if (v[key] !== null && safeDiagnosticId(v[key]) === null) return null;
    for (const key of ["providerSuccess", "providerCreated"]) if (v[key] !== null && typeof v[key] !== "boolean") return null;
    for (const key of ["dispatchCommittedAt", "respondedAt"]) if (v[key] !== null && (!iso(v[key]) || v[key] > v.observedAt)) return null;
    if (typeof v.dispatchCommittedAt === "string" && typeof v.respondedAt === "string" && v.respondedAt < v.dispatchCommittedAt) return null;
    if (v.settlement !== "NOT_ATTEMPTED" && v.dispatchCommittedAt === null) return null;
    if (v.stage === "AUTHENTICATION" && (v.dispatchCommittedAt !== null || v.settlement !== "NOT_ATTEMPTED")) return null;
    if (v.stage !== "AUTHENTICATION" && v.dispatchCommittedAt === null) return null;
    if (v.stage !== "AUTHENTICATION" && v.settlement === "NOT_ATTEMPTED") return null;
    if (v.responseReadable && v.providerHttpStatus === null) return null;
    if ((v.providerSuccess === null) !== (v.providerCreated === null) || v.providerSuccess !== null && !v.responseParsed) return null;
    if (v.category === "NONE" && (v.providerHttpStatus !== 201 || v.providerSuccess !== true)) return null;
    if (v.category === "PROVIDER_SUCCESS_FALSE" && (v.providerHttpStatus !== 201 || v.providerSuccess !== false)) return null;
    if (v.category === "HTTP_NON_201" && (v.providerHttpStatus === null || v.providerHttpStatus === 201)) return null;
    return v as OpenCreditCreateClientDiagnostic;
  } catch { return null; }
}
