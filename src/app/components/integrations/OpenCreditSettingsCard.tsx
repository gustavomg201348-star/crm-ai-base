"use client";

import { useEffect, useState } from "react";
import type { SafeOpenCreditIntegration } from "@/lib/opencredit-integration.service";

const button = "rounded-xl border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50";
type Setup = { integration: SafeOpenCreditIntegration; setupSecret: string };

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
    } catch {
      // Never serialize the response, exception or one-time secret in logs.
      setError("Não foi possível concluir a configuração. Recarregue a lista antes de tentar novamente.");
    } finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice("Copiado."); }
    catch { setError("Não foi possível copiar. Copie manualmente o campo exibido."); }
  }

  return (
    <section className="mt-6 space-y-4 rounded-3xl border border-line bg-white p-6" aria-labelledby="opencredit-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="opencredit-title" className="text-lg font-bold">OpenCredit / Prospecta</h2>
          <p className="text-sm text-slate-500">Configuração segura do webhook de leads. Não ativa IA, WhatsApp ou operações de crédito.</p>
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
            <strong>{row.enabled ? "Ativa" : "Desativada"}</strong>
            <span>Criada em {new Date(row.createdAt).toLocaleString("pt-BR")}</span>
          </div>
          <p className="break-all text-sm">{origin + row.webhookPath}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => void copy(origin + row.webhookPath)}>Copiar URL</button>
            <button type="button" className={button} disabled={busy || Boolean(setup)} onClick={() => {
              if (!row.enabled && !window.confirm("Ative somente depois que a URL e o segredo estiverem configurados no fornecedor.")) return;
              void mutate(`/api/integrations/opencredit/${encodeURIComponent(row.id)}`, "PATCH", { enabled: !row.enabled });
            }}>{row.enabled ? "Desativar" : "Ativar"}</button>
            <button type="button" className={button} disabled={busy || Boolean(setup)} onClick={() => {
              if (!window.confirm("O segredo atual deixará de funcionar e a integração será automaticamente desativada. Atualize o segredo no fornecedor antes de reativar. Deseja continuar?")) return;
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
            <p className="text-sm text-slate-600">A integração está desativada. Configure os dados no fornecedor antes de ativar.</p>
            <label className="block text-sm font-semibold">Webhook URL
              <input className="mt-1 w-full rounded-lg border p-2 font-normal" readOnly value={origin + setup.integration.webhookPath} />
            </label>
            <button type="button" className={button} onClick={() => void copy(origin + setup.integration.webhookPath)}>Copiar URL</button>
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
