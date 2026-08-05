import { Target } from "lucide-react";
import {
  buildMissionMessage,
  getMissionCopy
} from "@/app/components/opportunities/opportunity-presentation";
import type { OpportunityGroup } from "@/app/components/opportunities/types";

export function MissionCard({
  groups,
  hasMoreItems,
  visibleCount
}: {
  groups: OpportunityGroup[];
  hasMoreItems: boolean;
  visibleCount: number;
}) {
  const missionCopy = getMissionCopy(hasMoreItems);
  const totalCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  const progress = totalCount > 0 ? Math.round((visibleCount / totalCount) * 100) : 0;

  return (
    <section className="rounded-[1.75rem] border border-line/80 bg-white p-5 shadow-soft md:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <Target className="h-6 w-6" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand">Missão do Dia</p>
            <h2 className="mt-2 max-w-3xl text-2xl font-bold leading-tight text-ink">
              {missionCopy.title}
            </h2>
            <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
              {buildMissionMessage(
                {
                  total: totalCount,
                  respondNow: groups.find((group) => group.key === "respond-now")?.items.length ?? 0,
                  returns: groups.find((group) => group.key === "returns")?.items.length ?? 0,
                  negotiation: groups.find((group) => group.key === "negotiation")?.items.length ?? 0
                },
                hasMoreItems
              )}
            </p>
            {missionCopy.helper && (
              <p className="mt-2 text-sm text-slate-500">{missionCopy.helper}</p>
            )}
          </div>
        </div>

        <div className="min-w-[220px] rounded-2xl border border-line bg-slate-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-slate-700">Progresso da visão</span>
            <span className="font-bold text-ink">{visibleCount}/{totalCount}</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Baseado apenas nas oportunidades exibidas agora.
          </p>
        </div>
      </div>
    </section>
  );
}
