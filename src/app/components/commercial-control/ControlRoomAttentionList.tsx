import { CalendarClock } from "lucide-react";
import type { CommercialControlTaskItem } from "@/lib/commercial-control-types";

function formatDueAt(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function ControlRoomAttentionList({
  title,
  items,
  emptyMessage
}: {
  title: string;
  items: CommercialControlTaskItem[];
  emptyMessage: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-slate-50 p-4">
      <h3 className="text-sm font-bold text-ink">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyMessage}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-line bg-white p-3">
              <div className="flex items-start gap-2">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{item.title}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.contact.name} · {formatDueAt(item.dueAt)}
                    {item.assignee ? ` · ${item.assignee.name}` : " · Sem responsavel"}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
