"use client";

import { ConversationCard } from "./ConversationCard";
import { ConversationQuickFilters } from "./ConversationQuickFilters";
import { ConversationQueueSelector } from "./ConversationQueueSelector";
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
        <ConversationQueueSelector
          filters={filters}
          attendants={attendants}
          selectedTagNames={selectedTagNames}
          isAdmin={isAdmin}
          onFiltersChange={onFiltersChange}
        />
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
