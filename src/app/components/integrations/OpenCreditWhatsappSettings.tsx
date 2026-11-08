"use client";
import { useEffect, useRef, useState } from "react";
import type { WhatsappBootstrapConfigInput } from "@/lib/opencredit-whatsapp-config.service";
type Data = { config: Omit<WhatsappBootstrapConfigInput, "expectedRevision"> & { revision: number };
  channels: Array<{ id: string; name: string }>; templates: Array<{ name: string; language: string }> };
const empty: WhatsappBootstrapConfigInput = { defaultWhatsappChannelId: null, initialTemplateName: null,
  initialTemplateLanguage: null, autoStartEnabled: false, expectedRevision: 0 };
export function OpenCreditWhatsappSettings({ integrationId }: { integrationId: string }) {
  const [form, setForm] = useState(empty), [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const path = `/api/integrations/opencredit/${encodeURIComponent(integrationId)}/whatsapp`;
  useEffect(() => {
    const controller = new AbortController(); const n = ++sequence.current;
    void fetch(path, { cache: "no-store", signal: controller.signal }).then(async r => {
      if (!r.ok) throw Error("CONFIGURATION_UNAVAILABLE");
      const value = await r.json() as Data; if (controller.signal.aborted || n !== sequence.current) return;
      setData(value); const { revision, ...config } = value.config; setForm({ ...config, expectedRevision: revision });
    }).catch(() => { if (!controller.signal.aborted) setError("Configuração WhatsApp indisponível para esta integração."); });
    return () => { controller.abort(); };
  }, [path]);
  async function channel(id: string) {
    const n = ++sequence.current; setNotice(""); setError("");
    setForm(f => ({ ...f, defaultWhatsappChannelId: id || null, initialTemplateName: null, initialTemplateLanguage: null, autoStartEnabled: false }));
    setData(d => d ? { ...d, templates: [] } : d);
    if (!id) return;
    try { const r = await fetch(path + "?channelId=" + encodeURIComponent(id), { cache: "no-store" });
      if (!r.ok) throw Error("TEMPLATES_UNAVAILABLE"); const value = await r.json() as Data;
      if (n === sequence.current) setData(value);
    } catch { if (n === sequence.current) setError("Não foi possível carregar os templates locais aprovados."); }
  }
  async function save() {
    if (busy) return; setBusy(true); setError(""); setNotice(""); sequence.current++;
    try {
      const r = await fetch(path, { method: "PATCH", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!r.ok) throw Error("SAVE_FAILED"); const value = await r.json() as Data; setData(value);
      const { revision, ...config } = value.config; setForm({ ...config, expectedRevision: revision }); setNotice("Configuração salva. Nenhum lead existente foi iniciado por esta ação.");
    } catch { setError("Não foi possível confirmar a gravação. Recarregue antes de tentar novamente."); }
    finally { setBusy(false); }
  }
  const selected = JSON.stringify([form.initialTemplateName, form.initialTemplateLanguage]);
  return <fieldset className="space-y-3 rounded-xl border border-line bg-slate-50 p-4" disabled={busy || !data}>
    <legend className="px-2 font-bold">OpenCredit → WhatsApp</legend>
    <label className="block text-sm">WhatsApp padrão para novos leads
      <select className="mt-1 w-full rounded-lg border border-line p-2" value={form.defaultWhatsappChannelId ?? ""} onChange={e => void channel(e.target.value)}>
        <option value="">Não configurado</option>
        {form.defaultWhatsappChannelId && !data?.channels.some(c => c.id === form.defaultWhatsappChannelId) && <option value={form.defaultWhatsappChannelId}>Canal configurado indisponível</option>}
        {data?.channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
    <label className="block text-sm">Template inicial
      <select className="mt-1 w-full rounded-lg border border-line p-2" value={form.initialTemplateName ? selected : ""} onChange={e => {
        const [name, language] = e.target.value ? JSON.parse(e.target.value) as [string, string] : [null, null];
        setForm(f => ({ ...f, initialTemplateName: name, initialTemplateLanguage: language, autoStartEnabled: false }));
      }}>
        <option value="">Não configurado</option>
        {data?.templates.map(t => <option key={JSON.stringify([t.name,t.language])} value={JSON.stringify([t.name,t.language])}>{t.name} ({t.language})</option>)}
      </select>
    </label>
    <p className="text-xs text-slate-500">Biblioteca local existente: apenas templates aprovados e prontos, sem variáveis nem mídia nesta versão. O modo da empresa/conversa deve permitir AUTO ou HYBRID.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.autoStartEnabled}
      disabled={!form.defaultWhatsappChannelId || !form.initialTemplateName}
      onChange={e => { const enabled = e.target.checked; if (enabled && !window.confirm("Iniciar novos leads com o template aprovado quando forem materializados? Esta ação não processa o histórico.")) return;
        setForm(f => ({ ...f, autoStartEnabled: enabled })); }} />Iniciar novos leads automaticamente</label>
    <button type="button" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold" onClick={() => void save()}>{busy ? "Salvando..." : "Salvar WhatsApp da OpenCredit"}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-teal-700">{notice}</p>}
  </fieldset>;
}
