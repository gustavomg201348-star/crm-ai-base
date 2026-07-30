"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ImagePlus, Loader2, RefreshCcw, Upload, X } from "lucide-react";
import type {
  TemplateButtonContent,
  TemplateDetail,
  TemplateHeaderImageAssociationResponse,
  TemplateHeaderImageMediaAsset,
  TemplateHeaderImageMediaAssetsResponse,
  TemplateListItem
} from "./types";

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

function formatFileSize(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "Tamanho indisponivel";
  const megabytes = sizeBytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function isTemplateHeaderImageAssociationResponse(
  value: unknown
): value is TemplateHeaderImageAssociationResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateHeaderImageAssociationResponse>;
  return Boolean(
    candidate.template &&
      typeof candidate.template.id === "string" &&
      candidate.mediaAsset &&
      typeof candidate.mediaAsset.id === "string"
  );
}

function isTemplateHeaderImageMediaAssetsResponse(
  value: unknown
): value is TemplateHeaderImageMediaAssetsResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateHeaderImageMediaAssetsResponse>;
  return Array.isArray(candidate.mediaAssets);
}

async function readTemplateActionError(response: Response) {
  const data = (await response.json().catch(() => null)) as
    | {
        error?: unknown;
        message?: unknown;
      }
    | null;

  if (data?.error && typeof data.error === "object" && "message" in data.error) {
    const message = (data.error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }

  if (typeof data?.message === "string") return data.message;
  if (typeof data?.error === "string") return data.error;
  return "Nao foi possivel concluir a operacao. Tente novamente.";
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

function EligibleMediaAssetCard({
  mediaAsset,
  disabled,
  onSelect
}: {
  mediaAsset: TemplateHeaderImageMediaAsset;
  disabled: boolean;
  onSelect: (mediaAsset: TemplateHeaderImageMediaAsset) => void;
}) {
  return (
    <div className="flex gap-3 rounded-2xl border border-line bg-white p-3">
      <div
        aria-label={`Preview de ${mediaAsset.fileName}`}
        className="h-16 w-16 shrink-0 rounded-xl border border-line bg-cover bg-center"
        role="img"
        style={{ backgroundImage: `url("${mediaAsset.publicUrl.replace(/"/g, "%22")}")` }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-800">{mediaAsset.fileName}</p>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {mediaAsset.mimeType} · {formatFileSize(mediaAsset.sizeBytes)}
        </p>
        <button
          className="mt-2 inline-flex h-8 items-center justify-center rounded-full bg-brand px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={() => onSelect(mediaAsset)}
          type="button"
        >
          Usar esta imagem
        </button>
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
  onRetry,
  onMediaAssociated
}: {
  template: TemplateListItem | null;
  detail: TemplateDetail | null;
  loading: boolean;
  error: string | null;
  isOpen: boolean;
  onClose: () => void;
  onRetry: () => void;
  onMediaAssociated: (result: TemplateHeaderImageAssociationResponse) => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const summary = detail ?? template;
  const [associationOpen, setAssociationOpen] = useState(false);
  const [eligibleMediaAssets, setEligibleMediaAssets] = useState<TemplateHeaderImageMediaAsset[]>([]);
  const [eligibleMediaLoading, setEligibleMediaLoading] = useState(false);
  const [associationError, setAssociationError] = useState<string | null>(null);
  const [associationSuccess, setAssociationSuccess] = useState<string | null>(null);
  const [associating, setAssociating] = useState(false);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [selectedUploadPreviewUrl, setSelectedUploadPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const header = detail?.content.header ?? null;
  const canAssociateHeaderImage = Boolean(
    summary &&
      header?.format === "IMAGE" &&
      header.requiresMedia &&
      summary.operationalStatus === "NEEDS_MEDIA" &&
      !summary.hasImage
  );
  const selectedUploadFileLabel = useMemo(
    () =>
      selectedUploadFile
        ? `${selectedUploadFile.name} · ${formatFileSize(selectedUploadFile.size)}`
        : "Nenhum arquivo selecionado.",
    [selectedUploadFile]
  );

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

  useEffect(() => {
    if (!isOpen || canAssociateHeaderImage) return;

    setAssociationOpen(false);
    setAssociationError(null);
    setAssociationSuccess(null);
    setSelectedUploadFile(null);
  }, [canAssociateHeaderImage, isOpen]);

  useEffect(() => {
    if (!selectedUploadFile || !selectedUploadFile.type.startsWith("image/")) {
      setSelectedUploadPreviewUrl(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selectedUploadFile);
    setSelectedUploadPreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [selectedUploadFile]);

  const loadEligibleMediaAssets = useCallback(async () => {
    if (!summary) return;

    setEligibleMediaLoading(true);
    setAssociationError(null);

    try {
      const response = await fetch(
        `/api/templates/${encodeURIComponent(summary.id)}/media-assets`,
        {
          credentials: "same-origin"
        }
      );

      if (!response.ok) {
        throw new Error(await readTemplateActionError(response));
      }

      const data = (await response.json()) as unknown;
      if (!isTemplateHeaderImageMediaAssetsResponse(data)) {
        throw new Error("Nao foi possivel carregar imagens elegiveis.");
      }

      setEligibleMediaAssets(data.mediaAssets);
    } catch (loadError) {
      setAssociationError(
        loadError instanceof Error
          ? loadError.message
          : "Nao foi possivel carregar imagens elegiveis."
      );
    } finally {
      setEligibleMediaLoading(false);
    }
  }, [summary]);

  const openAssociation = useCallback(() => {
    setAssociationOpen(true);
    setAssociationSuccess(null);
    setAssociationError(null);
    setSelectedUploadFile(null);
    void loadEligibleMediaAssets();
  }, [loadEligibleMediaAssets]);

  const completeAssociation = useCallback(
    (result: TemplateHeaderImageAssociationResponse) => {
      setAssociationSuccess("Imagem associada com sucesso.");
      setAssociationError(null);
      setAssociationOpen(false);
      setSelectedUploadFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onMediaAssociated(result);
    },
    [onMediaAssociated]
  );

  const associateExistingMediaAsset = useCallback(
    async (mediaAsset: TemplateHeaderImageMediaAsset) => {
      if (!summary || associating) return;

      setAssociating(true);
      setAssociationError(null);
      setAssociationSuccess(null);

      try {
        const response = await fetch(
          `/api/templates/${encodeURIComponent(summary.id)}/associate-media`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mediaAssetId: mediaAsset.id })
          }
        );

        if (!response.ok) {
          throw new Error(await readTemplateActionError(response));
        }

        const data = (await response.json()) as unknown;
        if (!isTemplateHeaderImageAssociationResponse(data)) {
          throw new Error("A associacao retornou uma resposta inesperada.");
        }

        completeAssociation(data);
      } catch (associateError) {
        setAssociationError(
          associateError instanceof Error
            ? associateError.message
            : "Nao foi possivel associar a imagem."
        );
      } finally {
        setAssociating(false);
      }
    },
    [associating, completeAssociation, summary]
  );

  const uploadAndAssociateMedia = useCallback(async () => {
    if (!summary || !selectedUploadFile || associating) return;

    setAssociating(true);
    setAssociationError(null);
    setAssociationSuccess(null);

    try {
      const formData = new FormData();
      formData.append("media", selectedUploadFile);

      const response = await fetch(
        `/api/templates/${encodeURIComponent(summary.id)}/header-media`,
        {
          method: "POST",
          credentials: "same-origin",
          body: formData
        }
      );

      if (!response.ok) {
        throw new Error(await readTemplateActionError(response));
      }

      const data = (await response.json()) as unknown;
      if (!isTemplateHeaderImageAssociationResponse(data)) {
        throw new Error("O upload retornou uma resposta inesperada.");
      }

      completeAssociation(data);
    } catch (uploadError) {
      setAssociationError(
        uploadError instanceof Error
          ? uploadError.message
          : "Nao foi possivel enviar a imagem."
      );
    } finally {
      setAssociating(false);
    }
  }, [associating, completeAssociation, selectedUploadFile, summary]);

  if (!isOpen || !template || !summary) return null;

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
                    {canAssociateHeaderImage && (
                      <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="inline-flex items-center gap-2 text-sm font-black text-amber-900">
                              <ImagePlus aria-hidden="true" className="h-4 w-4" />
                              Midia pendente
                            </p>
                            <p className="mt-1 text-sm font-semibold text-amber-800">
                              Associe uma imagem uma unica vez para liberar este template em
                              campanhas e conversas.
                            </p>
                          </div>
                          <button
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-brand px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={eligibleMediaLoading || associating}
                            onClick={openAssociation}
                            type="button"
                          >
                            {eligibleMediaLoading ? (
                              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ImagePlus aria-hidden="true" className="h-3.5 w-3.5" />
                            )}
                            Associar imagem
                          </button>
                        </div>

                        {associationOpen && (
                          <div className="mt-4 space-y-4 rounded-2xl border border-amber-100 bg-white p-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-black text-slate-900">
                                  Escolha uma imagem
                                </p>
                                <p className="mt-1 text-xs font-semibold text-slate-500">
                                  Use uma imagem ja cadastrada ou envie uma nova imagem PNG/JPEG.
                                </p>
                              </div>
                              <button
                                aria-label="Fechar associacao de imagem"
                                className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line text-slate-500"
                                disabled={associating}
                                onClick={() => setAssociationOpen(false)}
                                type="button"
                              >
                                <X aria-hidden="true" className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {associationError && (
                              <div
                                className="rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm font-semibold text-rose-700"
                                role="alert"
                              >
                                {associationError}
                              </div>
                            )}

                            {eligibleMediaLoading && (
                              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-brand">
                                <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                                Carregando imagens elegiveis...
                              </div>
                            )}

                            {!eligibleMediaLoading && eligibleMediaAssets.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                                  Imagens existentes
                                </p>
                                <div className="grid gap-2">
                                  {eligibleMediaAssets.map((mediaAsset) => (
                                    <EligibleMediaAssetCard
                                      disabled={associating}
                                      key={mediaAsset.id}
                                      mediaAsset={mediaAsset}
                                      onSelect={associateExistingMediaAsset}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}

                            {!eligibleMediaLoading && eligibleMediaAssets.length === 0 && (
                              <p className="rounded-xl bg-slate-50 p-3 text-sm font-semibold text-slate-600">
                                Nenhuma imagem elegivel encontrada. Envie a imagem correta abaixo.
                              </p>
                            )}

                            <div className="space-y-3 rounded-2xl border border-line bg-slate-50 p-3">
                              <div>
                                <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
                                  Enviar nova imagem
                                </p>
                                <p className="mt-1 text-sm font-semibold text-slate-600">
                                  {selectedUploadFileLabel}
                                </p>
                              </div>
                              <input
                                ref={fileInputRef}
                                accept="image/jpeg,image/png"
                                className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-2 file:text-xs file:font-bold file:text-brand"
                                disabled={associating}
                                onChange={(event) =>
                                  setSelectedUploadFile(event.target.files?.[0] ?? null)
                                }
                                type="file"
                              />
                              {selectedUploadPreviewUrl && (
                                <div
                                  aria-label={`Preview de ${selectedUploadFile?.name ?? "imagem selecionada"}`}
                                  className="h-32 w-full rounded-2xl border border-line bg-slate-100 bg-cover bg-center"
                                  role="img"
                                  style={{
                                    backgroundImage: `url("${selectedUploadPreviewUrl.replaceAll('"', "%22")}")`
                                  }}
                                />
                              )}
                              <button
                                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-brand px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={!selectedUploadFile || associating}
                                onClick={uploadAndAssociateMedia}
                                type="button"
                              >
                                {associating ? (
                                  <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                                )}
                                Enviar e associar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {associationSuccess && (
                      <p className="inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">
                        <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                        {associationSuccess}
                      </p>
                    )}
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
