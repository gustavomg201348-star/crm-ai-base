"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { ConversationCard } from "./ConversationCard";
import type {
  AttendantRow,
  ConversationFilters,
  ConversationRow,
  ConversationStatus,
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

function TagBadge({
  tag,
  compact,
  onRemove
}: {
  tag: {
    id: string;
    name: string;
    color: string;
    textColor?: string | null;
  };
  compact?: boolean;
  onRemove?: () => void;
}) {
  const textColor = tag.textColor || "#ffffff";

  return (
    <span
      className={clsx(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-bold shadow-sm ring-1 ring-black/5",
        compact
          ? "max-w-[8rem] shrink-0 px-2 py-0.5 text-[11px] leading-4"
          : "px-2.5 py-1 text-xs"
      )}
      style={{
        backgroundColor: tag.color,
        borderColor: tag.color,
        color: textColor,
        boxShadow: `0 6px 14px ${tag.color}26`
      }}
      title={tag.name}
    >
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          className="grid h-4 w-4 place-items-center rounded-full bg-white/20 hover:bg-white/30"
          onClick={onRemove}
          type="button"
          title="Remover tag"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

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
  const [tagFilterOpen, setTagFilterOpen] = useState(false);
  const [conversationSearchDraft, setConversationSearchDraft] = useState(filters.search);
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

  useEffect(() => {
    setConversationSearchDraft(filters.search);
  }, [filters.search]);

  useEffect(() => {
    if (conversationSearchDraft === filters.search) {
      onSearchSettlingChange?.(false);
      return;
    }

    onSearchSettlingChange?.(true);

    const timeout = window.setTimeout(() => {
      onFiltersChange({ ...filters, search: conversationSearchDraft });
      onSearchSettlingChange?.(false);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [conversationSearchDraft, filters, onFiltersChange, onSearchSettlingChange]);

  useEffect(() => {
    return () => onSearchSettlingChange?.(false);
  }, [onSearchSettlingChange]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
      <div className="border-b border-line/70 bg-slate-50/35 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-950">Conversas</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{conversations.length} atendimentos</p>
          </div>
          <div className="relative">
            <button
              className={clsx(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-bold shadow-sm transition-colors",
                filters.tagIds.length
                  ? "border-blue-200 bg-blue-50 text-brand"
                  : "border-line bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800"
              )}
              onClick={() => setTagFilterOpen((current) => !current)}
              type="button"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Tags{filters.tagIds.length ? `: ${filters.tagIds.length}` : ""}
            </button>
            {tagFilterOpen && (
              <div className="absolute right-0 top-11 z-20 w-72 rounded-2xl border border-line bg-white p-3 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Filtrar por tag
                  </p>
                  {filters.tagIds.length > 0 && (
                    <button
                      className="text-xs font-bold text-brand"
                      onClick={() => onFiltersChange({ ...filters, tagIds: [] })}
                      type="button"
                    >
                      Limpar
                    </button>
                  )}
                </div>
                <div className="mt-3 flex max-h-56 flex-wrap gap-2 overflow-y-auto pr-1">
                  {activeTags.map((tag) => {
                    const selected = filters.tagIds.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        className={clsx(
                          "rounded-full border p-0.5 transition-colors",
                          selected
                            ? "border-slate-300 bg-slate-50 ring-2 ring-slate-200"
                            : "border-transparent hover:bg-slate-50"
                        )}
                        onClick={() =>
                          onFiltersChange({
                            ...filters,
                            tagIds: selected
                              ? filters.tagIds.filter((tagId) => tagId !== tag.id)
                              : [...filters.tagIds, tag.id]
                          })
                        }
                        type="button"
                      >
                        <TagBadge tag={tag} compact />
                      </button>
                    );
                  })}
                  {activeTags.length === 0 && (
                    <p className="text-sm text-slate-500">Nenhuma tag ativa.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-line bg-white px-3 shadow-sm transition focus-within:border-blue-200 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
            placeholder="Buscar conversas..."
            value={conversationSearchDraft}
            onChange={(event) => setConversationSearchDraft(event.target.value)}
          />
        </div>
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
