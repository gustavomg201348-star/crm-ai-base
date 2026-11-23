"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Eye,
  MousePointerClick,
  RefreshCcw,
  Send,
  TriangleAlert,
  TrendingUp
} from "lucide-react";
import clsx from "clsx";

type Period = "today" | "7d" | "30d";

type CampaignAnalytics = {
  period: Period;
  from: string;
  metrics: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    pending: number;
    clicks: number;
    deliveryRate: number;
    readRate: number;
    clickRateFromRead: number;
    interactionRate: number;
  };
  daily: Array<{
    key: string;
    label: string;
    sent: number;
    delivered: number;
    read: number;
    clicks: number;
  }>;
  campaigns: Array<{
    id: string;
    name: string;
    templateName?: string | null;
    createdAt: string;
    sent: number;
    delivered: number;
    read: number;
    clicks: number;
    failed: number;
    pending: number;
    interactionRate: number;
  }>;
  interactions: Array<{
    id: string;
    campaignId: string;
    contactName: string;
    optionTitle: string;
    createdAt: string;
  }>;
};

function number(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function percent(value: number) {
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}%`;
}

function relativeDate(value: string) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `ha ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `ha ${hours}h`;
  return new Date(value).toLocaleDateString("pt-BR");
}

function Metric({
  label,
  value,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  icon: typeof Send;
  tone: "blue" | "green" | "cyan" | "red" | "amber" | "violet";
}) {
  const styles = {
    blue: "border-blue-400/30 bg-blue-500/10 text-blue-300",
    green: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
    cyan: "border-cyan-400/30 bg-cyan-500/10 text-cyan-300",
    red: "border-rose-400/30 bg-rose-500/10 text-rose-300",
    amber: "border-amber-400/30 bg-amber-500/10 text-amber-300",
    violet: "border-violet-400/30 bg-violet-500/10 text-violet-300"
  }[tone];

  return (
    <div className={clsx("rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", styles)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <strong className="mt-3 block text-2xl font-black tracking-tight text-white">
        {value}
      </strong>
    </div>
  );
}

function FunnelRow({
  label,
  value,
  width,
  rate
}: {
  label: string;
  value: number;
  width: string;
  rate?: number;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="flex h-11 items-center justify-between rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-4 text-sm font-bold text-white shadow-[0_8px_24px_rgba(14,165,233,0.14)]"
        style={{ width }}
      >
        <span>{label}</span>
        <span>{number(value)}</span>
      </div>
      {rate !== undefined ? (
        <span className="w-16 text-right text-xs font-bold text-slate-400">
          {percent(rate)}
        </span>
      ) : null}
    </div>
  );
}

function MiniLineChart({
  points
}: {
  points: CampaignAnalytics["daily"];
}) {
  const width = 620;
  const height = 190;
  const padX = 20;
  const padY = 20;
  const max = Math.max(1, ...points.map((item) => item.sent));
  const coords = points.map((item, index) => {
    const x =
      points.length === 1
        ? width / 2
        : padX + (index / (points.length - 1)) * (width - padX * 2);
    const y = height - padY - (item.sent / max) * (height - padY * 2);
    return { x, y, item };
  });
  const path = coords.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
  ).join(" ");

  return (
    <div>
      <svg className="h-48 w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Desempenho diario dos disparos">
        {[0.25, 0.5, 0.75, 1].map((ratioValue) => {
          const y = height - padY - ratioValue * (height - padY * 2);
          return (
            <line
              key={ratioValue}
              x1={padX}
              x2={width - padX}
              y1={y}
              y2={y}
              stroke="rgba(148,163,184,0.12)"
              strokeWidth="1"
            />
          );
        })}
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((point) => (
          <g key={point.item.key}>
            <circle cx={point.x} cy={point.y} r="5" fill="#0f172a" stroke="#38bdf8" strokeWidth="3" />
          </g>
        ))}
      </svg>
      <div className="grid gap-1 text-center text-[10px] font-semibold text-slate-500" style={{ gridTemplateColumns: `repeat(${Math.max(points.length, 1)}, minmax(0, 1fr))` }}>
        {points.map((item) => (
          <span key={item.key} className="truncate">{item.label}</span>
        ))}
      </div>
    </div>
  );
}

