"use client";

import type {
  AttendantRow,
  ConversationFilters
} from "./types";

type ConversationQueueSelectorProps = {
  filters: ConversationFilters;
  attendants: AttendantRow[];
  selectedTagNames: string[];
  isAdmin: boolean;
  onFiltersChange: (filters: ConversationFilters) => void;
};

export function ConversationQueueSelector({
  filters,
  attendants,
  selectedTagNames,
  isAdmin,
  onFiltersChange
}: ConversationQueueSelectorProps) {
  const queueLabel =
    filters.assignedTo === "me"
      ? "Meus"
      : filters.assignedTo === "unassigned"
        ? "Sem responsavel"
        : filters.assignedTo && !["default", "me", "unassigned"].includes(filters.assignedTo)
          ? attendants.find((attendant) => attendant.id === filters.assignedTo)?.name ?? "Atendente"
          : isAdmin
            ? "Todos"
            : "Minha fila";

  return (
    <div className="mt-3 grid gap-2 text-xs">
      <div className="flex items-center gap-2">
        <select
          className="h-9 min-w-0 flex-1 rounded-full border border-line bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm outline-none hover:border-slate-300 focus:border-blue-200"
          value={filters.assignedTo}
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              assignedTo: event.target.value || "default"
            })
          }
        >
          <option value="default">{isAdmin ? "Fila: Todos" : "Fila: Minha fila"}</option>
          <option value="me">Meus atendimentos</option>
          <option value="unassigned">Sem responsavel</option>
          {isAdmin &&
            attendants.map((attendant) => (
              <option key={attendant.id} value={attendant.id}>
                {attendant.name}
              </option>
            ))}
        </select>
        {filters.tagIds.length > 0 && (
          <button
            className="h-9 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-500 shadow-sm hover:border-slate-300 hover:text-slate-800"
            onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
            type="button"
          >
            Limpar
          </button>
        )}
      </div>
      {(filters.assignedTo !== "default" || selectedTagNames.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
            {queueLabel}
          </span>
          {selectedTagNames.slice(0, 2).map((name) => (
            <span
              key={name}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-brand"
            >
              {name}
            </span>
          ))}
          {selectedTagNames.length > 2 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
              +{selectedTagNames.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
