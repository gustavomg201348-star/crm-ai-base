// Client-safe presentation contracts only. No provider/domain decisions.
export type AuthorizationContext = {
  ok: true;
  authorization: { exists: boolean; active: boolean; revision: number | null; evidenceInboundEventId: string | null; evidenceMessageId: string | null };
  evidenceCandidates: { inboundEventId: string; messageId: string }[];
};
export type AuthorizationReviewMessage = { id: string; direction: string; body: string; createdAt: string; type?: string };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}(?![\s\S])/.test(v);
const nullableId = (v: unknown) => v === null || id(v);
const revision = (v: unknown) => v === null || typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
function closed(v: unknown, keys: string[]): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v) || ![null, Object.prototype].includes(Object.getPrototypeOf(v))) return null;
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some(k => typeof k !== "string" || !keys.includes(k))) return null;
  const r: Record<string, unknown> = {};
  for (const key of keys) { const d = Object.getOwnPropertyDescriptor(v, key); if (!d || !("value" in d)) return null; r[key] = d.value; }
  return r;
}
export function parseAuthorizationContext(value: unknown): AuthorizationContext | null {
  try {
    const root = closed(value, ["ok", "authorization", "evidenceCandidates"]);
    if (!root || root.ok !== true || !Array.isArray(root.evidenceCandidates) || root.evidenceCandidates.length > 50) return null;
    const a = closed(root.authorization, ["exists", "active", "revision", "evidenceInboundEventId", "evidenceMessageId"]);
    if (!a || typeof a.exists !== "boolean" || typeof a.active !== "boolean" || !revision(a.revision) || !nullableId(a.evidenceInboundEventId) || !nullableId(a.evidenceMessageId)) return null;
    if (!a.exists && (a.active || a.revision !== null || a.evidenceInboundEventId !== null || a.evidenceMessageId !== null)) return null;
    if (a.exists && (a.revision === null || a.evidenceInboundEventId === null)) return null;
    const seen = new Set<string>(); const messages = new Set<string>(); const candidates: AuthorizationContext["evidenceCandidates"] = [];
    for (const value of root.evidenceCandidates) {
      const c = closed(value, ["inboundEventId", "messageId"]);
      if (!c || !id(c.inboundEventId) || !id(c.messageId) || seen.has(c.inboundEventId) || messages.has(c.messageId)) return null;
      seen.add(c.inboundEventId); messages.add(c.messageId); candidates.push({ inboundEventId: c.inboundEventId, messageId: c.messageId });
    }
    return { ok: true, authorization: { exists: a.exists, active: a.active, revision: a.revision as number | null,
      evidenceInboundEventId: a.evidenceInboundEventId as string | null, evidenceMessageId: a.evidenceMessageId as string | null }, evidenceCandidates: candidates };
  } catch { return null; }
}
export function isAuthorizationMutationResponse(value: unknown): boolean {
  try {
    const r = closed(value, ["ok", "changed", "authorizationId", "active", "revision"]);
    return !!r && r.ok === true && typeof r.changed === "boolean" && typeof r.active === "boolean" && nullableId(r.authorizationId) && revision(r.revision)
      && (r.authorizationId === null ? r.active === false && r.revision === null : r.revision !== null);
  } catch { return false; }
}
export function authorizationEvidenceView(context: AuthorizationContext, messages: readonly AuthorizationReviewMessage[]) {
  const byId = new Map(messages.map(m => [m.id, m]));
  return context.evidenceCandidates.flatMap(candidate => {
    const message = byId.get(candidate.messageId);
    return message ? [{ ...candidate, body: message.body, createdAt: message.createdAt,
      current: context.authorization.active && context.authorization.evidenceInboundEventId === candidate.inboundEventId }] : [];
  });
}
export function authorizationErrorMessage(value: unknown): string {
  const generic = "Não foi possível concluir a operação. Atualize o painel e tente novamente.";
  try {
    const r = closed(value, ["error"]); if (!r || typeof r.error !== "string") return generic;
    const messages: Record<string, string> = {
      RATE_LIMITED: "Muitas solicitações. Aguarde e tente novamente.",
      OPENCREDIT_CONSUMER_AUTHORIZATION_AUTHORIZATION_CONFLICT: "Já existe uma autorização ativa com outra evidência. Revogue-a antes de registrar uma nova.",
      OPENCREDIT_CONSUMER_AUTHORIZATION_CONTACT_ARCHIVED: "O contato está arquivado e não pode receber uma nova autorização.",
      OPENCREDIT_CONSUMER_AUTHORIZATION_CONCURRENT_CONFLICT: "O estado mudou enquanto você operava. Atualize e tente novamente.",
    };
    for (const code of ["COMMERCIAL_ACCESS_MISSING", "COMMERCIAL_ACCESS_DISABLED"]) messages["OPENCREDIT_CONSUMER_AUTHORIZATION_" + code] = "O acesso comercial OpenCredit não está disponível para este cadastro.";
    for (const code of ["IDENTITY_NOT_FOUND", "IDENTITY_DISABLED", "IDENTITY_SNAPSHOT_MISMATCH", "IDENTITY_CONFLICT"]) messages["OPENCREDIT_CONSUMER_AUTHORIZATION_" + code] = "A identidade OpenCredit do contato precisa ser regularizada antes da autorização.";
    for (const code of ["EVIDENCE_NOT_FOUND", "EVIDENCE_SCOPE_MISMATCH", "EVIDENCE_NOT_VERIFIED", "EVIDENCE_UNSUPPORTED"]) messages["OPENCREDIT_CONSUMER_AUTHORIZATION_" + code] = "A mensagem selecionada não é mais uma evidência válida. Atualize o painel.";
    return Object.prototype.hasOwnProperty.call(messages, r.error) ? messages[r.error] : generic;
  } catch { return generic; }
}
