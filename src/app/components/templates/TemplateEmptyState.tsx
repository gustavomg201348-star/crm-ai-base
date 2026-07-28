import { Library, RefreshCcw } from "lucide-react";

export function TemplateEmptyState({
  hasActiveFilters,
  onClearFilters
}: {
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}) {
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
          : "Quando houver templates sincronizados eles aparecerão aqui."}
      </p>
      <button
        className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white shadow-sm disabled:opacity-60"
        disabled={!hasActiveFilters}
        onClick={onClearFilters}
        type="button"
      >
        <RefreshCcw aria-hidden="true" className="h-4 w-4" />
        {hasActiveFilters ? "Limpar filtros" : "Sincronizar Templates"}
      </button>
    </section>
  );
}
