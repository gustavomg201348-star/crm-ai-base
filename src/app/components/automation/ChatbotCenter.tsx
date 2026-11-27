"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, GitBranch, History, RefreshCw } from "lucide-react";
import clsx from "clsx";
import type { ChatbotCenterData } from "@/lib/chatbot-center";
import type { ChatbotDefinition } from "@/lib/chatbot-definition";
import { setCampaignChatbotEnabled } from "./CampaignChatbotControl";

const card = "rounded-2xl border border-line bg-white p-4 shadow-soft sm:p-5";
const compactButton = "rounded-xl border border-line px-3 py-2 text-sm font-semibold disabled:opacity-50";
const stepLabels: Record<string, string> = {
  proposal: "Proposta anterior",
  competitor: "Condições da concorrência",
  competitor_check: "Conferência das condições",
  priority: "Prioridade do cliente",
  need: "Necessidade de crédito",
  amount: "Valor desejado",
  final_message: "Mensagem final",
  handoff: "Atendimento humano"
};
const sessionLabels: Record<string, string> = {
  ACTIVE: "Em andamento", CLOSED: "Encerrada", COMPLETED: "Concluída", CANCELED: "Cancelada",
  SUSPENDED: "Suspensa", EXPIRED: "Expirada", HUMAN_HANDOFF: "Encaminhada ao atendimento"
};
const stepName = (id: string) => stepLabels[id] ?? id.replace(/[-_]/g, " ");
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function FlowDetails({ definition, title }: { definition: ChatbotDefinition; title: string }) {
  return (
    <details className="rounded-xl border border-line bg-slate-50">
      <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-brand">{title}</summary>
      <ol className="divide-y divide-slate-200 border-t border-line px-3">
        {definition.steps.map((step) => (
          <li key={step.id} className="space-y-1.5 py-3 text-sm text-slate-600">
            <p className="font-semibold text-slate-900">{stepName(step.id)}{step.id === definition.entryStepId ? " · Início do fluxo" : ""}</p>
            {"text" in step && <p className="break-words">{step.text}</p>}
            {"options" in step && (
              <ul className="space-y-1 pl-4 text-xs">
                {step.options.map((option) => <li key={option.id}>{option.title} → {stepName(option.next)}</li>)}
              </ul>
            )}
            {"next" in step && <p className="text-xs">Próxima etapa · {stepName(step.next)}</p>}
            {step.type === "CONDITION" && (
              <ul className="space-y-1 pl-4 text-xs">
                {step.branches.map((branch) => <li key={branch.equals}>Resposta “{branch.equals}” → {stepName(branch.next)}</li>)}
                <li>Demais respostas → {stepName(step.otherwise)}</li>
              </ul>
            )}
            {step.type === "HANDOFF" && <p>Encaminha à fila de atendimento e preserva as respostas coletadas na conversa.</p>}
            {step.type === "END" && <p>Encerra a sessão.</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ChatbotCenter() {
  const [data, setData] = useState<ChatbotCenterData | null>(null);
  const [pending, setPending] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inFlight = useRef(false);

  const read = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/chatbot/center", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Não foi possível consultar a Central do Chatbot.");
    const payload: ChatbotCenterData = await response.json();
    if (!signal?.aborted) setData(payload);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("Não foi possível confirmar o estado do Chatbot.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [read]);

  async function run(action: string, update?: () => Promise<unknown>) {
    if (inFlight.current || loading) return;
    inFlight.current = true;
    setPending(action);
    setError("");
    try {
      await update?.();
      await read();
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Não foi possível confirmar a alteração.");
      if (update) {
        try { await read(); } catch { /* Preserve unknown state when the read also fails. */ }
      }
    } finally {
      inFlight.current = false;
      setPending("");
    }
  }

  function changeCompany(enabled: boolean) {
    if (enabled && !window.confirm("Liberar o Chatbot CLT nesta empresa? As campanhas são ativadas individualmente.")) return;
    void run("company", async () => {
      const response = await fetch("/api/campaigns/clt-chatbot/company", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.enabled !== enabled) throw new Error("Não foi possível confirmar a alteração do controle geral.");
    });
  }

  function changeCampaign(campaignId: string, enabled: boolean) {
    if (enabled && !window.confirm("Ativar o Chatbot para novos envios desta campanha? Templates enviados antes da ativação não iniciam o fluxo.")) return;
    void run(campaignId, () => setCampaignChatbotEnabled(campaignId, enabled));
  }

  const enabledCampaigns = data?.campaigns.filter((campaign) => campaign.enabled).length ?? 0;
  const status = !data ? "Estado não confirmado" : !data.enabled ? "Desligado para a empresa" :
    enabledCampaigns === 0 ? "Liberado · sem campanha ativa" : "Liberado · " + enabledCampaigns + (enabledCampaigns === 1 ? " campanha ativa" : " campanhas ativas");
  const busy = loading || Boolean(pending);
  const campaignNamesByFlow = new Map<string, string[]>();
  for (const binding of data?.campaigns ?? []) {
    const names = campaignNamesByFlow.get(binding.flowId);
    if (names) names.push(binding.campaign.name);
    else campaignNamesByFlow.set(binding.flowId, [binding.campaign.name]);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-brand" aria-hidden="true" /><h3 className="text-lg font-bold text-slate-950">Controle geral do Chatbot CLT</h3></div>
            <p aria-live="polite" className={clsx("mt-2 w-fit rounded-full px-3 py-1.5 text-xs font-semibold", data?.enabled ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-700")}>
              {loading ? "Consultando estado…" : status}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">Desligar pausa a automação e desativa os vínculos. Ao liberar, ative cada campanha novamente. Um envio já autorizado pode terminar.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !data || data.enabled} onClick={() => changeCompany(true)} className={compactButton + " bg-blue-50 text-brand"}>Liberar Chatbot</button>
            <button type="button" disabled={busy} onClick={() => changeCompany(false)} className={compactButton + " border-rose-200 bg-rose-50 text-rose-800"}>Desligar todos</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={busy} onClick={() => void run("refresh")} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand disabled:opacity-50">
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Atualizar estado
          </button>
          {pending && <p role="status" className="text-xs text-slate-600">Atualizando…</p>}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </div>
      </section>

      {data && <>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <section className={card}>
            <h3 className="text-base font-bold text-slate-950">Campanhas vinculadas</h3>
            {data.campaigns.length === 0 && <p className="mt-2 text-sm text-slate-600">Nenhuma campanha vinculada. Configure o gatilho no rascunho da campanha em Disparos.</p>}
            <ul className="mt-2 divide-y divide-slate-200">
              {data.campaigns.map((binding) => (
                <li key={binding.campaignId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold text-slate-900">{binding.campaign.name}</p>
                    <p className="break-words text-xs text-slate-600">{binding.optionId === "CONFERIR" ? "Conferir" : "Verificar"} · {binding.templateName} · v{binding.version.number}</p>
                    <p className={clsx("mt-1 text-xs font-semibold", data.enabled && binding.enabled ? "text-emerald-700" : "text-slate-600")}>{binding.enabled ? (data.enabled ? "Ativa" : "Vínculo ativo · controle geral desligado") : "Desativada"}</p>
                  </div>
                  <button type="button" disabled={busy || (!data.enabled && !binding.enabled)}
                    aria-label={(binding.enabled ? "Desativar " : "Ativar ") + binding.campaign.name}
                    className={compactButton + " text-brand"} onClick={() => changeCampaign(binding.campaignId, !binding.enabled)}>
                    {binding.enabled ? "Desativar" : "Ativar"}
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className={card}>
            <div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-brand" aria-hidden="true" /><h3 className="text-base font-bold text-slate-950">Fluxos</h3></div>
            <p className="mt-2 text-sm text-slate-600">No fluxo comercial CLT, a campanha define Conferir ou Verificar como gatilho. O clique deve corresponder ao template enviado. Ao concluir, a conversa segue para a fila humana.</p>
            <div className="mt-3 space-y-2">
              <FlowDetails definition={data.cltDefinition} title="Ver fluxo comercial CLT" />
              {data.flows.length === 0 && <p className="text-sm text-slate-600">Nenhum fluxo publicado para esta empresa.</p>}
              {data.flows.map((flow) => (
                <div key={flow.id} className="rounded-xl border border-line px-3 py-2.5">
                  <p className="text-sm font-semibold text-slate-900">{flow.name}</p>
                  {campaignNamesByFlow.has(flow.id) && (
                    <p className="mt-1 break-words text-xs text-slate-600">{campaignNamesByFlow.get(flow.id)?.join(" · ")}</p>
                  )}
                  <p className="my-1 text-xs text-slate-600">{flow.version ? "Versão publicada " + flow.version : "Sem versão publicada"} · {flow.isActive ? "Habilitado" : "Desabilitado"}</p>
                  {flow.definition && <FlowDetails definition={flow.definition} title="Ver versão publicada" />}
                  {flow.version && !flow.definition && <p className="text-xs text-slate-600">Visualização da versão indisponível.</p>}
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className={card}>
          <div className="flex items-center gap-2"><History className="h-4 w-4 text-brand" aria-hidden="true" /><h3 className="text-base font-bold text-slate-950">Sessões do Chatbot</h3></div>
          <dl className="mt-3 grid grid-cols-3 gap-2">
            {[["Registradas", data.metrics.total], ["Em andamento", data.metrics.active], ["Encaminhadas", data.metrics.handoff]].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl bg-slate-50 px-2 py-2.5 sm:px-3">
                <dt className="break-words text-xs font-medium text-slate-600">{label}</dt><dd className="text-xl font-bold text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          {data.sessions.length === 0 ? <p className="mt-3 text-sm text-slate-600">Ainda não há sessões registradas.</p> : <>
            <h4 className="mt-4 text-sm font-semibold text-slate-900">Até 20 sessões mais recentes</h4>
            <ul className="mt-1 divide-y divide-slate-200">
              {data.sessions.map((session) => (
                <li key={session.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="min-w-0"><p className="break-words font-medium text-slate-900">{session.campaign?.name ?? session.version.flow.name}</p><p className="text-xs text-slate-600">Versão {session.version.number}</p></div>
                  <div><p className="font-medium text-slate-800">{sessionLabels[session.closureReason ?? ""] ?? sessionLabels[session.status] ?? session.status}</p><p className="text-xs text-slate-600">{stepName(session.currentStepId)}</p></div>
                  <time dateTime={session.createdAt} className="text-xs text-slate-600">{dateFormat.format(new Date(session.createdAt))}</time>
                </li>
              ))}
            </ul>
          </>}
        </section>
      </>}
    </div>
  );
}
