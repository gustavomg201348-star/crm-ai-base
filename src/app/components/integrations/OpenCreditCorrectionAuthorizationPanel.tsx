"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { authorizationErrorMessage, authorizationEvidenceView, isAuthorizationMutationResponse, parseAuthorizationContext,
  type AuthorizationContext, type AuthorizationReviewMessage } from "@/lib/opencredit-consumer-authorization-ui";
import { OpenCreditClientCorrectionPanel } from "./OpenCreditClientCorrectionPanel";

type Props = { enabled: boolean; companyId: string; contactId: string; conversationId: string; messages: readonly AuthorizationReviewMessage[] };
const base = "/api/admin/integrations/opencredit/client-correction/authorization";
export function OpenCreditCorrectionAuthorizationPanel(props: Props) {
  if (!props.enabled) return null;
  // Remount synchronously on target changes; never render a previous target's selection/state.
  return <Review key={JSON.stringify([props.companyId, props.contactId, props.conversationId])} {...props} />;
}
function Review({ companyId, contactId, conversationId, messages }: Props) {
  const evidenceGroup = useId();
  const [context, setContext] = useState<AuthorizationContext | null>(null);
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const load = useCallback(async (message = "") => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const epoch = ++sequence.current; working.current = true; setBusy(true); setSelected(""); setConfirmed(false); setError(message);
    try {
      const response = await fetch(base + "/context", { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, contactId, conversationId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); setContext(null); return; }
      const raw: unknown = await response.json();
      if (abort.signal.aborted || sequence.current !== epoch) return;
      const parsed = response.ok ? parseAuthorizationContext(raw) : null;
      if (!parsed) { setContext(null); setError(response.ok ? authorizationErrorMessage(null) : authorizationErrorMessage(raw)); return; }
      setContext(parsed);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) { setContext(null); setError(authorizationErrorMessage(null)); } }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }, [companyId, contactId, conversationId]);
  const invalidate = useCallback(() => { sequence.current++; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  const candidates = context ? authorizationEvidenceView(context, messages) : [];
  const candidate = candidates.find(c => c.inboundEventId === selected);
  const activeMessage = context?.authorization.evidenceMessageId ? messages.find(m => m.id === context.authorization.evidenceMessageId) : undefined;
  async function mutate(action: "grant" | "revoke") {
    if (working.current || !context || hidden) return;
    if (action === "grant" && (!candidate || !confirmed || context.authorization.active)) return;
    if (action === "revoke" && (!context.authorization.exists || !context.authorization.active || !window.confirm("Confirma revogar esta autorização operacional OpenCredit?"))) return;
    working.current = true; setBusy(true); setError("");
    const abort = new AbortController(); controller.current?.abort(); controller.current = abort;
    const epoch = ++sequence.current;
    const body = action === "grant" ? { companyId, contactId, inboundEventId: candidate!.inboundEventId } : { companyId, contactId };
    try {
      const response = await fetch(base + (action === "grant" ? "/grant" : "/revoke"), { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); setContext(null); return; }
      const raw: unknown = await response.json();
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.ok && isAuthorizationMutationResponse(raw)) { await load(); return; }
      const message = authorizationErrorMessage(raw);
      if (response.status === 409) { await load(message); return; }
      setError(message);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) setError(authorizationErrorMessage(null)); }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }
  if (hidden) return null;
  return <section aria-label="Autorização de atualização cadastral OpenCredit" className="rounded border border-line bg-white p-4 shadow-soft">
    <h3 className="font-bold">Autorização de atualização cadastral OpenCredit</h3>
    {busy && <p role="status" className="mt-2 text-xs text-slate-500">Atualizando autorização...</p>}
    {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
    {context && <>
      <p role="status" className="mt-2 text-sm font-semibold">{!context.authorization.exists ? "Sem autorização registrada" : context.authorization.active ? "Autorização ativa" : "Autorização revogada"}
        {context.authorization.revision !== null && <span className="block text-xs text-slate-500">Revisão {context.authorization.revision}</span>}</p>
      {activeMessage && <div className="mt-2 rounded bg-emerald-50 p-2 text-xs"><p className="font-semibold">Evidência atual</p><p className="whitespace-pre-wrap break-words">{activeMessage.body}</p></div>}
      <fieldset disabled={busy} className="mt-3 max-h-64 min-w-0 space-y-2 overflow-y-auto"><legend className="text-xs font-semibold">Mensagem para revisão manual</legend>
        {!candidates.length && <p className="text-xs text-slate-500">Nenhuma evidência elegível entre as mensagens disponíveis.</p>}
        {candidates.map(c => <label key={c.inboundEventId} className="flex cursor-pointer items-start gap-2 rounded border border-line p-2 text-xs focus-within:ring-2 focus-within:ring-blue-500">
          <input type="radio" name={evidenceGroup} checked={selected === c.inboundEventId} onChange={() => { setSelected(c.inboundEventId); setConfirmed(false); }} />
          <span className="min-w-0"><time dateTime={c.createdAt} className="block text-slate-500">{new Date(c.createdAt).toLocaleString("pt-BR")}</time><span className="whitespace-pre-wrap break-words">{c.body}</span>{c.current && <span className="block font-semibold">Evidência ativa</span>}</span>
        </label>)}
      </fieldset>
      {candidate && <div className="mt-3"><p className="text-xs font-semibold">Texto completo selecionado</p><p className="whitespace-pre-wrap break-words text-sm">{candidate.body}</p></div>}
      {context.authorization.active ? <p className="mt-2 text-xs text-slate-600">{candidate?.current ? "Esta já é a evidência ativa." : "Revogue a autorização atual antes de registrar outra evidência."}</p>
        : <label className="mt-3 flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} disabled={busy || !candidate} onChange={e => setConfirmed(e.target.checked)} />Revisei manualmente esta mensagem e confirmo evidência explícita apropriada à atualização cadastral na OpenCredit, finalidade CLIENT_PROFILE_CORRECTION. Isto não autoriza cadastro inicial nem declara automaticamente consentimento ou base legal.</label>}
      <button type="button" disabled={busy || !candidate || !confirmed || context.authorization.active} onClick={() => void mutate("grant")} className="mt-3 w-full rounded bg-brand px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">Registrar autorização</button>
      {context.authorization.exists && context.authorization.active && <button type="button" disabled={busy} onClick={() => void mutate("revoke")} className="mt-2 w-full rounded border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 focus-visible:ring-2 focus-visible:ring-rose-500 disabled:opacity-50">Revogar autorização</button>}
    </>}
    <button type="button" disabled={busy} onClick={() => void load()} className="mt-2 text-xs font-semibold text-primary underline focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50">Atualizar painel</button>
    <OpenCreditClientCorrectionPanel companyId={companyId} contactId={contactId} authorizationActive={!busy && context?.authorization.active === true} />
  </section>;
}
