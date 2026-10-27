// Browser-safe closed presentation contracts; no provider/domain decisions.
export type CreateClientOperation = Readonly<{ operationId: string; commandId: string; state: "PREPARED" | "IN_FLIGHT" | "SUCCEEDED" | "FAILED" | "UNKNOWN"; revision: number }>;
export type CreateClientContext = Readonly<{ ok: true; operation: CreateClientOperation | null }>;
export type CreateClientDispatchResponse = Readonly<{ ok: true; operationId: string; state: "IN_FLIGHT" | "SUCCEEDED" | "UNKNOWN"; revision: number; dispatched: boolean }>;
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const revision = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export const isOpenCreditCommandId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(v);
function closed(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return null;
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return null;
  const r: Record<string, unknown> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !("value" in d) || !d.enumerable) return null; r[key] = d.value; }
  return r;
}
export function parseCreateClientContext(value: unknown): CreateClientContext | null {
  try {
    const root = closed(value, ["ok", "operation"]); if (!root || root.ok !== true) return null;
    if (root.operation === null) return { ok: true, operation: null };
    const op = closed(root.operation, ["operationId", "commandId", "state", "revision"]);
    if (!op || !id(op.operationId) || !isOpenCreditCommandId(op.commandId) || !revision(op.revision)
      || !["PREPARED", "IN_FLIGHT", "SUCCEEDED", "FAILED", "UNKNOWN"].some(s => s === op.state)) return null;
    return { ok: true, operation: { operationId: op.operationId, commandId: op.commandId, state: op.state as CreateClientOperation["state"], revision: op.revision } };
  } catch { return null; }
}
export function parseCreateClientDispatchResponse(value: unknown): CreateClientDispatchResponse | null {
  try {
    const r = closed(value, ["ok", "operationId", "state", "revision", "dispatched"]);
    if (!r || r.ok !== true || !id(r.operationId) || !revision(r.revision) || typeof r.dispatched !== "boolean"
      || !["IN_FLIGHT", "SUCCEEDED", "UNKNOWN"].some(s => s === r.state)) return null;
    return { ok: true, operationId: r.operationId, state: r.state as CreateClientDispatchResponse["state"], revision: r.revision, dispatched: r.dispatched };
  } catch { return null; }
}
export function resolveCreateClientCommandId(input: { operation: CreateClientOperation | null; pendingCommandId: unknown; generatedCommandId?: unknown }): string | null {
  try {
    const parsed = parseCreateClientContext({ ok: true, operation: input.operation }); if (!parsed) return null;
    if (parsed.operation !== null) return parsed.operation.state === "PREPARED" ? parsed.operation.commandId : null;
    if (isOpenCreditCommandId(input.pendingCommandId)) return input.pendingCommandId;
    return isOpenCreditCommandId(input.generatedCommandId) ? input.generatedCommandId : null;
  } catch { return null; }
}
export function createClientErrorMessage(value: unknown): string {
  const generic = "Não foi possível confirmar o estado da operação. Não inicie uma nova solicitação até atualizar o painel.";
  try {
    const r = closed(value, ["error"]); if (!r || typeof r.error !== "string") return generic;
    const messages: Record<string, string> = {
      LOCAL_COMMAND_PREPARATION_FAILED: "Não foi possível preparar o comando neste navegador. Nenhuma solicitação de envio foi iniciada.",
      RATE_LIMITED: "Muitas solicitações. Aguarde antes de atualizar o painel.",
      OPENCREDIT_CREATE_CLIENT_DISPATCH_AUTHENTICATION: "A integração OpenCredit não conseguiu autenticar antes do envio. A solicitação permaneceu preparada.",
      OPENCREDIT_CREATE_CLIENT_DISPATCH_PRE_DISPATCH_UNAVAILABLE: "O envio não pôde ser iniciado. A solicitação permaneceu preparada.",
      OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED: "O envio pode ter ocorrido, mas o estado local não foi confirmado. Não reenvie esta operação.",
    };
    for (const code of ["CONSUMER_AUTHORIZATION_MISSING", "CONSUMER_AUTHORIZATION_INACTIVE"]) messages["OPENCREDIT_COMMERCIAL_OPERATION_" + code] = "É necessária uma autorização OpenCredit ativa.";
    for (const code of ["OPERATION_STATE_CONFLICT", "OPERATION_REVISION_CONFLICT", "CONCURRENT_CONFLICT"]) messages["OPENCREDIT_COMMERCIAL_OPERATION_" + code] = "O estado mudou durante a operação. Atualizando o painel.";
    return Object.prototype.hasOwnProperty.call(messages, r.error) ? messages[r.error] : generic;
  } catch { return generic; }
}
