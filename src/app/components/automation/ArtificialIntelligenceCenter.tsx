"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CircleCheck, MessageSquareText, Sparkles } from "lucide-react";
import type { CompanyAiSettings } from "@/lib/company-ai-settings";
import type { AiMode } from "@/lib/ai-attendant.service";

const modes: Record<AiMode, { title: string; description: string }> = {
  OFF: { title: "Desligado", description: "A IA fica desligada por padrão." },
  COPILOT: { title: "Copiloto", description: "A IA sugere respostas para a equipe." },
  AUTO: { title: "Automático", description: "A IA pode responder a novas mensagens." },
  HYBRID: { title: "Híbrido", description: "A IA pode responder em conversas sem responsável." }
};
const inputStyle = "mt-2 w-full rounded-xl border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-brand";

type Draft = Pick<CompanyAiSettings, "mode" | "instructions" | "checkAutoReplyOverride">;

export function ArtificialIntelligenceCenter({ onModeSaved }: { onModeSaved: (mode: AiMode) => void }) {
  const [settings, setSettings] = useState<CompanyAiSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [readAttempt, setReadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/settings/ai", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const data: { settings: CompanyAiSettings } = await response.json();
        if (controller.signal.aborted) return;
        setSettings(data.settings);
        setDraft(data.settings);
      } catch {
        if (!controller.signal.aborted) setError("Não foi possível carregar as configurações da IA.");
      }
    }
    void read();
    return () => controller.abort();
  }, [readAttempt]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !settings || saving) return;

    const changes = {
      ...(draft.mode !== settings.mode ? { mode: draft.mode } : {}),
      ...(draft.instructions !== settings.instructions ? { instructions: draft.instructions } : {}),
      ...(draft.checkAutoReplyOverride !== settings.checkAutoReplyOverride ? { checkAutoReplyOverride: draft.checkAutoReplyOverride } : {})
    };
    if (!Object.keys(changes).length) return;

    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch("/api/settings/ai", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes)
      });
      if (!response.ok) throw new Error();
      const data: { settings: CompanyAiSettings } = await response.json();
      setSettings(data.settings);
      setDraft(data.settings);
      onModeSaved(data.settings.mode);
      setSaved(true);
    } catch {
      setError("Não foi possível confirmar as alterações. Tente salvar novamente.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings || !draft) {
    return (
      <section className="rounded-2xl border border-line bg-white p-5 shadow-soft">
        {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : <p role="status" className="text-sm text-slate-600">Carregando configurações da IA…</p>}
        {error && <button type="button" className="mt-3 text-sm font-semibold text-brand" onClick={() => { setError(""); setReadAttempt((current) => current + 1); }}>Tentar novamente</button>}
      </section>
    );
  }

  const dirty = draft.mode !== settings.mode || draft.instructions !== settings.instructions ||
    draft.checkAutoReplyOverride !== settings.checkAutoReplyOverride;
  const status = settings.checkAutoReplyEnabled ? "Ativada" : "Desativada";
  const statusSource = settings.checkAutoReplyOverride === null ? "padrão do ambiente" : "configuração da empresa";

  return (
    <form onSubmit={save} className="mx-auto max-w-6xl space-y-4">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-brand" aria-hidden="true" />
              <h3 className="text-lg font-bold text-slate-950">Modo de atendimento</h3>
            </div>
            <p className="mt-1 text-sm text-slate-600">O modo individual e a pausa da conversa continuam disponíveis no Atendimento.</p>
          </div>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-brand">Modo atual · {modes[settings.mode].title}</span>
        </div>
        <fieldset disabled={saving} className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="mb-2 text-sm font-semibold text-slate-900">Modo padrão da empresa</legend>
          {(Object.keys(modes) as AiMode[]).map((mode) => (
            <label key={mode} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-blue-50">
              <input type="radio" name="mode" value={mode} checked={draft.mode === mode} className="mt-1 accent-blue-600" onChange={() => setDraft({ ...draft, mode })} />
              <span><span className="block font-semibold text-slate-900">{modes[mode].title}</span><span className="mt-0.5 block text-xs text-slate-600">{modes[mode].description}</span></span>
            </label>
          ))}
        </fieldset>
        <p className="mt-3 text-xs text-slate-600">{settings.providerConfigured ? "Chave do provedor de IA configurada." : "Chave do provedor de IA ausente."}</p>
        <label className="mt-5 block text-sm font-semibold text-slate-900">
          Instruções internas da IA
          <textarea className={inputStyle + " min-h-28 font-normal"} value={draft.instructions} disabled={saving} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} />
        </label>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-brand" aria-hidden="true" />
              <h3 className="text-lg font-bold text-slate-950">Resposta a Conferir ou Verificar</h3>
            </div>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Controla a resposta fixa a mensagens verificadas, independentemente do modo padrão. O Chatbot CLT, a simulação e a pré-qualificação têm controles próprios.</p>
          </div>
          <span className={settings.checkAutoReplyEnabled ? "rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800" : "rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700"}>{status} · {statusSource}</span>
        </div>
        <label className="mt-4 block max-w-sm text-sm font-semibold text-slate-900">
          Resposta fixa da empresa
          <select className={inputStyle} disabled={saving} value={draft.checkAutoReplyOverride === null ? "inherit" : String(draft.checkAutoReplyOverride)} onChange={(event) => {
            const value = event.target.value;
            setDraft({ ...draft, checkAutoReplyOverride: value === "inherit" ? null : value === "true" });
          }}>
            <option value="inherit">Herdar padrão do ambiente</option>
            <option value="true">Ativar resposta fixa</option>
            <option value="false">Desativar resposta fixa</option>
          </select>
        </label>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {saved && !dirty && <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CircleCheck className="h-4 w-4" aria-hidden="true" /> Configurações salvas</p>}
        <button type="submit" disabled={!dirty || saving} className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar alterações"}</button>
      </div>
    </form>
  );
}
