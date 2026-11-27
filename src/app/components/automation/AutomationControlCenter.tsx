"use client";
import type { AutomationMonitor } from "@/lib/automation-monitor.service";
import {
  action,
  count,
  Fact,
  MonitorHeader,
  MonitorState,
  panel,
  technicalDate,
  useMonitor,
  type Navigate,
} from "./monitor-ui";
export function AutomationControlCenter({
  onNavigate,
  rulesOnly = false,
}: {
  onNavigate: Navigate;
  rulesOnly?: boolean;
}) {
  const { data, loading, error, refresh } = useMonitor<AutomationMonitor>(
    "/api/automations/overview",
  );
  const links = [
    ["inteligencia-artificial", "Inteligência Artificial"],
    ["chatbot", "Chatbot CLT"],
    ["opencredit", "OpenCredit"],
    ["distribuicao-leads", "Distribuição de Leads"],
    ["agenda", "Agenda"],
    ["bancos", "Bancos"],
  ] as const;
  return (
    <section className="space-y-4">
      <MonitorHeader
        title={rulesOnly ? "Regras Automáticas" : "Central de Controle"}
        description="Monitoramento de configurações e evidências persistidas. Habilitado não significa operacional confirmado."
        updatedAt={data?.updatedAt}
        loading={loading}
        onRefresh={refresh}
      />
      <MonitorState error={error} loading={loading} hasData={!!data} />
      {data && (
        <>
          <div className="flex flex-wrap gap-2">
            {links.map(([id, label]) => (
              <button
                key={id}
                className={action}
                onClick={() => onNavigate(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {rulesOnly ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <article className={panel}>
                <h2 className="font-bold">Retorno automático · SEM MARGEM</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Gatilho: aplicação da tag SEM MARGEM. Ação: criar retorno
                  idempotente na Agenda para o contato da mesma empresa. Novas
                  marcações seguem {data.rules.semMargem.schedule}. Backfills
                  históricos podem ter outra data já persistida.
                </p>
                <dl>
                  <Fact
                    label="Regra"
                    value="Definida em código · sem interruptor"
                  />
                  <Fact
                    label="Tag cadastrada"
                    value={data.rules.semMargem.tagPresent ? "Sim" : "Não"}
                  />
                  <Fact
                    label="Retornos pendentes"
                    value={count(data.rules.semMargem.tasks, ["PENDING"])}
                  />
                  <Fact
                    label="Retornos concluídos"
                    value={count(data.rules.semMargem.tasks, ["DONE"])}
                  />
                </dl>
                <button className={action} onClick={() => onNavigate("agenda")}>
                  Ver Agenda e histórico
                </button>
              </article>
              <article className={panel}>
                <h2 className="font-bold">Distribuição automática</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Gatilho: conversa elegível sem responsável. ROUND_ROBIN
                  respeita disponibilidade ONLINE, capacidade e autoridade.
                  CLAIM_FIRST e ADMIN_MANUAL mantêm seus fluxos existentes.
                </p>
                <dl>
                  <Fact
                    label="Modo persistido"
                    value={data.distribution.settings.mode}
                  />
                  <Fact
                    label="Última atribuição registrada"
                    value={technicalDate(
                      data.distribution.metrics.lastAssignmentAt,
                    )}
                  />
                  <Fact
                    label="Disponíveis ONLINE"
                    value={data.distribution.metrics.online}
                  />
                </dl>
                <button
                  className={action}
                  onClick={() => onNavigate("distribuicao-leads")}
                >
                  Gerenciar distribuição
                </button>
              </article>
              <article className={panel}>
                <h2 className="font-bold">Resposta fixa e chatbot</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Conferir/Verificar segue o controle existente por empresa.
                  Chatbot depende também de vínculo e ativação da campanha,
                  contexto autenticado e autoridade. Encaminhamento humano e
                  prevenção de respostas simultâneas permanecem nos motores
                  atuais.
                </p>
                <dl>
                  <Fact
                    label="Resposta fixa efetiva"
                    value={
                      data.ai.fixedReplyEnabled ? "Habilitada" : "Desabilitada"
                    }
                  />
                  <Fact
                    label="Chatbot geral"
                    value={data.chatbot.enabled ? "Habilitado" : "Desabilitado"}
                  />
                </dl>
                <button
                  className={action}
                  onClick={() => onNavigate("chatbot")}
                >
                  Gerenciar Chatbot
                </button>
              </article>
              <article className={panel}>
                <h2 className="font-bold">
                  Agendamentos persistidos · SEM MARGEM
                </h2>
                <p className="mt-2 text-xs text-slate-500">
                  Até 20 pendentes por vencimento, incluindo atrasados.
                  Vencimento não comprova execução de worker.
                </p>
                <ul className="mt-3 space-y-2 text-sm">
                  {data.rules.semMargem.nextTasks.map((t) => (
                    <li key={t.id} className="rounded-xl bg-slate-50 p-3">
                      <span className="font-mono text-xs">{t.id}</span>
                      <span className="block">
                        {technicalDate(t.dueAt)} · {t.status}
                      </span>
                    </li>
                  ))}
                </ul>
                {!data.rules.semMargem.nextTasks.length && (
                  <p className="mt-3 text-sm text-slate-500">
                    Nenhum retorno automático pendente registrado.
                  </p>
                )}
              </article>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <article className={panel}>
                <h2 className="font-bold">Inteligência Artificial</h2>
                <dl>
                  <Fact label="Modo padrão" value={data.ai.mode} />
                  <Fact
                    label="Resposta fixa efetiva"
                    value={
                      data.ai.fixedReplyEnabled ? "Habilitada" : "Desabilitada"
                    }
                  />
                  <Fact
                    label="Origem do controle fixo"
                    value={
                      data.ai.fixedReplyInherited
                        ? "Herança do ambiente"
                        : "Override da empresa"
                    }
                  />
                  <Fact
                    label="Execução recente da IA"
                    value="Desconhecida · sem heartbeat específico"
                  />
                  <Fact
                    label="Operações de saída IA · 7 dias"
                    value={count(data.ai.outbound)}
                  />
                  <Fact
                    label="Operações IA SENT · 7 dias"
                    value={count(data.ai.outbound, ["SENT"])}
                  />
                </dl>
              </article>
              <article className={panel}>
                <h2 className="font-bold">Chatbot CLT</h2>
                <dl>
                  <Fact
                    label="Controle geral"
                    value={data.chatbot.enabled ? "Habilitado" : "Desabilitado"}
                  />
                  <Fact
                    label="Campanhas vinculadas habilitadas"
                    value={data.chatbot.bindings
                      .filter((b) => b.enabled)
                      .reduce((n, b) => n + b._count._all, 0)}
                  />
                  <Fact
                    label="Sessões persistidas"
                    value={count(data.chatbot.sessions)}
                  />
                  <Fact
                    label="Sessões ativas"
                    value={count(data.chatbot.sessions, ["ACTIVE"])}
                  />
                  <Fact
                    label="Eventos pendentes"
                    value={count(data.chatbot.events, [
                      "PENDING",
                      "PROCESSING",
                    ])}
                  />
                  <Fact
                    label="Eventos concluídos"
                    value={count(data.chatbot.events, ["PROCESSED"])}
                  />
                  {data.chatbot.events
                    .filter(
                      (e) =>
                        !["PENDING", "PROCESSING", "PROCESSED"].includes(
                          e.status,
                        ),
                    )
                    .map((e) => (
                      <Fact
                        key={e.status}
                        label={`Evento · ${e.status}`}
                        value={e._count._all}
                      />
                    ))}
                  <Fact
                    label="Worker atual"
                    value="Desconhecido · estados não são heartbeat"
                  />
                </dl>
              </article>
              <article className={panel}>
                <h2 className="font-bold">OpenCredit / Prospecta</h2>
                <dl>
                  <Fact
                    label="Leads recebidos na inbox"
                    value={data.opencredit.inbound.total}
                  />
                  <Fact
                    label="Último recebimento"
                    value={technicalDate(
                      data.opencredit.inbound.lastReceivedAt,
                    )}
                  />
                  <Fact
                    label="Jobs pendentes / retry"
                    value={count(data.opencredit.jobs, ["PENDING", "RETRY"])}
                  />
                  <Fact
                    label="Jobs em COMPLETED"
                    value={count(data.opencredit.jobs, ["COMPLETED"])}
                  />
                  <Fact
                    label="Revisão / retry"
                    value={count(data.opencredit.jobs, [
                      "NEEDS_REVIEW",
                      "RETRY",
                    ])}
                  />
                  <Fact
                    label="Último COMPLETED persistido"
                    value={technicalDate(
                      data.opencredit.jobs.find((j) => j.state === "COMPLETED")
                        ?._max.updatedAt,
                    )}
                  />
                  <Fact
                    label="AutoStart configurado"
                    value={
                      data.opencredit.integrations.some(
                        (i) => i.autoStartConfigured,
                      )
                        ? "Sim, em integração listada"
                        : "Não nas integrações listadas"
                    }
                  />
                </dl>
                {data.opencredit.integrationsTruncated && (
                  <p className="text-xs text-amber-700">
                    Configuração limitada às primeiras 50 integrações.
                  </p>
                )}
              </article>
              <article className={panel}>
                <h2 className="font-bold">Worker de materialização</h2>
                <dl>
                  <Fact
                    label="Flag do runtime"
                    value={
                      data.opencredit.worker.enabled
                        ? "Habilitada"
                        : "Desabilitada"
                    }
                  />
                  <Fact
                    label="Modo validado"
                    value={data.opencredit.worker.mode}
                  />
                  <Fact
                    label="Batch configurado"
                    value={data.opencredit.worker.batchLimit}
                  />
                  <Fact
                    label="Intervalo configurado"
                    value={`${data.opencredit.worker.intervalMs} ms`}
                  />
                  <Fact
                    label="Execução do processo"
                    value="Desconhecida · sem heartbeat persistido"
                  />
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  Jobs concluídos comprovam persistência; não identificam se a
                  origem foi worker ou piloto manual. Não há ativação nesta
                  central.
                </p>
              </article>
              <article className={panel}>
                <h2 className="font-bold">Distribuição e disponibilidade</h2>
                <dl>
                  <Fact label="Modo" value={data.distribution.settings.mode} />
                  <Fact
                    label="ONLINE persistidos"
                    value={data.distribution.metrics.online}
                  />
                  <Fact
                    label="Atendimentos atribuídos"
                    value={data.distribution.metrics.assigned}
                  />
                  <Fact
                    label="Sem responsável"
                    value={data.distribution.metrics.unassigned}
                  />
                  <Fact
                    label="Última atribuição"
                    value={technicalDate(
                      data.distribution.metrics.lastAssignmentAt,
                    )}
                  />
                </dl>
              </article>
              <article className={panel}>
                <h2 className="font-bold">Agendamentos e bancos</h2>
                <dl>
                  <Fact
                    label="SEM MARGEM pendentes"
                    value={count(data.rules.semMargem.tasks, ["PENDING"])}
                  />
                  <Fact
                    label="SEM MARGEM concluídos"
                    value={count(data.rules.semMargem.tasks, ["DONE"])}
                  />
                  <Fact
                    label="Integrações bancárias listadas"
                    value={data.banks.integrations.length}
                  />
                  <Fact
                    label="Falhas CLT registradas · 7 dias"
                    value={count(data.banks.recentLogs, ["ERROR"])}
                  />
                  <Fact
                    label="Disponibilidade bancária atual"
                    value="Desconhecida · nenhuma consulta externa"
                  />
                </dl>
              </article>
            </div>
          )}
          <p className="text-xs leading-5 text-slate-500">
            Totais persistidos por empresa, sem leitura de envelopes ou
            payloads. Ausência de registros não prova falha nem desativação.
            Tags, encaminhamentos e autoridades continuam nos módulos
            existentes; não há construtor genérico, interruptor global ou nova
            ativação nesta página.
          </p>
        </>
      )}
    </section>
  );
}
