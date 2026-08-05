import { ArrowRight, UserRound } from "lucide-react";
import type { OpportunityQueueItem } from "@/app/components/opportunities/types";

function parseDate(value?: string | Date | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatElapsedTime(value?: string | Date | null) {
  const date = parseDate(value);
  if (!date) return "Sem sinal recente";

  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "agora";
  if (diffMinutes < 60) return `há ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `há ${diffHours}h`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `há ${diffDays}d`;

  const diffMonths = Math.floor(diffDays / 30);
  return `há ${diffMonths}m`;
}

function getSignalDate(item: OpportunityQueueItem) {
  return (
    item.lastRelevantInteraction.occurredAt ??
    item.pendingReturn?.dueAt ??
    item.activeProposal?.updatedAt ??
    item.updatedAt
  );
}

export function OpportunityItem({
  item,
  onOpenConversation
}: {
  item: OpportunityQueueItem;
  onOpenConversation: (conversationId: string) => void;
}) {
  return (
    <article className="rounded-2xl border border-line bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Ação recomendada</p>
          <h3 className="mt-1 text-lg font-bold text-ink">{item.primaryAction.title}</h3>
          <p className="mt-1 truncate text-sm font-medium text-slate-500">{item.contact.name}</p>

          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Motivo
              </span>
              <span className="mt-1 block font-medium text-slate-700">{item.queueReason}</span>
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Produto provável
              </span>
              <span className="mt-1 block font-medium text-slate-700">{item.product.label}</span>
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Responsável
              </span>
              <span className="mt-1 flex items-center gap-1.5 font-medium text-slate-700">
                <UserRound className="h-3.5 w-3.5 text-slate-400" />
                {item.owner?.name ?? "Sem responsável"}
              </span>
            </div>
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                Tempo desde o sinal
              </span>
              <span className="mt-1 block font-medium text-slate-700">
                {formatElapsedTime(getSignalDate(item))}
              </span>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenConversation(item.conversationId)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand/90 lg:mt-7"
        >
          Abrir conversa
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
