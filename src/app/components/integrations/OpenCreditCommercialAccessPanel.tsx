"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Context = { ok: true; exists: boolean; enabled: boolean };
type Props = { enabled: boolean; companyId: string };
const base = "/api/admin/integrations/opencredit/commercial-access";
const unavailable = "Não foi possível atualizar o acesso comercial. Consulte o estado antes de tentar novamente.";
function parseContext(raw: unknown): Context | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return Object.keys(r).length === 3 && r.ok === true && typeof r.exists === "boolean" && typeof r.enabled === "boolean"
    && (r.exists || !r.enabled) ? { ok: true, exists: r.exists, enabled: r.enabled } : null;
}
export function OpenCreditCommercialAccessPanel(props: Props) {
  if (!props.enabled) return null;
  return <Review key={props.companyId} {...props} />;
}
function Review({ companyId }: Props) {
  const [context, setContext] = useState<Context | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0), working = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const currentContext = useRef<Context | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const epoch = ++sequence.current; working.current = true; currentContext.current = null; setBusy(true); setContext(null); setError("");
    try {
      const response = await fetch(base + "/context", { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); return; }
      const raw: unknown = await response.json();
      if (abort.signal.aborted || sequence.current !== epoch) return;
      const parsed = response.ok ? parseContext(raw) : null;
      if (!parsed) { setError(unavailable); return; }
      currentContext.current = parsed; setContext(parsed);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) setError(unavailable); }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }, [companyId]);
  const invalidate = useCallback(() => { sequence.current++; currentContext.current = null; controller.current?.abort(); }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  async function mutate(action: "grant" | "revoke") {
    const current = currentContext.current;
    if (working.current || hidden || !current || (action === "grant") === current.enabled) return;
    if (!window.confirm(action === "grant" ? "Confirma ativar o acesso comercial OpenCredit desta empresa?" : "Confirma revogar o acesso comercial OpenCredit desta empresa?")) return;
    working.current = true; currentContext.current = null; setBusy(true); setContext(null); setError("");
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const epoch = ++sequence.current;
    try {
      const response = await fetch(base + (action === "grant" ? "/grant" : "/revoke"), { method: "POST", credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId }) });
      if (abort.signal.aborted || sequence.current !== epoch) return;
      if (response.status === 401 || response.status === 403) { setHidden(true); return; }
      // Never trust mutation output as final state. No retry/replay, including network ambiguity.
      if (response.ok) { await load(); return; }
      setError(unavailable);
    } catch { if (!abort.signal.aborted && sequence.current === epoch) setError(unavailable); }
    finally { if (!abort.signal.aborted && sequence.current === epoch) { working.current = false; setBusy(false); } }
  }
  if (hidden) return null;
  return <section aria-label="Acesso comercial OpenCredit" className="mt-4 rounded border border-line bg-white p-3">
    <h3 className="text-sm font-bold">Acesso comercial OpenCredit</h3>
    <p className="mt-1 text-xs text-slate-500">Acesso operacional da empresa. Não representa consentimento ou autorização do consumidor.</p>
    {busy && <p role="status" className="mt-2 text-sm">Atualizando...</p>}
    {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}
    {context && <><p role="status" className="mt-2 text-sm font-semibold">{!context.exists ? "NÃO CONFIGURADO" : context.enabled ? "ATIVO" : "INATIVO"}</p>
      <button type="button" disabled={busy} onClick={() => void mutate(context.enabled ? "revoke" : "grant")} className="mt-2 rounded border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50">
        {context.enabled ? "Revogar acesso comercial" : "Ativar acesso comercial"}
      </button></>}
    <button type="button" disabled={busy} onClick={() => void load()} className="ml-2 mt-2 text-xs underline disabled:opacity-50">Atualizar acesso</button>
  </section>;
}
