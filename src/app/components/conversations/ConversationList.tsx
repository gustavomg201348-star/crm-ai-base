"use client";

import { ConversationCard } from "./ConversationCard";
import { ConversationQuickFilters } from "./ConversationQuickFilters";
import { ConversationSearch } from "./ConversationSearch";
import { ConversationStatusTabs } from "./ConversationStatusTabs";
import { ConversationTagFilter } from "./ConversationTagFilter";
import type {
  AttendantRow,
  ConversationFilters,
  ConversationRow,
  ConversationStatusCounts,
  TagRow
} from "./types";

type ConversationListProps = {
  conversations: ConversationRow[];
  statusCounts: ConversationStatusCounts;
  filters: ConversationFilters;
  availableTags: TagRow[];
  attendants: AttendantRow[];
  isAdmin: boolean;
  loading: boolean;
  selectedConversation: ConversationRow | null;
  onFiltersChange: (filters: ConversationFilters) => void;
  onSearchSettlingChange?: (settling: boolean) => void;
  onSelectConversation: (conversation: ConversationRow) => void;
};

export function ConversationList({
  conversations,
  statusCounts,
  filters,
  availableTags,
  attendants,
  isAdmin,
  loading,
  selectedConversation,
  onFiltersChange,
  onSearchSettlingChange,
  onSelectConversation
}: ConversationListProps) {
  const activeTags = availableTags.filter((tag) => tag.isActive !== false);
  const selectedTagNames = activeTags
    .filter((tag) => filters.tagIds.includes(tag.id))
    .map((tag) => tag.name);
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
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
      <div className="border-b border-line/70 bg-slate-50/35 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-950">Conversas</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{conversations.length} atendimentos</p>
          </div>
          <ConversationTagFilter
            filters={filters}
            activeTags={activeTags}
            onFiltersChange={onFiltersChange}
          />
        </div>
        <ConversationSearch
          filters={filters}
          onFiltersChange={onFiltersChange}
          onSearchSettlingChange={onSearchSettlingChange}
        />
        <ConversationQuickFilters
          filters={filters}
          onFiltersChange={onFiltersChange}
        />
        <ConversationStatusTabs
          filters={filters}
          statusCounts={statusCounts}
          onFiltersChange={onFiltersChange}
        />
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
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain bg-slate-50/35 p-2">
        {conversations.map((item) => (
          <ConversationCard
            key={item.id}
            conversation={item}
            selected={selectedConversation?.id === item.id}
            onSelect={onSelectConversation}
          />
        ))}
        {!loading && conversations.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line bg-white p-6 text-center text-sm text-slate-500">
            Nenhuma conversa nesta fila.
          </div>
        )}
        {loading && (
          <div className="space-y-3 p-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-2xl bg-white shadow-sm ring-1 ring-line/70" />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
