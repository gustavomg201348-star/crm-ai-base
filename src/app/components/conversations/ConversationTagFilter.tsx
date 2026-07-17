"use client";

import { useState } from "react";
import clsx from "clsx";
import { SlidersHorizontal, X } from "lucide-react";
import type {
  ConversationFilters,
  TagRow
} from "./types";

type ConversationTagFilterProps = {
  filters: ConversationFilters;
  activeTags: TagRow[];
  onFiltersChange: (filters: ConversationFilters) => void;
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

export function ConversationTagFilter({
  filters,
  activeTags,
  onFiltersChange
}: ConversationTagFilterProps) {
  const [tagFilterOpen, setTagFilterOpen] = useState(false);

  return (
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
  );
}
