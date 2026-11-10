"use client";
import { useEffect, useRef, useState } from "react";
import type { readMaterializationConfiguration } from "@/lib/opencredit-materialization-configuration.service";

type State = Awaited<ReturnType<typeof readMaterializationConfiguration>>;
const path = "/api/admin/integrations/opencredit/materialization/configuration";
const errors: Record<string, string> = {
  ROLLOUT_RESERVED: "Existe um rollout de materialização ainda reservado. Libere-o antes de ativar o modo NORMAL.",
  GATES_INVALID: "Para ativar, desative o legado, remova a pausa e habilite a inbox passiva.",
  CONFLICT: "A configuração mudou. Recarregue antes de tentar novamente.",
};
export function OpenCreditMaterializationSettings({ companyId, integrationId, materializationEnabled, onChanged }: {
  companyId: string; integrationId: string; materializationEnabled: boolean; onChanged(value: boolean): void;
}) {
  const [data, setData] = useState<State | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false), [uncertain, setUncertain] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); const version = ++sequence.current;
    setData(null); setError(""); setUncertain(false); setForbidden(false);
    void fetch(path, { method: "POST", cache: "no-store", signal: controller.signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "READ", companyId, integrationId }) })
      .then(async r => {
        if (!r.ok) { if (r.status === 403) setForbidden(true); throw Error("LOAD_FAILED"); }
        const state = await r.json() as State;
        if (!controller.signal.aborted && version === sequence.current) setData(state);
      }).catch(() => { if (!controller.signal.aborted) setError("Não foi possível confirmar o preflight administrativo."); });
    return () => controller.abort();
  }, [companyId, integrationId]);
  async function refresh() {
    const version = ++sequence.current;
    const r = await fetch(path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "READ", companyId, integrationId }) });
    if (!r.ok) throw Error("LOAD_FAILED");
    const state = await r.json() as State;
    if (version !== sequence.current) return;
    setData(state); setUncertain(false); onChanged(state.materializationEnabled);
  }
  async function toggle() {
    if (busy || !data || uncertain) return;
    const enabled = !data.materializationEnabled;
    if (!window.confirm(enabled
      ? "Ativar a materialização de novos eventos? Não haverá backfill da inbox. Jobs já existentes na fila seguem os gates atuais do worker."
      : "Desativar a materialização? Novos eventos continuarão na inbox passiva sem gerar jobs.")) return;
    setBusy(true); setError(""); setUncertain(true);
    let failure = "Gravação não confirmada. Recarregue o estado antes de tentar novamente.";
    try {
      const r = await fetch(path, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action: "SET", companyId, integrationId, materializationEnabled: enabled, expectedUpdatedAt: data.updatedAt,
      }) });
      if (!r.ok) { const result = await r.json() as { error?: string }; failure = errors[result.error ?? ""] ?? failure; throw Error("WRITE_FAILED"); }
      // Never render an optimistic toggle or retry an ambiguous write.
      await refresh();
    } catch { setError(failure); }
    finally { setBusy(false); }
  }
  const enabled = data?.materializationEnabled ?? materializationEnabled;
  const gatesInvalid = !!data && (data.enabled || data.paused || !data.passiveInboundEnabled);
  return <section className="space-y-2 rounded-xl border border-line bg-slate-50 p-4" aria-label="Materialização de leads OpenCredit">
    <h3 className="font-semibold">Materialização de leads</h3>
    <p>Materialização: <strong>{uncertain ? "ESTADO NÃO CONFIRMADO" : enabled ? "ATIVA" : "DESATIVADA"}</strong></p>
    <p className="text-xs text-slate-600">A materialização transforma novos eventos OpenCredit em contatos/conversas no CRM. Eventos históricos da inbox não geram jobs automaticamente. Jobs já existentes na fila seguem os gates atuais do worker.</p>
    {data && <dl className="text-sm">
      <div>Interlock pronto: {data.interlockReady ? "SIM" : "NÃO"}</div>
      <div>Binding reservado: {data.bindingReserved ? "SIM" : "NÃO"}</div>
      <div>Claimable agora: {data.queue.claimableNow}{data.queue.complete ? "" : " (preflight parcial)"}</div>
      <div>PENDING: {data.queue.counts.PENDING} · RETRY: {data.queue.counts.RETRY} · NEEDS_REVIEW: {data.queue.counts.NEEDS_REVIEW}</div>
    </dl>}
    {data?.bindingReserved && <p role="status" className="text-sm text-amber-800">{errors.ROLLOUT_RESERVED}</p>}
    {gatesInvalid && !enabled && <p className="text-sm">{errors.GATES_INVALID}</p>}
    {forbidden ? <p className="text-sm">Apenas o Platform Admin pode ativar/desativar materialização.</p> : <div className="flex gap-2">
      <button type="button" className="rounded-lg border border-line bg-white px-3 py-2 text-sm disabled:opacity-50"
        disabled={busy || uncertain || !data || !enabled && (data.bindingReserved || gatesInvalid)} onClick={() => void toggle()}>
        {enabled ? "Desativar materialização" : "Ativar materialização"}
      </button>
      <button type="button" disabled={busy} className="rounded-lg border border-line px-3 py-2 text-sm" onClick={() => {
        setBusy(true); setError(""); void refresh().catch(() => setError("Estado não confirmado. Recarregue novamente.")).finally(() => setBusy(false));
      }}>Recarregar estado</button>
    </div>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
