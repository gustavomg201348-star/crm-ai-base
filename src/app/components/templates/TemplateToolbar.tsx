import { Filter, Plus, RefreshCcw, Search } from "lucide-react";
import type { TemplateLibraryFilters } from "./types";

const categoryOptions = ["UTILITY", "MARKETING", "AUTHENTICATION"];
const metaStatusOptions = ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"];
const operationalStatusOptions = [
  "READY",
  "NEEDS_MEDIA",
  "UNSUPPORTED",
  "NOT_RETURNED",
  "SYNC_ERROR"
];

export function TemplateToolbar({
  filters,
  loading,
  hasActiveFilters,
  onFilterChange,
  onClearFilters,
  onRefresh
}: {
  filters: TemplateLibraryFilters;
  loading: boolean;
  hasActiveFilters: boolean;
  onFilterChange: <K extends keyof TemplateLibraryFilters>(
    field: K,
    value: TemplateLibraryFilters[K]
  ) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:flex-1 2xl:grid-cols-6">
          <label className="relative block">
            <span className="sr-only">Buscar template por nome</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              className="h-10 w-full rounded-full border border-line bg-slate-50 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
              onChange={(event) => onFilterChange("q", event.target.value)}
              placeholder="Buscar template"
              type="search"
              value={filters.q}
            />
          </label>
          <select
            aria-label="Categoria"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            onChange={(event) => onFilterChange("category", event.target.value)}
            value={filters.category}
          >
            <option value="">Todas as categorias</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            aria-label="Idioma"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            onChange={(event) => onFilterChange("language", event.target.value)}
            placeholder="Idioma"
            value={filters.language}
          />
          <select
            aria-label="Status Meta"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            onChange={(event) => onFilterChange("metaStatus", event.target.value)}
            value={filters.metaStatus}
          >
            <option value="">Todos os status Meta</option>
            {metaStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            aria-label="Status operacional"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            onChange={(event) => onFilterChange("operationalStatus", event.target.value)}
            value={filters.operationalStatus}
          >
            <option value="">Todos os status CRM</option>
            {operationalStatusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            aria-label="Imagem"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-blue-200 focus:bg-white focus:ring-2 focus:ring-blue-100"
            onChange={(event) =>
              onFilterChange("hasImage", event.target.value as TemplateLibraryFilters["hasImage"])
            }
            value={filters.hasImage}
          >
            <option value="">Todas as mídias</option>
            <option value="true">Com imagem</option>
            <option value="false">Sem imagem</option>
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row xl:shrink-0">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-500 disabled:opacity-60"
            disabled={!hasActiveFilters || loading}
            onClick={onClearFilters}
            type="button"
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            Limpar filtros
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-500 disabled:opacity-60"
            disabled={loading}
            onClick={onRefresh}
            type="button"
          >
            <RefreshCcw aria-hidden="true" className="h-4 w-4" />
            Atualizar
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm disabled:opacity-60"
            disabled
            type="button"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Novo Template
          </button>
        </div>
      </div>
    </section>
  );
}
