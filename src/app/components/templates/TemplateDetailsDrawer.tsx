"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, Loader2, RefreshCcw, X } from "lucide-react";
import type { TemplateButtonContent, TemplateDetail, TemplateListItem } from "./types";

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

function formatBoolean(value: boolean) {
  return value ? "Sim" : "Não";
}

function formatPlaceholder(value: number) {
  return `{{${value}}}`;
}

function safeText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-slate-50/70 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function DetailSection({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line/80 bg-white p-4 shadow-sm">
      <h4 className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">
        {title}
      </h4>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function PlaceholderList({ values }: { values: number[] }) {
  if (values.length === 0) {
    return <p className="text-sm text-slate-500">Sem placeholders.</p>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span
          className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-brand"
          key={value}
        >
          {formatPlaceholder(value)}
        </span>
      ))}
    </div>
  );
}

function StringList({ emptyLabel, values }: { emptyLabel: string; values: string[] }) {
  if (values.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <ul className="list-inside list-disc space-y-1 text-sm text-slate-600">
      {values.map((value, index) => (
        <li className="break-words" key={`${value}-${index}`}>
          {value}
        </li>
      ))}
    </ul>
  );
}

function BodyExamples({ values }: { values: string[][] }) {
  if (values.length === 0) {
    return <p className="text-sm text-slate-500">Sem exemplos disponíveis.</p>;
  }

  return (
    <div className="space-y-2">
      {values.map((row, rowIndex) => (
        <div
          className="rounded-xl border border-line/70 bg-slate-50/70 p-3 text-sm text-slate-600"
          key={`body-example-${rowIndex}`}
        >
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
            Exemplo {rowIndex + 1}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {row.length > 0 ? (
              row.map((value, valueIndex) => (
                <span
                  className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-700"
                  key={`${value}-${valueIndex}`}
                >
                  {formatPlaceholder(valueIndex + 1)} {value}
                </span>
              ))
            ) : (
              <span>Sem valores.</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ButtonDetail({ button, index }: { button: TemplateButtonContent; index: number }) {
  return (
    <div className="rounded-xl border border-line/70 bg-slate-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
          {button.type}
        </span>
        <span className="text-sm font-bold text-slate-900">
          {safeText(button.text, `Botão ${index + 1}`)}
        </span>
      </div>
      {button.url && (
        <p className="mt-2 break-words text-sm text-slate-600">
          URL: {button.url}
          {button.isDynamicUrl ? " · URL dinâmica" : ""}
        </p>
      )}
      {button.phoneNumber && (
        <p className="mt-2 break-words text-sm text-slate-600">
          Telefone: {button.phoneNumber}
        </p>
      )}
      <div className="mt-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          Placeholders
        </p>
        <PlaceholderList values={button.variables} />
      </div>
      <div className="mt-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          Exemplos
        </p>
        <StringList emptyLabel="Sem exemplos disponíveis." values={button.exampleValues} />
      </div>
    </div>
  );
}

export function TemplateDetailsDrawer({
  template,
  detail,
  loading,
  error,
  isOpen,
  onClose,
  onRetry
}: {
  template: TemplateListItem | null;
  detail: TemplateDetail | null;
  loading: boolean;
  error: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const summary = detail ?? template;

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

  if (!isOpen || !template || !summary) return null;

  const header = detail?.content.header ?? null;
  const body = detail?.content.body ?? null;
  const footer = detail?.content.footer ?? null;
  const buttons = detail?.content.buttons ?? [];
  const compatibility = detail?.content.compatibility ?? null;
  const mediaMissing = Boolean(header?.requiresMedia && !summary.hasImage);

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
              {summary.name}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Detalhes administrativos do conteúdo aprovado e salvo localmente.
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

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5">
          <DetailSection title="Resumo">
            <div className="grid gap-3 sm:grid-cols-2">
              <DetailRow label="Nome" value={summary.name} />
              <DetailRow
                label="Categoria"
                value={displayValue(summary.category, "Sem categoria")}
              />
              <DetailRow label="Idioma" value={summary.language} />
              <DetailRow label="Canal" value={summary.channelLabel} />
              <DetailRow
                label="Status Meta"
                value={displayValue(summary.metaStatus, "Sem status")}
              />
              <DetailRow label="Status CRM" value={summary.operationalStatus} />
              <DetailRow label="Situação" value={summary.isActive ? "Ativo" : "Inativo"} />
              <DetailRow label="Criado em" value={formatDate(summary.createdAt)} />
              <DetailRow label="Atualizado em" value={formatDate(summary.updatedAt)} />
              <DetailRow label="Possui imagem" value={formatBoolean(summary.hasImage)} />
              <DetailRow
                label="Header obrigatório"
                value={formatBoolean(summary.requiresHeaderMedia)}
              />
            </div>
          </DetailSection>

          {loading && (
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-brand">
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              Carregando conteúdo completo...
            </div>
          )}

          {error && (
            <section
              className="rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
              role="alert"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle aria-hidden="true" className="h-4 w-4" />
                {error}
              </div>
              <button
                className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-xs font-bold text-rose-700 shadow-sm disabled:opacity-60"
                disabled={loading}
                onClick={onRetry}
                type="button"
              >
                <RefreshCcw aria-hidden="true" className="h-3.5 w-3.5" />
                Tentar novamente
              </button>
            </section>
          )}

          {detail && (
            <>
              <DetailSection title="Header">
                {header?.present ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <DetailRow label="Formato" value={displayValue(header.format, "Sem formato")} />
                      <DetailRow label="Tipo de mídia" value={displayValue(header.mediaType, "Sem mídia")} />
                      <DetailRow label="Exige mídia" value={formatBoolean(header.requiresMedia)} />
                      <DetailRow label="Mídia padrão configurada" value={formatBoolean(summary.hasImage)} />
                    </div>
                    {mediaMissing && (
                      <p className="rounded-xl border border-amber-100 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                        Este header exige mídia, mas a mídia padrão ainda não está configurada.
                      </p>
                    )}
                    <div>
                      <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Texto
                      </p>
                      {header.text.trim() ? (
                        <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                          {header.text}
                        </p>
                      ) : (
                        <p className="text-sm text-slate-500">Header sem texto.</p>
                      )}
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Placeholders
                      </p>
                      <PlaceholderList values={header.variables} />
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                        Exemplos
                      </p>
                      <StringList
                        emptyLabel="Sem exemplos disponíveis."
                        values={header.exampleText}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Header não informado.</p>
                )}
              </DetailSection>

              <DetailSection title="Body">
                {body?.text.trim() ? (
                  <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    {body.text}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">BODY não informado.</p>
                )}
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                    Placeholders
                  </p>
                  <PlaceholderList values={body?.variables ?? []} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                    Exemplos
                  </p>
                  <BodyExamples values={body?.exampleValues ?? []} />
                </div>
              </DetailSection>

              <DetailSection title="Footer">
                {footer?.text.trim() ? (
                  <p className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                    {footer.text}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Footer não informado.</p>
                )}
              </DetailSection>

              <DetailSection title="Buttons">
                {buttons.length > 0 ? (
                  <div className="space-y-3">
                    {buttons.map((button, index) => (
                      <ButtonDetail
                        button={button}
                        index={index}
                        key={`${button.type}-${button.text}-${index}`}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Sem botões.</p>
                )}
              </DetailSection>

              <DetailSection title="Placeholders">
                <p className="text-sm text-slate-600">
                  Total de variáveis:{" "}
                  <span className="font-bold">{detail.content.totalVariables}</span>
                </p>
              </DetailSection>

              {compatibility && (
                <DetailSection title="Compatibilidade">
                  <div className="grid gap-2 text-sm text-slate-600">
                    <span>
                      Compatível com envio atual:{" "}
                      <strong>{formatBoolean(compatibility.canSendWithCurrentBuilder)}</strong>
                    </span>
                    <span>
                      Exige configuração de mídia:{" "}
                      <strong>
                        {formatBoolean(compatibility.requiresHeaderMediaConfiguration)}
                      </strong>
                    </span>
                    <span>
                      Header dinâmico não suportado:{" "}
                      <strong>
                        {formatBoolean(compatibility.hasUnsupportedDynamicHeader)}
                      </strong>
                    </span>
                    <span>
                      Botões dinâmicos não suportados:{" "}
                      <strong>
                        {formatBoolean(compatibility.hasUnsupportedDynamicButtons)}
                      </strong>
                    </span>
                  </div>
                  <StringList
                    emptyLabel="Sem motivos de incompatibilidade."
                    values={compatibility.unsupportedReasons}
                  />
                </DetailSection>
              )}

              {(detail.content.unknownComponents.length > 0 ||
                detail.content.unknownButtonTypes.length > 0) && (
                <DetailSection title="Itens não reconhecidos">
                  <StringList
                    emptyLabel="Sem componentes desconhecidos."
                    values={detail.content.unknownComponents}
                  />
                  <StringList
                    emptyLabel="Sem botões desconhecidos."
                    values={detail.content.unknownButtonTypes}
                  />
                </DetailSection>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
