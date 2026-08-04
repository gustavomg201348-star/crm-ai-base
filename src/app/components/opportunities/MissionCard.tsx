import {
  CircleEllipsis,
  Clock3,
  Handshake,
  MessageCircleReply,
  PhoneForwarded,
  WalletCards
} from "lucide-react";
import { getMissionCopy } from "@/app/components/opportunities/opportunity-presentation";
import type { OpportunityGroup } from "@/app/components/opportunities/types";

const GROUP_ICONS: Record<OpportunityGroup["key"], typeof MessageCircleReply> = {
  "respond-now": MessageCircleReply,
  returns: Clock3,
  negotiation: WalletCards,
  "waiting-customer": Handshake,
  "follow-up": PhoneForwarded,
  other: CircleEllipsis
};

const GROUP_TONES: Record<OpportunityGroup["key"], string> = {
  "respond-now": "bg-blue-50 text-blue-700",
  returns: "bg-amber-50 text-amber-700",
  negotiation: "bg-violet-50 text-violet-700",
  "waiting-customer": "bg-cyan-50 text-cyan-700",
  "follow-up": "bg-emerald-50 text-emerald-700",
  other: "bg-slate-100 text-slate-700"
};

export function MissionCard({
  groups,
  hasMoreItems
}: {
  groups: OpportunityGroup[];
  hasMoreItems: boolean;
}) {
  const missionCopy = getMissionCopy(hasMoreItems);
  const stats = groups.map((group) => ({
    label: group.title.toLowerCase(),
    value: group.items.length,
    icon: GROUP_ICONS[group.key],
    tone: GROUP_TONES[group.key]
  }));

  return (
    <section className="rounded-[1.75rem] border border-line/80 bg-white p-5 shadow-soft md:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand">Missão do Dia</p>
      <h2 className="mt-2 text-2xl font-bold text-ink md:text-3xl">{missionCopy.title}</h2>
      {missionCopy.helper && (
        <p className="mt-2 text-sm text-slate-500">{missionCopy.helper}</p>
      )}

      <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stats.map((stat) => {
          const Icon = stat.icon;

          return (
            <div key={stat.label} className="rounded-2xl border border-line bg-slate-50/70 p-4">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-3xl font-bold text-ink">{stat.value}</span>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-600">{stat.label}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
