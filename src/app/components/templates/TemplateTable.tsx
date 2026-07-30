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

function displayCategory(value: string | null) {
  if (value === "UTILITY") return "Utilidade";
  if (value === "MARKETING") return "Marketing";
  if (value === "AUTHENTICATION") return "Autenticação";
  return displayValue(value, "Sem categoria");
}

function displayHeaderFormat(value: string | null) {
  if (value === "NONE" || value === null) return "Sem cabeçalho";
  if (value === "TEXT") return "Texto";
  if (value === "IMAGE") return "Imagem";
  if (value === "DOCUMENT") return "Documento";
  if (value === "VIDEO") return "Vídeo";
  return value;
}

function resolveTemplateStatus(template: TemplateListItem) {
  if (!template.isActive) {
    return {
      label: "Indisponível",
      description: "Template inativo na biblioteca.",
      tone: "slate" as const
    };
  }

  if (template.operationalStatus === "NEEDS_MEDIA") {
    return {
      label: "Precisa de imagem",
      description: "Associe a imagem padrão para usar este template.",
      tone: "amber" as const
    };
  }

  if (template.metaStatus === "REJECTED") {
    return {
      label: "Rejeitado",
      description: "Revise o conteúdo antes de criar uma nova versão.",
      tone: "rose" as const
    };
  }

  if (template.metaStatus === "PENDING" || template.metaStatus === "IN_REVIEW") {
    return {
      label: "Aguardando aprovação",
      description: "Use Atualizar para acompanhar a aprovação.",
      tone: "blue" as const
    };
  }

  if (template.operationalStatus === "READY") {
    return {
      label: "Pronto",
      description: "Disponível para campanhas e conversas.",
      tone: "emerald" as const
    };
  }

  if (template.operationalStatus === "SYNC_ERROR") {
    return {
      label: "Erro de sincronização",
      description: "Tente atualizar a biblioteca novamente.",
      tone: "rose" as const
    };
  }

  return {
    label: "Indisponível",
    description: "Ainda não está pronto para envio.",
    tone: "slate" as const
  };
}

function StatusBadge({
  value,
  tone
}: {
  value: string;
  tone: "amber" | "blue" | "emerald" | "rose" | "slate";
}) {
  const className =
    tone === "emerald"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : tone === "rose"
          ? "bg-rose-50 text-rose-700"
          : tone === "blue"
            ? "bg-blue-50 text-brand"
            : "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full px-2 py-1 text-xs font-bold ${className}`}>
      {value}
    </span>
  );
}

export function TemplateTable({
  templates,
  selectedTemplateId,
  onSelectTemplate
}: {
  templates: TemplateListItem[];
  selectedTemplateId: string | null;
  onSelectTemplate: (template: TemplateListItem) => void;
}) {
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
        <div className="hidden min-w-[960px] grid-cols-[1.5fr_0.8fr_0.7fr_1.2fr_0.9fr_0.7fr] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-bold uppercase text-slate-500 lg:grid">
          <span>Template</span>
          <span>Categoria</span>
          <span>Tipo</span>
          <span>Status</span>
          <span>Atualizado</span>
          <span>Ações</span>
        </div>
        <div className="divide-y divide-line">
          {templates.map((template) => {
            const status = resolveTemplateStatus(template);

            return (
              <article
                key={template.id}
                className="grid min-w-0 gap-3 px-4 py-4 text-sm lg:min-w-[960px] lg:grid-cols-[1.5fr_0.8fr_0.7fr_1.2fr_0.9fr_0.7fr] lg:items-center lg:gap-3"
              >
                <div>
                  <p className="font-bold text-slate-950">{template.name}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {template.language} · {template.channelLabel}
                  </p>
                </div>
                <p className="text-slate-600">{displayCategory(template.category)}</p>
                <p className="text-slate-600">{displayHeaderFormat(template.headerFormat)}</p>
                <div>
                  <StatusBadge tone={status.tone} value={status.label} />
                  <p className="mt-1 text-xs text-slate-500">{status.description}</p>
                </div>
                <p className="text-slate-600">{formatDate(template.updatedAt)}</p>
                <div>
                  <button
                    aria-label={`Ver detalhes do template ${template.name}`}
                    className={`inline-flex h-9 items-center justify-center rounded-full border px-3 text-xs font-bold transition hover:border-blue-200 hover:bg-blue-50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100 ${
                      selectedTemplateId === template.id
                        ? "border-blue-200 bg-blue-50 text-brand"
                        : "border-line text-slate-600"
                    }`}
                    onClick={() => onSelectTemplate(template)}
                    type="button"
                  >
                  {template.isActive && template.operationalStatus === "NEEDS_MEDIA"
                      ? "Associar imagem"
                      : "Ver detalhes"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
