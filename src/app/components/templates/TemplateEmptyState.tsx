import { Library, Plus, RefreshCcw } from "lucide-react";

export function TemplateEmptyState({
  hasActiveFilters,
  onClearFilters,
  onCreateTemplate,
  onSyncTemplates,
  syncDisabled,
  syncing
}: {
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
  onCreateTemplate?: () => void;
  onSyncTemplates?: () => void;
  syncDisabled?: boolean;
  syncing?: boolean;
}) {
  const buttonDisabled = hasActiveFilters ? !onClearFilters : syncDisabled || syncing || !onSyncTemplates;

  return (
    <section className="rounded border border-dashed border-line bg-white p-8 text-center shadow-soft">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-brand">
        <Library aria-hidden="true" className="h-7 w-7" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-950">
        {hasActiveFilters
          ? "Nenhum template corresponde aos filtros selecionados"
          : "Nenhum template encontrado"}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        {hasActiveFilters
          ? "Ajuste a busca ou limpe os filtros para ampliar os resultados."
          : "Crie um novo template ou atualize para buscar os templates já cadastrados."}
      </p>
      <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {!hasActiveFilters && (
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm disabled:opacity-60"
            disabled={!onCreateTemplate}
            onClick={onCreateTemplate}
            type="button"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Novo Template
          </button>
        )}
        <button
          className={`inline-flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold shadow-sm disabled:opacity-60 ${
            hasActiveFilters
              ? "bg-brand text-white"
              : "border border-line bg-white text-slate-600"
          }`}
          disabled={buttonDisabled}
          onClick={hasActiveFilters ? onClearFilters : onSyncTemplates}
          type="button"
        >
          <RefreshCcw aria-hidden="true" className="h-4 w-4" />
          {hasActiveFilters ? "Limpar filtros" : syncing ? "Atualizando..." : "Atualizar"}
        </button>
      </div>
    </section>
  );
}