export function CampaignAnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>("7d");
  const [data, setData] = useState<CampaignAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/analytics?period=${period}`, {
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => null)) as
        | CampaignAnalytics
        | { error?: string }
        | null;
      if (!response.ok || !payload || !("metrics" in payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Nao foi possivel carregar o painel."
        );
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar o painel.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(interval);
  }, [load]);

  const maxInteraction = useMemo(
    () => Math.max(100, data?.metrics.interactionRate ?? 0),
    [data?.metrics.interactionRate]
  );
  const gaugeDegrees = ((data?.metrics.interactionRate ?? 0) / maxInteraction) * 360;

  return (
    <section className="mb-5 overflow-hidden rounded-[1.7rem] border border-slate-800 bg-[#07111f] text-white shadow-[0_24px_80px_rgba(2,6,23,0.16)]">
      <div className="border-b border-slate-800/90 bg-gradient-to-r from-slate-950 via-[#081526] to-slate-950 px-5 py-5 lg:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-sky-300">
              <Send className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">Painel de Disparo</h2>
              <p className="mt-1 text-sm text-slate-400">
                Envios, entregas, leituras e interacoes reais com os botoes dos templates.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/80 p-1">
            {([
              ["today", "Hoje"],
              ["7d", "7 dias"],
              ["30d", "30 dias"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={clsx(
                  "h-9 rounded-lg px-3 text-xs font-bold transition",
                  period === value
                    ? "bg-blue-500 text-white shadow-[0_6px_20px_rgba(59,130,246,0.25)]"
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className="ml-1 grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={() => void load()}
              title="Atualizar painel"
            >
              <RefreshCcw className={clsx("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="m-5 rounded-2xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200">
          {error}
        </div>
      ) : (
        <div className="space-y-4 p-5 lg:p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
            <Metric label="Templates enviados" value={number(data?.metrics.sent ?? 0)} icon={Send} tone="blue" />
            <Metric label="Entregues" value={number(data?.metrics.delivered ?? 0)} icon={CheckCircle2} tone="green" />
            <Metric label="Lidos" value={number(data?.metrics.read ?? 0)} icon={Eye} tone="cyan" />
            <Metric label="Falharam" value={number(data?.metrics.failed ?? 0)} icon={TriangleAlert} tone="red" />
            <Metric label="Pendentes" value={number(data?.metrics.pending ?? 0)} icon={Clock3} tone="amber" />
            <Metric label="Clientes que clicaram" value={number(data?.metrics.clicks ?? 0)} icon={MousePointerClick} tone="blue" />
            <Metric label="Taxa de interacao" value={percent(data?.metrics.interactionRate ?? 0)} icon={TrendingUp} tone="violet" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_0.78fr_1.35fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-4 flex items-center gap-2">
                <Activity className="h-4 w-4 text-sky-300" />
                <h3 className="text-sm font-bold">Fluxo do disparo</h3>
              </div>
              <div className="space-y-3">
                <FunnelRow label="Enviados" value={data?.metrics.sent ?? 0} width="100%" />
                <FunnelRow label="Entregues" value={data?.metrics.delivered ?? 0} width="92%" rate={data?.metrics.deliveryRate ?? 0} />
                <FunnelRow label="Lidos" value={data?.metrics.read ?? 0} width="82%" rate={data?.metrics.readRate ?? 0} />
                <FunnelRow label="Clicaram no botao" value={data?.metrics.clicks ?? 0} width="70%" rate={data?.metrics.clickRateFromRead ?? 0} />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-3 flex items-center gap-2">
                <MousePointerClick className="h-4 w-4 text-sky-300" />
                <h3 className="text-sm font-bold">Taxa de interacao</h3>
              </div>
              <div className="grid place-items-center py-2">
                <div
                  className="grid h-44 w-44 place-items-center rounded-full p-4"
                  style={{
                    background: `conic-gradient(#38bdf8 ${gaugeDegrees}deg, rgba(51,65,85,0.7) 0deg)`
                  }}
                >
                  <div className="grid h-full w-full place-items-center rounded-full bg-[#0b1627] text-center">
                    <div>
                      <strong className="block text-3xl font-black">
                        {percent(data?.metrics.interactionRate ?? 0)}
                      </strong>
                      <span className="mt-1 block text-xs text-slate-500">entregues que clicaram</span>
                    </div>
                  </div>
                </div>
                <p className="mt-4 max-w-xs text-center text-xs leading-5 text-slate-400">
                  Interacao = clientes unicos que clicaram em um botao do template dividido pelos templates entregues.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-1 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold">Desempenho diario dos disparos</h3>
                  <p className="mt-1 text-xs text-slate-500">Volume de templates enviados no periodo</p>
                </div>
                <span className="rounded-full border border-slate-700 bg-slate-950/70 px-2.5 py-1 text-[10px] font-bold text-slate-400">
                  {number(data?.metrics.sent ?? 0)} envios
                </span>
              </div>
              <MiniLineChart points={data?.daily ?? []} />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[0.85fr_1.4fr]">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold">Logs de interacao</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">cliques reais</span>
              </div>
              <div className="max-h-64 space-y-1 overflow-auto pr-1">
                {(data?.interactions ?? []).map((interaction) => (
                  <div key={interaction.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-800/70">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-500/10 text-violet-300">
                      <MousePointerClick className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-200">{interaction.contactName}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        Clicou em {interaction.optionTitle}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold text-slate-600">
                      {relativeDate(interaction.createdAt)}
                    </span>
                  </div>
                ))}
                {!loading && !(data?.interactions.length) ? (
                  <div className="rounded-xl border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">
                    Nenhum clique em botao registrado neste periodo.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/55">
              <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                <h3 className="text-sm font-bold">Resumo por campanha</h3>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">templates</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <thead className="bg-slate-950/50 text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Campanha</th>
                      <th className="px-3 py-3 text-right">Enviados</th>
                      <th className="px-3 py-3 text-right">Entregues</th>
                      <th className="px-3 py-3 text-right">Lidos</th>
                      <th className="px-3 py-3 text-right">Cliques</th>
                      <th className="px-4 py-3 text-right">Interacao</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {(data?.campaigns ?? []).map((campaign) => (
                      <tr key={campaign.id} className="hover:bg-slate-800/40">
                        <td className="max-w-[260px] px-4 py-3">
                          <p className="truncate font-bold text-slate-200">{campaign.name}</p>
                          <p className="mt-0.5 truncate text-[10px] text-slate-600">
                            {campaign.templateName || "Template"}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-300">{number(campaign.sent)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-300">{number(campaign.delivered)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-300">{number(campaign.read)}</td>
                        <td className="px-3 py-3 text-right font-semibold text-sky-300">{number(campaign.clicks)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="rounded-full bg-blue-500/10 px-2 py-1 font-bold text-sky-300">
                            {percent(campaign.interactionRate)}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!loading && !(data?.campaigns.length) ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          Nenhuma campanha de template neste periodo.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-sky-400/20 bg-sky-500/5 px-4 py-3 text-xs text-slate-400">
            <strong className="text-sky-300">Interacao:</strong> contabiliza clientes unicos que clicaram em botoes reais de templates enviados pelo CRM.
          </div>
        </div>
      )}
    </section>
  );
}
