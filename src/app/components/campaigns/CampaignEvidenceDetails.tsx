"use client";
import { useState } from "react";
import type {
  AnalyticsSelection,
  CampaignAnalytics,
} from "./campaign-analytics-types";
const field =
  "h-10 min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-slate-200";
const number = (n: number) => n.toLocaleString("pt-BR");
export function CampaignAnalyticsFilters({
  data,
  selection,
  onChange,
}: {
  data: CampaignAnalytics | null;
  selection: AnalyticsSelection;
  onChange: (next: AnalyticsSelection) => void;
}) {
  const change = (key: keyof AnalyticsSelection, value: string) =>
    onChange({ ...selection, [key]: value, page: 0, groupPage: 0 });
  return (
    <div className="space-y-2 border-b border-slate-800 px-5 py-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <select
          className={field}
          aria-label="Campanha da análise"
          value={selection.campaignId}
          onChange={(e) => change("campaignId", e.target.value)}
        >
          <option value="">Consolidado · Todas as campanhas</option>
          {data?.options.campaigns.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          aria-label="Canal da análise"
          value={selection.channelId}
          onChange={(e) => change("channelId", e.target.value)}
        >
          <option value="">Todos os canais</option>
          {data?.options.channels.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          aria-label="Template da análise"
          value={selection.templateName}
          onChange={(e) => change("templateName", e.target.value)}
        >
          <option value="">Todos os templates</option>
          {data?.options.templates.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select
          className={field}
          aria-label="Status da análise"
          value={selection.status}
          onChange={(e) => change("status", e.target.value)}
        >
          {[
            ["ALL", "Todos os estados"],
            ["SENT", "Enviados · cumulativo"],
            ["DELIVERED", "Entrega Meta confirmada"],
            ["READ", "Leitura oficial Meta"],
            ["PENDING", "Pendentes · estado atual"],
            ["FAILED", "Falhas · estado atual"],
            ["CANCELED", "Cancelados"],
            ["NO_RECEIPT", "Sem recebimento identificado"],
          ].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <select
          className={field}
          aria-label="Interação da análise"
          value={selection.interaction}
          onChange={(e) => change("interaction", e.target.value)}
        >
          {[
            ["ALL", "Todas as interações"],
            ["CLICKED", "Clicaram em botão"],
            ["TEXT_REPLY", "Resposta textual vinculada"],
            ["INTERACTED", "Interação comprovada"],
            ["NO_INTERACTION", "Sem interação comprovada"],
            ["IDENTIFIED", "Leitura identificada"],
            ["ADDITIONAL_READ", "Leitura adicional por interação"],
          ].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <input
          className={field}
          aria-label="Pesquisar cliente na análise"
          placeholder="Pesquisar cliente"
          maxLength={100}
          value={selection.search}
          onChange={(e) => change("search", e.target.value)}
        />
      </div>
      <p className="text-xs text-slate-400">
        {selection.campaignId
          ? "Campanha selecionada"
          : "Consolidado das campanhas filtradas"}{" "}
        · Coorte pela data do envio; leituras e interações acumuladas. Todos os
        filtros também se aplicam à exportação.
      </p>
      {data?.options.truncated && (
        <p className="text-xs text-amber-300">
          Seletores mostram os 100 registros mais recentes. Campanhas também
          podem ser selecionadas no resumo paginado.
        </p>
      )}
    </div>
  );
}
export function CampaignEvidenceDetails({
  data,
  selection,
  onChange,
  params,
}: {
  data: CampaignAnalytics;
  selection: AnalyticsSelection;
  onChange: (next: AnalyticsSelection) => void;
  params: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/campaigns/analytics/export?" + params, {
        cache: "no-store",
      });
      if (!r.ok) {
        const value = await r.json();
        throw Error(
          value.error === "EXPORT_LIMIT"
            ? "A exportação excede 10.000 registros. Reduza o período ou refine os filtros."
            : "Não foi possível exportar a análise.",
        );
      }
      const url = URL.createObjectURL(await r.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = "campaign-analytics-v1.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setBusy(false);
    }
  }
  const page = (delta: number) =>
    onChange({ ...selection, page: selection.page + delta });
  const groups = (delta: number) =>
    onChange({ ...selection, groupPage: selection.groupPage + delta });
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Cliques comprovados · eventos", data.metrics.clickEvents],
          ["Destinatários com resposta textual", data.metrics.textRespondents],
          ["Destinatários que interagiram", data.metrics.interactedRecipients],
          [
            "Interação sem entrega Meta",
            data.metrics.interactionWithoutDelivery,
          ],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4"
          >
            <p className="text-xs text-slate-400">{label}</p>
            <strong className="mt-2 block text-xl text-white">
              {number(Number(value))}
            </strong>
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-slate-400">
        Envios elegíveis: {number(data.metrics.sent)} · Destinatários únicos
        elegíveis: {number(data.metrics.eligibleRecipients)}. Leitura
        identificada = união de leitura oficial e interação comprovada, por
        envio. Taxa de interação = destinatários únicos que clicaram ou
        responderam com contexto ÷ destinatários únicos elegíveis. Entrega,
        leitura e interação são cumulativas e não devem ser somadas como estados
        exclusivos.
      </p>
      {data.metrics.missingSource > 0 && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-200">
          {number(data.metrics.missingSource)} envio(s) sem mensagem de origem
          única. Leituras e interações desses registros não são inferidas.
        </p>
      )}
      <p className="text-xs text-slate-500">
        Textos recebidos sem contexto explícito no período/canal:{" "}
        {data.unattributed.unquotedText === null
          ? "não atribuível a uma campanha selecionada"
          : number(data.unattributed.unquotedText)}
        . Não entram nos indicadores da campanha.
      </p>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55">
        <h3 className="border-b border-slate-800 p-4 text-sm font-bold">
          Desempenho dos botões · campanha, template e canal
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[650px] text-left text-xs">
            <thead className="bg-slate-950/50 text-slate-400">
              <tr>
                {[
                  "Botão real",
                  "Campanha / template",
                  "Canal",
                  "Cliques · eventos",
                  "Destinatários únicos",
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.buttons.map((b, index) => (
                <tr
                  key={[
                    b.campaignId,
                    b.channelId,
                    b.optionId,
                    b.optionTitle,
                    index,
                  ].join(":")}
                >
                  <td className="max-w-60 break-words p-3">
                    {b.optionTitle ?? b.optionId ?? "Botão sem rótulo"}
                  </td>
                  <td className="p-3">
                    {b.campaignName}
                    <span className="block text-slate-500">
                      {b.templateName}
                    </span>
                  </td>
                  <td className="p-3">{b.channelName}</td>
                  <td className="p-3">{number(b.events)}</td>
                  <td className="p-3">{number(b.recipients)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.buttons.length && (
            <p className="p-6 text-center text-xs text-slate-500">
              Nenhum clique comprovado para estes filtros.
            </p>
          )}
        </div>
      </div>
      {(selection.groupPage > 0 ||
        data.pagination.groupsHaveMore ||
        data.pagination.buttonsHaveMore) && (
        <div className="flex items-center justify-end gap-3 text-xs">
          <button
            className={field}
            disabled={selection.groupPage === 0}
            onClick={() => groups(-1)}
          >
            Grupos anteriores
          </button>
          <span>Página {selection.groupPage + 1}</span>
          <button
            className={field}
            disabled={
              !data.pagination.groupsHaveMore &&
              !data.pagination.buttonsHaveMore
            }
            onClick={() => groups(1)}
          >
            Próximos grupos
          </button>
        </div>
      )}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 p-4">
          <h3 className="text-sm font-bold">Acompanhamento por envio</h3>
          <button
            className={field}
            disabled={busy}
            onClick={() => void download()}
          >
            Exportar análise CSV v1
          </button>
        </div>
        {error && (
          <p role="alert" className="p-3 text-xs text-rose-300">
            {error}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-left text-xs">
            <thead className="bg-slate-950/50 text-slate-400">
              <tr>
                {[
                  "Cliente",
                  "Campanha / template / canal",
                  "Estado operacional",
                  "Entrega Meta",
                  "Leitura oficial",
                  "Leitura identificada",
                  "Cliques / textos",
                  "Última interação",
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {data.logs.map((log) => (
                <tr key={log.id}>
                  <td className="p-3">{log.contactName}</td>
                  <td className="p-3">
                    {log.campaignName}
                    <span className="block text-slate-500">
                      {log.templateName} · {log.channelName}
                    </span>
                  </td>
                  <td className="p-3">
                    {log.status}
                    <span className="block text-slate-500">
                      Mensagem: {log.messageStatus ?? "sem vínculo único"}
                    </span>
                  </td>
                  <td className="p-3">
                    {log.deliveredAt
                      ? new Date(log.deliveredAt).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : log.officialRead
                        ? "Comprovada por leitura Meta"
                        : "Sem data de entrega"}
                  </td>
                  <td className="p-3">
                    {log.readAt
                      ? new Date(log.readAt).toLocaleString("pt-BR", {
                          timeZone: "America/Sao_Paulo",
                        })
                      : "Não confirmada"}
                  </td>
                  <td className="p-3">
                    {log.identifiedRead ? "Sim" : "Não"}
                    {log.lastButton && (
                      <span className="block text-sky-300">
                        {log.lastButton}
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {number(log.clickEvents)} / {number(log.textEvents)}
                  </td>
                  <td className="p-3">
                    {log.lastInteractionAt
                      ? new Date(log.lastInteractionAt).toLocaleString(
                          "pt-BR",
                          { timeZone: "America/Sao_Paulo" },
                        )
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.logs.length && (
            <p className="p-6 text-center text-xs text-slate-500">
              Nenhum envio corresponde a estes filtros.
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 p-3 text-xs">
          <button
            className={field}
            disabled={selection.page === 0}
            onClick={() => page(-1)}
          >
            Anteriores
          </button>
          <span>Página {selection.page + 1} · 50 registros</span>
          <button
            className={field}
            disabled={!data.pagination.hasMore}
            onClick={() => page(1)}
          >
            Próximos envios
          </button>
        </div>
      </div>
    </div>
  );
}
