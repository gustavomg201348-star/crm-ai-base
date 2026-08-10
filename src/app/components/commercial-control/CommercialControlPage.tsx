"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { ControlRoomAttentionList } from "@/app/components/commercial-control/ControlRoomAttentionList";
import { ControlRoomGoalPace } from "@/app/components/commercial-control/ControlRoomGoalPace";
import { ControlRoomMetric } from "@/app/components/commercial-control/ControlRoomMetric";
import {
  ControlRoomOperationalControl,
  type OperationalControlKey
} from "@/app/components/commercial-control/ControlRoomOperationalControl";
import { ControlRoomSection } from "@/app/components/commercial-control/ControlRoomSection";
import type { CommercialControlOverview } from "@/lib/commercial-control-types";

async function loadCommercialControl(signal: AbortSignal) {
  const response = await fetch("/api/commercial-control", {
    signal,
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel carregar a Sala de Controle.");
  }

  const data = (await response.json()) as { overview: CommercialControlOverview };
  return data.overview;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    NEW: "Nova",
    TYPED: "Digitada",
    ANALYSIS: "Analise",
    PENDING: "Pendente",
    APPROVED: "Aprovada",
    PAID: "Contrato pago",
    CANCELED: "Cancelada",
    REJECTED: "Rejeitada",
    DRAFT: "Rascunho",
    FORMALIZING: "Formalizacao",
    REWORK: "Reanalise",
    SENDING: "Enviando",
    PAUSED: "Pausada",
    COMPLETED: "Concluida",
    FAILED: "Falhou"
  };

  return labels[status] ?? status;
}

