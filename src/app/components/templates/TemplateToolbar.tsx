import { Filter, Plus, RefreshCcw, Search } from "lucide-react";

export function TemplateToolbar() {
  return (
    <section className="rounded border border-line bg-white p-4 shadow-soft">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 xl:flex-1">
          <label className="relative block">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            />
            <input
              className="h-10 w-full rounded-full border border-line bg-slate-50 pl-9 pr-3 text-sm text-slate-500 outline-none"
              disabled
              placeholder="Buscar template"
            />
          </label>
          <select
            aria-label="Canal"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-500 outline-none"
            disabled
          >
            <option>Canal</option>
          </select>
          <select
            aria-label="Categoria"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-500 outline-none"
            disabled
          >
            <option>Categoria</option>
          </select>
          <select
            aria-label="Idioma"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-500 outline-none"
            disabled
          >
            <option>Idioma</option>
          </select>
          <select
            aria-label="Status"
            className="h-10 rounded-full border border-line bg-slate-50 px-3 text-sm text-slate-500 outline-none"
            disabled
          >
            <option>Status</option>
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row xl:shrink-0">
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-500 disabled:opacity-60"
            disabled
            type="button"
          >
            <Filter aria-hidden="true" className="h-4 w-4" />
            Filtros
          </button>
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-line px-4 text-sm font-semibold text-slate-500 disabled:opacity-60"
            disabled
            type="button"
          >
            <RefreshCcw aria-hidden="true" className="h-4 w-4" />
            Sincronizar
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
