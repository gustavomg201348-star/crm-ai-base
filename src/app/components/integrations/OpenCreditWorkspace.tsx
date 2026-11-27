"use client";
import { useState } from "react";
import type { OpenCreditMonitor } from "@/lib/automation-monitor.service";
import { OpenCreditSettingsCard } from "./OpenCreditSettingsCard";
import {
  action,
  count,
  Fact,
  MonitorHeader,
  MonitorState,
  panel,
  technicalDate,
  useMonitor,
} from "../automation/monitor-ui";
export function OpenCreditWorkspace() {
  const [state, setState] = useState("ALL"),
    [page, setPage] = useState(0);
  const [integrationId, setIntegrationId] = useState("");
  const { data, loading, error, refresh } = useMonitor<OpenCreditMonitor>(
    "/api/integrations/opencredit/monitor?" +
      new URLSearchParams({ state, integrationId, page: String(page) }),
  );
  const [tab, setTab] = useState<"overview" | "settings">("overview");
  return (
    <section className="space-y-4">
      <MonitorHeader
        title="OpenCredit / Prospecta"
        description="Inbox passiva, fila e configurações existentes. Consultas de monitoramento não processam leads e não chamam o provider."
        updatedAt={data?.updatedAt}
        loading={loading}
        onRefresh={refresh}
      />
      <div
        role="tablist"
        aria-label="Áreas OpenCredit"
        className="flex flex-wrap gap-2"
      >
        <button
          role="tab"
          aria-selected={tab === "overview"}
          className={action}
          onClick={() => setTab("overview")}
        >
          Visão geral e processamento
        </button>
        <button
          role="tab"
          aria-selected={tab === "settings"}
          className={action}
          onClick={() => setTab("settings")}
        >
          AutoStart e configurações
        </button>
      </div>
      {tab === "settings" ? (
        <OpenCreditSettingsCard />
      ) : (
        <>
          <MonitorState error={error} loading={loading} hasData={!!data} />
          {data && (
            <>
              <div className={panel}>
                <h2 className="font-bold">Integrações e intertravagens</h2>
                <div className="mt-3 grid gap-3 xl:grid-cols-2">
                  {data.integrations.map((i) => (
                    <dl className="rounded-xl border p-3" key={i.id}>
                      <dt className="break-all font-mono text-xs">{i.id}</dt>
                      <Fact
                        label="Legado enabled"
                        value={i.enabled ? "Sim" : "Não"}
                      />
                      <Fact label="Paused" value={i.paused ? "Sim" : "Não"} />
                      <Fact
                        label="Recebimento passivo"
                        value={
                          i.passiveInboundEnabled
                            ? "Habilitado"
                            : "Desabilitado"
                        }
                      />
                      <Fact
                        label="Materialização"
                        value={
                          i.materializationEnabled
                            ? "Habilitada"
                            : "Desabilitada"
                        }
                      />
                      <Fact
                        label="Interlock de materialização"
                        value={i.interlockReady ? "Pronto" : "Bloqueado"}
                      />
                      <Fact
                        label="Binding de provider"
                        value={i.bindingPresent ? "Presente" : "Ausente"}
                      />
                      <Fact
                        label="AutoStart configurado"
                        value={
                          i.autoStartConfigured ? "Habilitado" : "Desabilitado"
                        }
                      />
                    </dl>
                  ))}
                </div>
                {!data.integrations.length && (
                  <p className="mt-3 text-sm text-slate-500">
                    Nenhuma integração OpenCredit cadastrada.
                  </p>
                )}
                {data.integrationsTruncated && (
                  <p className="text-xs text-amber-700">
                    Configurações limitadas às primeiras 50 integrações.
                  </p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                  Gates e AutoStart habilitados não comprovam worker ativo nem
                  envio. A prontidão completa permanece validada pelos controles
                  existentes.
                </p>
              </div>
              <dl className={panel}>
                <Fact
                  label="Inbox passiva · recebimentos persistidos"
                  value={data.inbound.total}
                />
                <Fact
                  label="Último recebimento"
                  value={technicalDate(data.inbound.lastReceivedAt)}
                />
                <Fact label="Jobs de materialização" value={data.total} />
                <Fact
                  label="COMPLETED"
                  value={count(data.counts, ["COMPLETED"])}
                />
                <Fact label="Leads legados (separados)" value={data.legacy} />
                <Fact label="PROCESSING com lease vencida" value={data.stale} />
                <Fact label="Ativos expirados" value={data.expiredActive} />
                <Fact
                  label="Reentregas duplicadas"
                  value="Sem contador histórico confiável"
                />
              </dl>
              <div className={panel}>
                <h2 className="font-bold">Estados reais da fila</h2>
                <label className="my-3 block text-sm">
                  Integração da fila
                  <select
                    className="ml-2 max-w-full rounded-xl border p-2"
                    value={integrationId}
                    onChange={(e) => {
                      setIntegrationId(e.target.value);
                      setPage(0);
                    }}
                  >
                    <option value="">Todas da empresa</option>
                    {data.integrations.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.id}
                      </option>
                    ))}
                  </select>
                </label>
                <dl>
                  {[
                    "PENDING",
                    "RETRY",
                    "PROCESSING",
                    "NEEDS_REVIEW",
                    "COMPLETED",
                    "EXPIRED",
                  ].map((s) => (
                    <Fact key={s} label={s} value={count(data.counts, [s])} />
                  ))}
                </dl>
                <dl>
                  {data.handoffs.map((h) => (
                    <Fact
                      key={h.state}
                      label={`Ponte WhatsApp · ${h.state}`}
                      value={h._count._all}
                    />
                  ))}
                </dl>
                <p className="mt-2 text-xs text-slate-500">
                  Retries e revisão não são classificados automaticamente como
                  falha definitiva. PENDING não significa READY: esta consulta
                  não descriptografa identidades nem avalia readiness. COMPLETED
                  não comprova envio de template. O worker e os gates são
                  independentes.
                </p>
              </div>
              <div className={panel}>
                <h2 className="font-bold">
                  Histórico de jobs · metadados técnicos
                </h2>
                <label className="my-3 block text-sm">
                  Estado do job
                  <select
                    className="ml-3 rounded-xl border p-2"
                    value={state}
                    onChange={(e) => {
                      setState(e.target.value);
                      setPage(0);
                    }}
                  >
                    {[
                      "ALL",
                      "PENDING",
                      "RETRY",
                      "PROCESSING",
                      "NEEDS_REVIEW",
                      "COMPLETED",
                      "EXPIRED",
                    ].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[850px] text-left text-xs">
                    <thead>
                      <tr>
                        {[
                          "Job / evento inbox",
                          "Estado",
                          "Tentativas",
                          "Criado / atualizado",
                          "Disponível / expira",
                          "Diagnóstico técnico",
                        ].map((h) => (
                          <th key={h} className="p-2">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.jobs.map((j) => (
                        <tr key={j.id} className="border-t">
                          <td className="p-2 font-mono">
                            {j.id}
                            <span className="block text-slate-500">
                              {j.inboundEventId}
                            </span>
                          </td>
                          <td className="p-2">{j.state}</td>
                          <td className="p-2">{j.attempts}</td>
                          <td className="p-2">
                            {technicalDate(j.createdAt)}
                            <br />
                            {technicalDate(j.updatedAt)}
                          </td>
                          <td className="p-2">
                            {technicalDate(j.availableAt)}
                            <br />
                            {technicalDate(j.expiresAt)}
                          </td>
                          <td className="p-2">
                            {j.reviewCode ?? j.lastErrorCode ?? "—"}
                            {j.leaseUntil && (
                              <span className="block">
                                Lease até {technicalDate(j.leaseUntil)}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!data.jobs.length && (
                  <p className="py-6 text-center text-sm text-slate-500">
                    Nenhum job para este filtro.
                  </p>
                )}
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    className={action}
                    disabled={!page || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    Anterior
                  </button>
                  <span className="p-2 text-sm">Página {page + 1}</span>
                  <button
                    className={action}
                    disabled={!data.hasMore || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </div>
              <div className={panel}>
                <h2 className="font-bold">Últimos recebimentos · até 20</h2>
                <ul className="mt-3 space-y-2 text-xs">
                  {data.recentInbound.map((e) => (
                    <li key={e.id} className="rounded-xl bg-slate-50 p-3">
                      <span className="break-all font-mono">{e.id}</span> ·{" "}
                      {e.eventType} · {e.processingState} ·{" "}
                      {technicalDate(e.receivedAt)}
                    </li>
                  ))}
                </ul>
                {!data.recentInbound.length && (
                  <p className="mt-3 text-sm text-slate-500">
                    Nenhum recebimento registrado.
                  </p>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Envelopes, payloads, identidades pessoais e leaseToken não são
                consultados. Os controles e exportação existentes estão em
                AutoStart e configurações, com suas permissões originais.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
