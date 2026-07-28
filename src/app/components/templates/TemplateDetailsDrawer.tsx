"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
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

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-slate-50/70 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

export function TemplateDetailsDrawer({
  template,
  isOpen,
  onClose
}: {
  template: TemplateListItem | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen || !template) return;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isOpen, onClose, template]);

  if (!isOpen || !template) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/30 opacity-100 backdrop-blur-sm transition-opacity"
      onClick={onClose}
    >
      <aside
        aria-labelledby="template-details-title"
        aria-modal="true"
        className="ml-auto flex h-full w-full max-w-xl translate-x-0 flex-col overflow-hidden border-l border-line/80 bg-white shadow-2xl transition-transform"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line/80 p-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Biblioteca de Templates
            </p>
            <h3
              className="mt-1 truncate text-xl font-black text-slate-950"
              id="template-details-title"
            >
              {template.name}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Resumo administrativo. Detalhes completos entram na T8.4B.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            aria-label="Fechar detalhes do template"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-line bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <DetailRow label="Nome" value={template.name} />
            <DetailRow label="Categoria" value={displayValue(template.category, "Sem categoria")} />
            <DetailRow label="Idioma" value={template.language} />
            <DetailRow label="Canal" value={template.channelLabel} />
            <DetailRow label="Status Meta" value={displayValue(template.metaStatus, "Sem status")} />
            <DetailRow label="Status CRM" value={template.operationalStatus} />
            <DetailRow label="Situação" value={template.isActive ? "Ativo" : "Inativo"} />
            <DetailRow label="Criado em" value={formatDate(template.createdAt)} />
            <DetailRow label="Atualizado em" value={formatDate(template.updatedAt)} />
            <DetailRow label="Possui imagem" value={template.hasImage ? "Sim" : "Não"} />
            <DetailRow
              label="Header obrigatório"
              value={template.requiresHeaderMedia ? "Sim" : "Não"}
            />
          </div>
        </div>
      </aside>
    </div>
  );
}
