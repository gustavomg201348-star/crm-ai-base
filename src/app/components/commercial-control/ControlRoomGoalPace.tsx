import { GaugeCircle } from "lucide-react";
import type { CommercialControlGoalPace } from "@/lib/commercial-control-types";

function formatCurrency(value: number | null) {
  if (value === null) return "Nao configurado";

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value === null) return "Nao calculado";
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
}

export function ControlRoomGoalPace({ goalPace }: { goalPace: CommercialControlGoalPace }) {
  const progressPercent = Math.min(Math.max(goalPace.achievedPercent ?? 0, 0), 100);

  return (
    <div className="rounded-[1.5rem] border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.16em] text-blue-700">
            <GaugeCircle className="h-4 w-4" />
            {goalPace.statusLabel}
          </div>
          <h3 className="mt-3 text-xl font-black text-ink">Estamos no caminho certo hoje?</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{goalPace.message}</p>
        </div>

        <div className="grid min-w-full gap-3 sm:grid-cols-3 lg:min-w-[42rem]">
          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Meta do dia</p>
            <p className="mt-2 text-2xl font-black text-ink">{formatCurrency(goalPace.targetAmount)}</p>
          </div>
          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Realizado hoje</p>
            <p className="mt-2 text-2xl font-black text-emerald-700">
              {formatCurrency(goalPace.realizedAmount)}
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Falta hoje</p>
            <p className="mt-2 text-2xl font-black text-amber-700">
              {formatCurrency(goalPace.missingAmount)}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${goalPace.configured ? progressPercent : 0}%` }}
          />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Atingido</p>
            <p className="mt-2 text-lg font-black text-ink">{formatPercent(goalPace.achievedPercent)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              Esperado ate agora
            </p>
            <p className="mt-2 text-lg font-black text-ink">{formatPercent(goalPace.expectedPercent)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Contratos hoje</p>
            <p className="mt-2 text-lg font-black text-ink">
              {goalPace.contractsToday.toLocaleString("pt-BR")}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              Contratos necessarios
            </p>
            <p className="mt-2 text-lg font-black text-ink">
              {goalPace.missingContracts === null
                ? "Nao calculado"
                : goalPace.missingContracts.toLocaleString("pt-BR")}
            </p>
          </div>
        </div>
      </div>

      {goalPace.limitation && (
        <p className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Limite do Bloco C: {goalPace.limitation}
        </p>
      )}
    </div>
  );
}
