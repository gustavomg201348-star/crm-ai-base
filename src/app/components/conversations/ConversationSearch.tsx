"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { ConversationFilters } from "./types";

type ConversationSearchProps = {
  filters: ConversationFilters;
  onFiltersChange: (filters: ConversationFilters) => void;
  onSearchSettlingChange?: (settling: boolean) => void;
};

export function ConversationSearch({
  filters,
  onFiltersChange,
  onSearchSettlingChange
}: ConversationSearchProps) {
  const [conversationSearchDraft, setConversationSearchDraft] = useState(filters.search);

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
    <div className="mt-4 flex h-10 items-center gap-2 rounded-2xl border border-line bg-white px-3 shadow-sm transition focus-within:border-blue-200 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
      <Search className="h-4 w-4 text-slate-400" />
      <input
        className="w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
        placeholder="Buscar conversas..."
        value={conversationSearchDraft}
        onChange={(event) => setConversationSearchDraft(event.target.value)}
      />
    </div>
  );
}
