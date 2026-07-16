"use client";

import clsx from "clsx";
import type {
  ConversationFilters,
  ConversationStatus,
  ConversationStatusCounts
} from "./types";

type ConversationStatusTabsProps = {
  filters: ConversationFilters;
  statusCounts: ConversationStatusCounts;
  onFiltersChange: (filters: ConversationFilters) => void;
};

const statusFilterItems: Array<{
  value: ConversationStatus;
  label: string;
}> = [
  { value: "OPEN", label: "Aberto" },
  { value: "PENDING", label: "Pendentes" },
  { value: "BOT", label: "Robo" },
  { value: "RESOLVED", label: "Resolvidos" },
  { value: "SOLD", label: "Vendas" }
];

export function ConversationStatusTabs({
  filters,
  statusCounts,
  onFiltersChange
}: ConversationStatusTabsProps) {
  return (
    <div className="mt-3 flex gap-1 overflow-x-auto rounded-2xl bg-white p-1 text-[11px] shadow-sm ring-1 ring-line/80">
      {statusFilterItems.map(({ value, label }) => {
        const count = statusCounts[value] ?? 0;
        const active = filters.status === value;

        return (
        <button
          key={value}
          className={clsx(
            "inline-flex h-8 min-w-max flex-1 items-center justify-center gap-1.5 rounded-xl px-2 font-bold transition-colors",
            active
              ? "bg-blue-50 text-brand shadow-sm"
              : "text-slate-500 hover:text-slate-800"
          )}
          onClick={() => onFiltersChange({ ...filters, status: value })}
        >
          <span>{label}</span>
          <span
            className={clsx(
              "grid h-4 min-w-4 place-items-center rounded-full px-1 text-[9px] font-black leading-none",
              count > 0
                ? active
                  ? "bg-brand text-white"
                  : "bg-slate-200 text-slate-600"
                : active
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-slate-200 text-slate-400"
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        </button>
        );
      })}
    </div>
  );
}
