import type { OpportunityGroup as OpportunityGroupType } from "@/app/components/opportunities/types";
import { OpportunityItem } from "@/app/components/opportunities/OpportunityItem";

export function OpportunityGroup({
  group,
  onOpenConversation
}: {
  group: OpportunityGroupType;
  onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <section className="rounded-[1.5rem] border border-line/80 bg-white p-4 shadow-soft md:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{group.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{group.description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          {group.items.length}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {group.items.map((item) => (
          <OpportunityItem
            key={item.id}
            item={item}
            onOpenConversation={onOpenConversation}
          />
        ))}
      </div>
    </section>
  );
}
