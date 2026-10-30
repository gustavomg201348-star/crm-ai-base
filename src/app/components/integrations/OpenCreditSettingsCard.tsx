"use client";

import { useEffect, useState } from "react";
import type { OpenCreditStatus, SafeOpenCreditIntegration } from "@/lib/opencredit-integration.service";

const button = "rounded-xl border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50";
type Setup = { integration: SafeOpenCreditIntegration; setupSecret: string };

const statusLabel: Record<OpenCreditStatus, string> = {
  ACTIVE: "Recebendo leads",
  PAUSED: "Recebimento pausado",
  DISABLED: "Legado desativado"
};
const statusHelp: Record<OpenCreditStatus, string> = {
  ACTIVE: "Novos leads recebidos ficam disponíveis normalmente.",
  PAUSED: "A Prospecta continua entregando normalmente, mas os novos leads ficam retidos no QEVORA até você retomar.",
  DISABLED: "O webhook legado é recusado. A inbox passiva tem controle independente."
};

export function OpenCreditSettingsCard() {
  const [integrations, setIntegrations] = useState<SafeOpenCreditIntegration[]>([]);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);

  useEffect(() => {
    let active = true;
    const abort = new AbortController();
    setOrigin(window.location.origin);
    void fetch("/api/integrations/opencredit", { cache: "no-store", signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error("LOAD_FAILED");
        const data = await response.json() as { integrations: SafeOpenCreditIntegration[] };
        if (active) setIntegrations(data.integrations);
      })
      .catch(() => { if (active) setError("Não foi possível carregar as integrações OpenCredit."); });
    return () => { active = false; abort.abort(); };
  }, []);

  async function mutate(path: string, method: "POST" | "PATCH", body: Record<string, unknown> = {}) {
    if (busy || setup) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, {
        method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      if (!response.ok) throw new Error("CONFIGURATION_FAILED");
      const data = await response.json() as { integration: SafeOpenCreditIntegration; setupSecret?: string };
      setIntegrations(current => [data.integration, ...current.filter(row => row.id !== data.integration.id)]);
      if (typeof data.setupSecret === "string") setSetup({ integration: data.integration, setupSecret: data.setupSecret });
      else setNotice("Status atualizado.");
    } catch {
      setError("Não foi possível concluir a configuração. Recarregue a lista antes de tentar novamente.");
    } finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copiado."); }
    catch { setError("Não foi possível copiar. Copie manualmente o campo exibido."); }
  }

  function changeStatus(row: SafeOpenCreditIntegration, status: OpenCreditStatus) {
    if (status === "ACTIVE" && row.status === "DISABLED" &&
        !window.confirm("Ative somente depois que a URL e o segredo estiverem configurados no fornecedor. Deseja ativar?")) return;
    if (status === "PAUSED" &&
        !window.confirm("Durante a pausa, os novos leads continuarão sendo recebidos, mas ficarão retidos até você retomar. Deseja pausar?")) return;
    if (status === "DISABLED" &&
        !window.confirm("Isso bloqueará somente o webhook legado, sem alterar a inbox passiva. Deseja desativar o legado?")) return;
    void mutate(`/api/integrations/opencredit/${encodeURIComponent(row.id)}`, "PATCH", { status });
  }

  return (
    <section className="mt-6 space-y-4 rounded-3xl border border-line bg-white p-6" aria-labelledby="opencredit-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="opencredit-title" className="text-lg font-bold">OpenCredit / Prospecta</h2>
          <p className="text-sm text-slate-500">Webhook legado e inbox passiva têm habilitações independentes. A pausa controla somente a retenção de leads legados.</p>
        </div>
        <button type="button" className={button} disabled={busy || Boolean(setup)}
          onClick={() => void mutate("/api/integrations/opencredit", "POST")}>Criar integração</button>
      </div>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}
      {!integrations.length && <p className="text-sm text-slate-500">Nenhuma integração carregada.</p>}

      {integrations.map(row => (
        <div key={row.id} className="space-y-3 rounded-2xl border border-line p-4">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <strong>Webhook legado: {statusLabel[row.status]}</strong>
            <span>Criada em {new Date(row.createdAt).toLocaleString("pt-BR")}</span>
          </div>
          <p className="text-sm text-slate-500">{statusHelp[row.status]}</p>
          <p className="break-all text-sm">URL legada: {origin + row.webhookPath}</p>
          <p className="text-sm">Inbox passiva: {row.passiveInboundEnabled ? "Habilitada" : "Desabilitada"}</p>
          <p className="break-all text-sm">URL passiva: {origin + row.passiveInboundPath}</p>
          <p className="text-sm text-slate-500">Habilitação passiva requer provisionamento explícito; os controles abaixo alteram somente o legado, exceto a rotação do segredo, que desabilita ambas as rotas.</p>

          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void copy(origin + row.webhookPath)}>Copiar URL legada</button>
            <button type="button" className={button} onClick={() => void copy(origin + row.passiveInboundPath)}>Copiar URL passiva</button>
            {row.status === "ACTIVE" && (
              <button type="button" className={button} disabled={busy || Boolean(setup)}
                onClick={() => changeStatus(row, "PAUSED")}>Pausar recebimento</button>
            )}
            {row.status === "PAUSED" && (
              <button type="button" className={button} disabled={busy || Boolean(setup)}
                onClick={() => changeStatus(row, "ACTIVE")}>Retomar recebimento</button>
            )}
            {row.status === "DISABLED" && (
              <button type="button" className={button} disabled={busy || Boolean(setup)}
                onClick={() => changeStatus(row, "ACTIVE")}>Ativar legado</button>
            )}
            {row.status !== "DISABLED" && (
              <button type="button" className={button} disabled={busy || Boolean(setup)}
                onClick={() => changeStatus(row, "DISABLED")}>Desativar legado</button>
            )}
            <button type="button" className={button} disabled={busy || Boolean(setup)} onClick={() => {
              if (!window.confirm("O segredo atual deixará de funcionar e ambas as rotas serão desativadas. Atualize o segredo no fornecedor antes de reativar. Deseja continuar?")) return;
              void mutate(`/api/integrations/opencredit/${encodeURIComponent(row.id)}/rotate-secret`, "POST");
            }}>Rotacionar segredo</button>
          </div>
        </div>
      ))}

      {setup && (
        <div role="dialog" aria-modal="true" aria-label="Segredo de configuração OpenCredit"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="font-bold">Copie este segredo agora. Ele não será exibido novamente.</h3>
            <p className="text-sm text-slate-600">Ambas as rotas estão desativadas. Configure somente a rota pretendida no fornecedor antes da habilitação explícita.</p>
            <label className="block text-sm font-semibold">Webhook URL legada
              <input className="mt-1 w-full rounded-lg border p-2 font-normal" readOnly value={origin + setup.integration.webhookPath} />
            </label>
            <button type="button" className={button} onClick={() => void copy(origin + setup.integration.webhookPath)}>Copiar URL</button>
            <label className="block text-sm font-semibold">Inbox passiva URL
              <input className="mt-1 w-full rounded-lg border p-2 font-normal" readOnly value={origin + setup.integration.passiveInboundPath} />
            </label>
            <button type="button" className={button} onClick={() => void copy(origin + setup.integration.passiveInboundPath)}>Copiar URL passiva</button>
            <label className="block text-sm font-semibold">HMAC Secret
              <input className="mt-1 w-full rounded-lg border p-2 font-mono font-normal" readOnly autoComplete="off" value={setup.setupSecret} />
            </label>
            <button type="button" className={button} onClick={() => void copy(setup.setupSecret)}>Copiar segredo</button>
            <div><button type="button" className={button} onClick={() => { setSetup(null); setNotice(""); }}>Fechar e limpar segredo</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
