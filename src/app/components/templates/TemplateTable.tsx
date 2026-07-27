import type { TemplateListItem } from "./types";

export function TemplateTable({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) {
    return (
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <p className="text-sm font-semibold text-slate-700">
          Nenhum resultado para os filtros selecionados.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Ajuste a busca ou limpe os filtros quando a integração estiver ativa.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded border border-line bg-white shadow-soft">
      <div className="hidden grid-cols-[1.5fr_0.8fr_0.8fr_0.9fr_1fr] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-bold uppercase text-slate-500 lg:grid">
        <span>Template</span>
        <span>Categoria</span>
        <span>Idioma</span>
        <span>Status</span>
        <span>Canal</span>
      </div>
      <div className="divide-y divide-line">
        {templates.map((template) => (
          <article
            key={template.id}
            className="grid gap-2 px-4 py-4 text-sm lg:grid-cols-[1.5fr_0.8fr_0.8fr_0.9fr_1fr] lg:items-center lg:gap-3"
          >
            <div>
              <p className="font-bold text-slate-950">{template.name}</p>
              <p className="text-xs text-slate-500">{template.updatedAt}</p>
            </div>
            <p className="text-slate-600">{template.category}</p>
            <p className="text-slate-600">{template.language}</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                {template.metaStatus}
              </span>
              <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                {template.operationalStatus}
              </span>
            </div>
            <p className="text-slate-600">{template.channelLabel}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
