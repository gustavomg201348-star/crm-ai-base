import { AlertTriangle, CheckCircle2, Filter, Loader2, Plus, RefreshCcw, Search } from "lucide-react";
import type { TemplateChannelOption, TemplateLibraryFilters } from "./types";

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
  syncableChannels,
  selectedSyncChannelId,
  channelsLoading,
  channelsError,
  syncing,
  syncFeedback,
  onFilterChange,
  onClearFilters,
  onRefresh,
  onSelectSyncChannel,
  onSyncTemplates
}: {
  filters: TemplateLibraryFilters;
  loading: boolean;
  hasActiveFilters: boolean;
  syncableChannels: TemplateChannelOption[];
  selectedSyncChannelId: string;
  channelsLoading: boolean;
  channelsError: string | null;
  syncing: boolean;
  syncFeedback: {
    type: "success" | "error";
    message: string;
    warnings?: string[];
  } | null;
  onFilterChange: <K extends keyof TemplateLibraryFilters>(
    field: K,
    value: TemplateLibraryFilters[K]
  ) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  onSelectSyncChannel: (channelId: string) => void;
  onSyncTemplates: () => void;
}) {
  const canSync = syncableChannels.length > 0 && !channelsLoading && !syncing;

  return (
    <section className="space-y-3 rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-bold text-slate-900">Sincronização Meta</p>
          <p className="mt-1 text-xs font-medium text-slate-600">
            Atualize a Biblioteca Local usando os templates aprovados ou pendentes da Meta.
          </p>
          {channelsError && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              {channelsError}
            </p>
          )}
          {!channelsError && !channelsLoading && syncableChannels.length === 0 && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
              <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
              Nenhum canal Meta com WABA e token configurados.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {syncableChannels.length > 1 && (
            <select
              aria-label="Canal para sincronizar templates"
              className="h-10 rounded-full border border-blue-100 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-200 focus:ring-2 focus:ring-blue-100"
              disabled={channelsLoading || syncing}
              onChange={(event) => onSelectSyncChannel(event.target.value)}
              value={selectedSyncChannelId}
            >
              {syncableChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.displayPhone ? `${channel.name} · ${channel.displayPhone}` : channel.name}
                </option>
              ))}
            </select>
          )}
          {syncableChannels.length === 1 && (
            <span className="inline-flex min-h-10 items-center rounded-full bg-white px-3 text-xs font-bold text-slate-600 ring-1 ring-blue-100">
              {syncableChannels[0].displayPhone
                ? `${syncableChannels[0].name} · ${syncableChannels[0].displayPhone}`
                : syncableChannels[0].name}
            </span>
          )}
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSync}
            onClick={onSyncTemplates}
            type="button"
          >
            {syncing ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCcw aria-hidden="true" className="h-4 w-4" />
            )}
            {syncing ? "Sincronizando..." : "Sincronizar Templates"}
          </button>
        </div>
      </div>

      {syncFeedback && (
        <div
          className={`rounded-2xl border px-3 py-2 text-sm font-semibold ${
            syncFeedback.type === "success"
              ? "border-emerald-100 bg-emerald-50 text-emerald-800"
              : "border-rose-100 bg-rose-50 text-rose-800"
          }`}
          role="status"
        >
          <div className="flex items-start gap-2">
            {syncFeedback.type === "success" ? (
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <div>
              <p>{syncFeedback.message}</p>
              {syncFeedback.warnings && syncFeedback.warnings.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs font-medium">
                  {syncFeedback.warnings.slice(0, 3).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

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
