import type { TemplateListItem } from "./types";

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "Data indisponível";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function displayValue(value: string | null, fallback: string) {
  return value?.trim() || fallback;
}

function StatusBadge({ value }: { value: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
      {value}
    </span>
  );
}

export function TemplateTable({ templates }: { templates: TemplateListItem[] }) {
  if (templates.length === 0) {
    return (
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <p className="text-sm font-semibold text-slate-700">
          Nenhum resultado para os filtros selecionados.
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Ajuste a busca ou limpe os filtros para ampliar os resultados.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded border border-line bg-white shadow-soft">
      <div className="overflow-x-auto">
        <div className="hidden min-w-[980px] grid-cols-[1.4fr_0.7fr_0.6fr_1fr_1fr_1fr] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-bold uppercase text-slate-500 lg:grid">
          <span>Template</span>
          <span>Categoria</span>
          <span>Idioma</span>
          <span>Status Meta</span>
          <span>Status CRM</span>
          <span>Canal</span>
        </div>
        <div className="divide-y divide-line">
          {templates.map((template) => (
            <article
              key={template.id}
              className="grid min-w-0 gap-2 px-4 py-4 text-sm lg:min-w-[980px] lg:grid-cols-[1.4fr_0.7fr_0.6fr_1fr_1fr_1fr] lg:items-center lg:gap-3"
            >
              <div>
                <p className="font-bold text-slate-950">{template.name}</p>
                <p className="text-xs text-slate-500">{formatDate(template.updatedAt)}</p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {template.hasImage ? "Com imagem" : "Sem imagem"}
                  {template.requiresHeaderMedia ? " · Mídia obrigatória" : ""}
                </p>
              </div>
              <p className="text-slate-600">{displayValue(template.category, "Sem categoria")}</p>
              <p className="text-slate-600">{template.language}</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={displayValue(template.metaStatus, "Sem status")} />
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge value={template.operationalStatus} />
                {!template.isActive && <StatusBadge value="Inativo" />}
              </div>
              <p className="text-slate-600">{template.channelLabel}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