function formatGeneratedAt(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function CommercialControlPage({
  onOpenConversation
}: {
  onOpenConversation?: (conversationId: string) => void | Promise<void>;
}) {
  const [overview, setOverview] = useState<CommercialControlOverview | null>(null);
  const [selectedOperationalKey, setSelectedOperationalKey] =
    useState<OperationalControlKey>("forgottenClients");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadOverview = useCallback(() => {
    const controller = new AbortController();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setLoading(true);
    setError(null);

    void loadCommercialControl(controller.signal)
      .then((data) => {
        if (requestRef.current !== requestId) return;
        setOverview(data);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar a Sala de Controle.");
        setOverview(null);
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => loadOverview(), [loadOverview]);

  const hasNoData = useMemo(() => {
    if (!overview) return false;
    return (
      overview.today.activeOrMovedConversations === 0 &&
      overview.today.pendingConversations === 0 &&
      overview.today.proposalsCreated === 0 &&
      overview.today.contractsClosed === 0 &&
      overview.agenda.overdue.total === 0 &&
      overview.agenda.today.total === 0 &&
      overview.agenda.tomorrow.total === 0 &&
      overview.opportunities.total === 0 &&
      overview.campaigns.todayTotal === 0 &&
      overview.pipeline.totalContacts === 0
    );
  }, [overview]);

  const operationalCards = useMemo(() => {
    if (!overview) return [];

    return [
      {
        key: "forgottenClients" as const,
        title: "Clientes esquecidos",
        description: "Conversas pendentes paradas acima do limite operacional.",
        bucket: overview.operationalControl.forgottenClients
      },
      {
        key: "overdueNextActions" as const,
        title: "Proximas acoes vencidas",
        description: "Tarefas operacionais pendentes que ja passaram do prazo.",
        bucket: overview.operationalControl.overdueNextActions
      },
      {
        key: "overdueAppointments" as const,
        title: "Agendamentos vencidos",
        description: "Retornos agendados que ainda nao foram tratados.",
        bucket: overview.operationalControl.overdueAppointments
      },
      {
        key: "riskyNegotiations" as const,
        title: "Negociacoes em risco",
        description: "Propostas ativas com pendencia vencida no contato.",
        bucket: overview.operationalControl.riskyNegotiations
      }
    ];
  }, [overview]);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">Sistema Operacional Comercial</p>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ink">Sala de Controle</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              Visibilidade imediata da operacao com dados confiaveis que ja existem no CRM.
            </p>
            {overview && (
              <p className="mt-2 text-xs font-medium text-slate-400">
                Atualizado em {formatGeneratedAt(overview.generatedAt)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => loadOverview()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </header>

      {loading ? (
        <div className="grid gap-4">
          <div className="h-40 animate-pulse rounded-[1.5rem] bg-slate-100" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-32 animate-pulse rounded-2xl bg-slate-100" />
          </div>
        </div>
      ) : error ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-soft">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">Sala de Controle indisponivel</h2>
              <p className="mt-1 text-sm">{error}</p>
            </div>
          </div>
        </div>
      ) : overview ? (
        <>
          {hasNoData && (
            <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50 p-5 text-emerald-900 shadow-soft">
              <h2 className="font-bold">Operacao sem pendencias visiveis neste momento.</h2>
              <p className="mt-1 text-sm">
                Nao encontramos movimentacoes, tarefas, oportunidades ou campanhas com dados confiaveis para destacar.
              </p>
            </div>
          )}

          <ControlRoomSection
            title="Resumo de hoje"
            description="Leitura rapida do dia usando apenas eventos e registros existentes."
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <ControlRoomMetric
                label="Atendimentos"
                value={overview.today.activeOrMovedConversations}
                description="Conversas criadas, atualizadas ou movimentadas hoje."
                tone="brand"
              />
              <ControlRoomMetric
                label="Pendentes"
                value={overview.today.pendingConversations}
                description="Conversas atualmente marcadas como pendentes."
                tone={overview.today.pendingConversations > 0 ? "attention" : "default"}
              />
              <ControlRoomMetric
                label="Propostas"
                value={overview.today.proposalsCreated}
                description="Propostas criadas hoje."
              />
              <ControlRoomMetric
                label="Contratos"
                value={overview.today.contractsClosed}
                description="Propostas com status pago atualizadas hoje."
                tone="success"
              />
              <ControlRoomMetric
                label="Oportunidades"
                value={overview.today.priorityOpportunities}
                description="Itens acionaveis retornados pela fila inteligente."
                tone="brand"
              />
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Meta e ritmo"
            description="Resposta operacional simples sobre o andamento do dia. Sem previsao sofisticada."
          >
            <ControlRoomGoalPace goalPace={overview.goalPace} />
          </ControlRoomSection>

          <ControlRoomSection
            title="O que precisa de atencao"
            description="Fatos objetivos. Sem diagnostico de IA e sem indicadores estimados."
          >
            <ControlRoomOperationalControl
              cards={operationalCards}
              selectedKey={selectedOperationalKey}
              onSelect={setSelectedOperationalKey}
              onOpenConversation={onOpenConversation}
            />
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <ControlRoomMetric
                label="Tarefas vencidas"
                value={overview.attention.overdueTasks}
                description="Pendencias com prazo anterior a agora."
                tone={overview.attention.overdueTasks > 0 ? "attention" : "default"}
              />
              <ControlRoomMetric
                label="Agenda hoje"
                value={overview.attention.todayTasks}
                description="Tarefas pendentes previstas para hoje."
              />
              <ControlRoomMetric
                label="Fila comercial"
                value={overview.attention.priorityOpportunities}
                description="Oportunidades priorizadas pelo Motor Comercial."
                tone="brand"
              />
              <ControlRoomMetric
                label="Propostas ativas"
                value={overview.attention.activeProposals}
                description="Propostas em status operacional ainda aberto."
              />
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Agenda"
            description="Retornos e tarefas pendentes separados por vencidas, hoje e amanha."
          >
            <div className="grid gap-3 lg:grid-cols-3">
              <ControlRoomAttentionList
                title={`Vencidas (${overview.agenda.overdue.total})`}
                items={overview.agenda.overdue.items}
                emptyMessage="Nenhuma tarefa vencida."
              />
              <ControlRoomAttentionList
                title={`Hoje (${overview.agenda.today.total})`}
                items={overview.agenda.today.items}
                emptyMessage="Nenhuma tarefa para hoje."
              />
              <ControlRoomAttentionList
                title={`Amanha (${overview.agenda.tomorrow.total})`}
                items={overview.agenda.tomorrow.items}
                emptyMessage="Nenhuma tarefa para amanha."
              />
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Oportunidades"
            description="Recorte da Opportunity Queue existente. Nao ha novo score nesta tela."
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="space-y-2">
                {overview.opportunities.items.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-500">
                    Nenhuma oportunidade prioritaria carregada.
                  </p>
                ) : (
                  overview.opportunities.items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div>
                          <p className="font-bold text-ink">{item.contactName}</p>
                          <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                          <p className="mt-2 text-xs font-semibold text-slate-500">
                            {item.productLabel} · {item.ownerName}
                          </p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                          {item.actionLabel}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="rounded-2xl border border-line bg-white p-4">
                <h3 className="text-sm font-bold text-ink">Prioridades carregadas</h3>
                <div className="mt-3 space-y-2">
                  {overview.opportunities.byPriority.length === 0 ? (
                    <p className="text-sm text-slate-500">Sem distribuicao de prioridade.</p>
                  ) : (
                    overview.opportunities.byPriority.map((item) => (
                      <div key={item.priority} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                        <span className="text-sm font-semibold text-slate-600">{item.priority}</span>
                        <span className="text-sm font-black text-brand">{item.count}</span>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-3 text-xs text-slate-400">
                  {overview.opportunities.scanned} conversas candidatas analisadas pela fila.
                </p>
              </div>
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Propostas e contratos"
            description="Status reais das propostas existentes. Contrato do dia usa status pago atualizado hoje."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <ControlRoomMetric label="Criadas hoje" value={overview.proposals.createdToday} description="Propostas registradas hoje." />
              <ControlRoomMetric label="Contratos hoje" value={overview.proposals.contractsToday} description="Status pago atualizado hoje." tone="success" />
              <ControlRoomMetric label="Ativas" value={overview.proposals.activeTotal} description="Propostas em status operacional aberto." />
            </div>
            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {overview.proposals.byStatus.map((item) => (
                <div key={item.status} className="flex items-center justify-between rounded-xl border border-line bg-slate-50 px-3 py-2">
                  <span className="text-sm font-semibold text-slate-600">{statusLabel(item.status)}</span>
                  <span className="font-black text-ink">{item.count}</span>
                </div>
              ))}
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Campanhas"
            description="Volume e status operacional das campanhas recentes."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <ControlRoomMetric label="Movimentadas hoje" value={overview.campaigns.todayTotal} description="Criadas, iniciadas ou finalizadas hoje." />
              <ControlRoomMetric label="Ativas" value={overview.campaigns.activeTotal} description="Campanhas ainda operacionais." />
              <ControlRoomMetric label="Envios hoje" value={overview.campaigns.sentToday} description="Destinatarios enviados hoje." tone="brand" />
            </div>
            <div className="mt-4 grid gap-2">
              {overview.campaigns.items.length === 0 ? (
                <p className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-500">
                  Nenhuma campanha ativa ou movimentada hoje.
                </p>
              ) : (
                overview.campaigns.items.map((campaign) => (
                  <div key={campaign.id} className="grid gap-2 rounded-2xl border border-line bg-slate-50 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div>
                      <p className="font-bold text-ink">{campaign.name}</p>
                      <p className="mt-1 text-xs font-semibold text-slate-500">{statusLabel(campaign.status)}</p>
                    </div>
                    <p className="text-sm text-slate-600">
                      Total {campaign.total} · Enviados {campaign.sent} · Falhas {campaign.failed}
                    </p>
                  </div>
                ))
              )}
            </div>
          </ControlRoomSection>

          <ControlRoomSection
            title="Funil atual"
            description="Distribuicao atual de contatos por etapa do funil. Ainda nao chamamos isso de negociacoes."
          >
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              {overview.pipeline.stages.length === 0 ? (
                <p className="rounded-2xl border border-line bg-slate-50 p-4 text-sm text-slate-500">
                  Nenhuma etapa de funil encontrada.
                </p>
              ) : (
                overview.pipeline.stages.map((stage) => (
                  <div key={stage.id ?? "without-stage"} className="rounded-2xl border border-line bg-slate-50 p-4">
                    <p className="truncate text-sm font-bold text-ink">{stage.name}</p>
                    <p className="mt-2 text-2xl font-black text-brand">{stage.count.toLocaleString("pt-BR")}</p>
                    <p className="mt-1 text-xs font-medium text-slate-500">contatos ativos</p>
                  </div>
                ))
              )}
            </div>
          </ControlRoomSection>
        </>
      ) : null}
    </div>
  );
}
