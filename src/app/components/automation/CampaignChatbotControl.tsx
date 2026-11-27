"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";

const campaignEndpoint = "/api/campaigns/clt-chatbot";

type Binding = { enabled: boolean; optionId: string };
type CampaignState = { binding: Binding | null; companyEnabled: boolean };

export async function setCampaignChatbotEnabled(campaignId: string, enabled: boolean) {
  const response = await fetch(campaignEndpoint, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId, enabled })
  });
  const data = await response.json().catch(() => null);
  if (response.ok && data?.binding?.enabled === enabled) return data.binding as Binding;
  if (data?.error === "PAUSE_PENDING") throw new Error("A pausa anterior ainda está sendo processada.");
  if (data?.error === "COMPANY_CHATBOT_DISABLED") throw new Error("O controle geral está desligado. Abra Comunicação → Chatbot para liberar.");
  if (data?.error === "INVALID_TEMPLATE") throw new Error("O template ou o botão vinculado não está disponível.");
  throw new Error("Não foi possível confirmar a alteração desta campanha.");
}

export function CampaignChatbotControl({ campaign }: { campaign: { id: string; status: string } }) {
  const [state, setState] = useState<CampaignState | null>(null);
  const [title, setTitle] = useState("Conferir");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const read = useCallback(async (signal?: AbortSignal) => {
    const [bindingResponse, companyResponse] = await Promise.all([
      fetch(campaignEndpoint + "?campaignId=" + encodeURIComponent(campaign.id), { cache: "no-store", signal }),
      fetch(campaignEndpoint + "/company", { cache: "no-store", signal })
    ]);
    const [data, company] = await Promise.all([bindingResponse.json(), companyResponse.json()]);
    const missing = bindingResponse.status === 404 && data.error === "BINDING_NOT_FOUND";
    if (!companyResponse.ok || typeof company.enabled !== "boolean" ||
        (!missing && (!bindingResponse.ok || typeof data.binding?.enabled !== "boolean"))) {
      throw new Error("Não foi possível consultar o estado da campanha.");
    }
    if (!signal?.aborted) setState({ binding: missing ? null : data.binding, companyEnabled: company.enabled });
  }, [campaign.id]);

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("Status indisponível. Atualize antes de alterar a campanha.");
    });
    return () => controller.abort();
  }, [read]);

  async function toggle() {
    if (inFlight.current || !state) return;
    const enabled = !state.binding?.enabled;
    if (enabled && (!state.companyEnabled || (!state.binding && campaign.status !== "DRAFT"))) return;
    if (enabled && !window.confirm("Ativar o Chatbot para novos envios desta campanha? Templates enviados antes da ativação não iniciam o fluxo.")) return;

    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (!state.binding) {
        const response = await fetch(campaignEndpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ campaignId: campaign.id, buttonTitle: title })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error === "INVALID_TRIGGER" ? "O template não possui o botão selecionado." : "Não foi possível vincular o Chatbot.");
        }
      }
      await setCampaignChatbotEnabled(campaign.id, enabled);
      await read();
    } catch (cause) {
      setState(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar o Chatbot.");
      try { await read(); } catch { /* Preserve the unknown state until a read succeeds. */ }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await read();
    } catch {
      setState(null);
      setError("Status indisponível. Tente atualizar.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const enabled = Boolean(state?.binding?.enabled);
  return (
    <section className="mt-4 rounded-2xl border border-line bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-900">Chatbot comercial CLT</h4>
          <p aria-live="polite" className={clsx("text-xs font-semibold", enabled && state?.companyEnabled ? "text-emerald-700" : "text-slate-600")}>
            {busy ? "Atualizando…" : !state ? "Status não confirmado" : enabled && state.companyEnabled ? "Ativado" : state.binding ? "Desativado" : "Sem vínculo"}
          </p>
        </div>
        <button type="button" role="switch" aria-label="Chatbot comercial CLT" aria-checked={enabled}
          disabled={busy || !state || (!enabled && (!state.companyEnabled || (!state.binding && campaign.status !== "DRAFT")))}
          onClick={() => void toggle()} className={clsx("relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50", enabled ? "bg-emerald-600" : "bg-slate-400")}>
          <span className={clsx("absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all", enabled ? "left-6" : "left-1")} />
        </button>
      </div>
      {state && !state.binding && campaign.status === "DRAFT" && (
        <label className="mt-3 block text-xs font-semibold text-slate-600">
          Botão do template
          <select className="mt-1 h-9 w-full rounded-lg border border-line bg-white px-2" value={title} disabled={busy} onChange={(event) => setTitle(event.target.value)}>
            <option>Conferir</option>
            <option>Verificar</option>
          </select>
        </label>
      )}
      {state?.binding && <p className="mt-2 text-xs text-slate-600">Gatilho · {state.binding.optionId === "CONFERIR" ? "Conferir" : "Verificar"}</p>}
      {state && !state.companyEnabled && <p className="mt-2 text-xs text-slate-600">O controle geral está desligado. Gerencie em Comunicação → Chatbot.</p>}
      {state && !state.binding && campaign.status !== "DRAFT" && <p className="mt-2 text-xs text-slate-600">O vínculo de uma nova campanha é configurado no rascunho.</p>}
      {error && <p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void refresh()} className="mt-2 text-xs font-semibold text-brand disabled:opacity-50">Atualizar status</button>
    </section>
  );
}
