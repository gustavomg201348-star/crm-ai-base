"use client";

import clsx from "clsx";
import type { ConversationFilters } from "./types";

type ConversationQuickFiltersProps = {
  filters: ConversationFilters;
  onFiltersChange: (filters: ConversationFilters) => void;
};

export function ConversationQuickFilters({
  filters,
  onFiltersChange
}: ConversationQuickFiltersProps) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-4">
      {[
        {
          label: "Minhas",
          active: filters.assignedTo === "me",
          next: { ...filters, assignedTo: "me" }
        },
        {
          label: "Pendentes",
          active: filters.status === "PENDING",
          next: { ...filters, status: "PENDING" }
        },
        {
          label: "Sem responsavel",
          active: filters.assignedTo === "unassigned",
          next: { ...filters, assignedTo: "unassigned" }
        },
        {
          label: "Todas abertas",
          active: filters.status === "OPEN" && filters.assignedTo === "default",
          next: { ...filters, status: "OPEN", assignedTo: "default" }
        }
      ].map((item) => (
        <button
          key={item.label}
          type="button"
          className={clsx(
            "h-8 rounded-xl border px-2 font-bold shadow-sm transition-colors",
            item.active
              ? "border-blue-200 bg-white text-brand"
              : "border-line bg-white/80 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-800"
          )}
          onClick={() => onFiltersChange(item.next)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
