"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Library, Loader2 } from "lucide-react";
import { TemplateCreatePanel } from "./TemplateCreatePanel";
import { TemplateDetailsDrawer } from "./TemplateDetailsDrawer";
import { TemplateEmptyState } from "./TemplateEmptyState";
import { TemplateLoading } from "./TemplateLoading";
import { TemplateTable } from "./TemplateTable";
import { TemplateToolbar } from "./TemplateToolbar";
import type {
  TemplateChannelOption,
  TemplateChannelsResponse,
  TemplateDetail,
  TemplateDetailResponse,
  TemplateHeaderImageAssociationResponse,
  TemplateLibraryFilters,
  TemplateListItem,
  TemplateListResponse,
  TemplateListSummary,
  TemplatePagination,
  TemplateSyncResult
} from "./types";

const initialFilters: TemplateLibraryFilters = {
  q: "",
  category: "",
  language: "",
  metaStatus: "",
  operationalStatus: "",
  headerFormat: "",
  hasImage: ""
};

const initialPagination: TemplatePagination = {
  page: 1,
  pageSize: 25,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false
};

const initialSummary: TemplateListSummary = {
  total: 0,
  ready: 0,
  waiting: 0,
  pending: 0,
  needsMedia: 0,
  rejected: 0
};

function isTemplateListResponse(value: unknown): value is TemplateListResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateListResponse>;
  return (
    Array.isArray(candidate.templates) &&
    Boolean(candidate.pagination) &&
    Boolean(candidate.summary)
  );
}

function isTemplateDetailResponse(value: unknown): value is TemplateDetailResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateDetailResponse>;
  return Boolean(candidate.template && typeof candidate.template.id === "string");
}

function isTemplateChannelsResponse(value: unknown): value is TemplateChannelsResponse {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateChannelsResponse>;
  return Array.isArray(candidate.channels);
}

function isTemplateSyncResult(value: unknown): value is TemplateSyncResult {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<TemplateSyncResult>;
  return (
    typeof candidate.complete === "boolean" &&
    typeof candidate.totalFetched === "number" &&
    typeof candidate.created === "number" &&
    typeof candidate.updated === "number"
  );
}

async function readTemplateError(response: Response) {
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string"
    ? data.error
    : "Nao foi possivel carregar os templates. Tente novamente.";
}

function hasFilters(filters: TemplateLibraryFilters) {
  return Object.values(filters).some((value) => value.trim() !== "");
}

function isSyncableMetaChannel(channel: TemplateChannelOption) {
  return (
    channel.type === "whatsapp" &&
    channel.provider === "meta" &&
    Boolean(channel.wabaId) &&
    channel.hasAccessToken
  );
}

function formatSyncSummary(result: TemplateSyncResult) {
  const base = `Sincronização concluída. ${result.totalFetched} templates encontrados, ${result.created} criados e ${result.updated} atualizados.`;
  const extras = [
    result.reactivated > 0 ? `${result.reactivated} reativados` : null,
    result.markedNotReturned > 0 ? `${result.markedNotReturned} marcados como não retornados` : null,
    result.skipped > 0 ? `${result.skipped} ignorados` : null,
    result.failed > 0 ? `${result.failed} falharam` : null
  ].filter(Boolean);
  const status = result.complete ? "" : " Sincronização incompleta.";

  return extras.length > 0 ? `${base} ${extras.join(", ")}.${status}` : `${base}${status}`;
}

export function TemplateLibraryPage() {
  const [templates, setTemplates] = useState<TemplateListItem[]>([]);
  const [pagination, setPagination] = useState<TemplatePagination>(initialPagination);
  const [summary, setSummary] = useState<TemplateListSummary>(initialSummary);
  const [filters, setFilters] = useState<TemplateLibraryFilters>(initialFilters);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateListItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [templateDetails, setTemplateDetails] = useState<TemplateDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsRefreshKey, setDetailsRefreshKey] = useState(0);
  const [channels, setChannels] = useState<TemplateChannelOption[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [selectedSyncChannelId, setSelectedSyncChannelId] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState<{
    type: "success" | "error";
    message: string;
    warnings?: string[];
  } | null>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const listRequestIdRef = useRef(0);
  const syncInFlightRef = useRef(false);

  const activeFilters = useMemo(
    () => ({
      q: appliedQuery,
      category: filters.category,
      language: filters.language,
      metaStatus: filters.metaStatus,
      operationalStatus: filters.operationalStatus,
      headerFormat: filters.headerFormat,
      hasImage: filters.hasImage
    }),
    [
      appliedQuery,
      filters.category,
      filters.language,
      filters.metaStatus,
      filters.operationalStatus,
      filters.headerFormat,
      filters.hasImage
    ]
  );
  const hasActiveFilters = hasFilters(activeFilters);
  const syncableChannels = useMemo(
    () => channels.filter(isSyncableMetaChannel),
    [channels]
  );
  const selectedSyncChannel = useMemo(() => {
    if (syncableChannels.length === 0) return null;
    return (
      syncableChannels.find((channel) => channel.id === selectedSyncChannelId) ??
      syncableChannels[0]
    );
  }, [selectedSyncChannelId, syncableChannels]);
  const selectedTemplateChannelId = selectedSyncChannel?.id ?? "";
  useEffect(() => {
    const controller = new AbortController();

    async function loadChannels() {
      setChannelsLoading(true);
      setChannelsError(null);

      try {
        const response = await fetch("/api/channels", {
          credentials: "same-origin",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(await readTemplateError(response));
        }

        const data = (await response.json()) as unknown;
        if (!isTemplateChannelsResponse(data)) {
          throw new Error("Nao foi possivel carregar os canais Meta.");
        }

        if (controller.signal.aborted) return;

        setChannels(data.channels);
        const syncable = data.channels.filter(isSyncableMetaChannel);
        setSelectedSyncChannelId((current) =>
          current && syncable.some((channel) => channel.id === current)
            ? current
            : syncable[0]?.id ?? ""
        );
      } catch (loadError) {
        if (controller.signal.aborted) return;

        setChannelsError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar os canais Meta."
        );
      } finally {
        if (!controller.signal.aborted) setChannelsLoading(false);
      }
    }

    void loadChannels();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setAppliedQuery(filters.q.trim());
      setPage(1);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [filters.q]);

  useEffect(() => {
    if (channelsLoading) {
      setLoading(true);
      return;
    }

    if (!selectedTemplateChannelId) {
      setTemplates([]);
      setPagination(initialPagination);
      setSummary(initialSummary);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    const params = new URLSearchParams({
      channelId: selectedTemplateChannelId,
      page: String(page),
      pageSize: String(pagination.pageSize)
    });

    for (const [key, value] of Object.entries(activeFilters)) {
      const normalized = value.trim();
      if (normalized) params.set(key, normalized);
    }

    async function loadTemplates() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/templates?${params.toString()}`, {
          credentials: "same-origin",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(await readTemplateError(response));
        }

        const data = (await response.json()) as unknown;
        if (!isTemplateListResponse(data)) {
          throw new Error("Nao foi possivel carregar os templates. Tente novamente.");
        }

        if (controller.signal.aborted || requestId !== listRequestIdRef.current) return;

        setTemplates(data.templates);
        setPagination(data.pagination);
        setSummary(data.summary);
      } catch (loadError) {
        if (controller.signal.aborted || requestId !== listRequestIdRef.current) return;

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar os templates. Tente novamente."
        );
      } finally {
        if (!controller.signal.aborted && requestId === listRequestIdRef.current) {
          setLoading(false);
        }
      }
    }

    void loadTemplates();

    return () => controller.abort();
  }, [
    activeFilters,
    channelsLoading,
    page,
    pagination.pageSize,
    refreshKey,
    selectedTemplateChannelId
  ]);

  const updateFilter = useCallback(
    <K extends keyof TemplateLibraryFilters>(field: K, value: TemplateLibraryFilters[K]) => {
      setFilters((current) => ({ ...current, [field]: value }));
      if (field !== "q") setPage(1);
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters(initialFilters);
    setAppliedQuery("");
    setPage(1);
  }, []);

  const refreshTemplates = useCallback(() => {
    setRefreshKey((current) => current + 1);
  }, []);

  const syncTemplates = useCallback(async () => {
    if (syncInFlightRef.current) return;

    if (!selectedSyncChannel) {
      setSyncFeedback({
        type: "error",
        message: "Selecione um canal do WhatsApp pronto para atualizar templates."
      });
      return;
    }

    syncInFlightRef.current = true;
    setSyncing(true);
    setSyncFeedback(null);

    try {
      const response = await fetch(
        `/api/channels/${encodeURIComponent(selectedSyncChannel.id)}/templates/sync`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }
      );

      if (!response.ok) {
        throw new Error(await readTemplateError(response));
      }

      const data = (await response.json()) as unknown;
      if (!isTemplateSyncResult(data)) {
        throw new Error("A sincronização terminou com resposta inesperada.");
      }

      setSyncFeedback({
        type: data.complete && data.failed === 0 ? "success" : "error",
        message: formatSyncSummary(data),
        warnings: [...data.warnings, ...data.errors.map((error) => error.message)]
      });
      refreshTemplates();
    } catch (syncError) {
      setSyncFeedback({
        type: "error",
        message:
          syncError instanceof Error
            ? syncError.message
            : "Nao foi possivel sincronizar os templates. Tente novamente."
      });
    } finally {
      syncInFlightRef.current = false;
      setSyncing(false);
    }
  }, [refreshTemplates, selectedSyncChannel]);

  const pendingNotice = useMemo(() => {
    const needsMedia = summary.needsMedia;
    const rejected = summary.rejected;
    const waiting = summary.waiting;

    if (needsMedia > 0) {
      return {
        tone: "amber" as const,
        message:
          needsMedia === 1
            ? "1 template precisa de uma imagem para ser utilizado."
            : `${needsMedia} templates precisam de imagem para serem utilizados.`,
        actionLabel: "Resolver",
        action: () => updateFilter("operationalStatus", "NEEDS_MEDIA")
      };
    }

    if (rejected > 0) {
      return {
        tone: "rose" as const,
        message:
          rejected === 1
            ? "1 template foi rejeitado e precisa de revisão."
            : `${rejected} templates foram rejeitados e precisam de revisão.`,
        actionLabel: "Ver templates",
        action: () => updateFilter("metaStatus", "REJECTED")
      };
    }

    if (waiting > 0) {
      return {
        tone: "blue" as const,
        message:
          waiting === 1
            ? "1 template está aguardando aprovação."
            : `${waiting} templates estão aguardando aprovação.`,
        actionLabel: "Atualizar",
        action: syncTemplates
      };
    }

    return {
      tone: "emerald" as const,
      message: "Todos os templates estão prontos para uso.",
      actionLabel: null,
      action: null
    };
  }, [summary.needsMedia, summary.rejected, summary.waiting, syncTemplates, updateFilter]);

  const closeTemplateDetails = useCallback(() => {
    setDrawerOpen(false);
    setSelectedTemplate(null);
    setTemplateDetails(null);
    setDetailsError(null);
    setDetailsLoading(false);

    const trigger = drawerTriggerRef.current;
    drawerTriggerRef.current = null;

    if (trigger?.isConnected) {
      window.setTimeout(() => trigger.focus(), 0);
    }
  }, []);

  const selectTemplateChannel = useCallback(
    (channelId: string) => {
      setSelectedSyncChannelId(channelId);
      setTemplates([]);
      setPagination(initialPagination);
      setSummary(initialSummary);
      setPage(1);
      setError(null);
      setSyncFeedback(null);
      setCreatePanelOpen(false);
      closeTemplateDetails();
    },
    [closeTemplateDetails]
  );

  const openTemplateDetails = useCallback((template: TemplateListItem) => {
    drawerTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedTemplate(template);
    setTemplateDetails(null);
    setDetailsError(null);
    setDrawerOpen(true);
  }, []);

  const retryTemplateDetails = useCallback(() => {
    setDetailsRefreshKey((current) => current + 1);
  }, []);

  const handleTemplateMediaAssociated = useCallback(
    (result: TemplateHeaderImageAssociationResponse) => {
      setTemplateDetails(result.template);
      setSelectedTemplate(result.template);
      setTemplates((current) =>
        current.map((template) =>
          template.id === result.template.id ? result.template : template
        )
      );
      setSyncFeedback({
        type: "success",
        message: "Imagem associada. O template foi atualizado na biblioteca."
      });
      refreshTemplates();
    },
    [refreshTemplates]
  );

  const openCreatePanel = useCallback(() => {
    closeTemplateDetails();
    setCreatePanelOpen(true);
  }, [closeTemplateDetails]);

  const closeCreatePanel = useCallback(() => {
    setCreatePanelOpen(false);
  }, []);

  useEffect(() => {
    if (!drawerOpen || !selectedTemplate) return;

    if (!templates.some((template) => template.id === selectedTemplate.id)) {
      closeTemplateDetails();
    }
  }, [closeTemplateDetails, drawerOpen, selectedTemplate, templates]);

  useEffect(() => {
    if (!drawerOpen || !selectedTemplate) return;

    const templateId = selectedTemplate.id;
    const controller = new AbortController();

    setDetailsLoading(true);
    setDetailsError(null);
    setTemplateDetails(null);

    async function loadTemplateDetails() {
      try {
        const response = await fetch(`/api/templates/${encodeURIComponent(templateId)}`, {
          credentials: "same-origin",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(await readTemplateError(response));
        }

        const data = (await response.json()) as unknown;
        if (!isTemplateDetailResponse(data)) {
          throw new Error("Nao foi possivel carregar os detalhes do template.");
        }

        if (controller.signal.aborted || data.template.id !== templateId) return;

        setTemplateDetails(data.template);
      } catch (loadError) {
        if (controller.signal.aborted) return;

        setDetailsError(
          loadError instanceof Error
            ? loadError.message
            : "Nao foi possivel carregar os detalhes do template."
        );
      } finally {
        if (!controller.signal.aborted) setDetailsLoading(false);
      }
    }

    void loadTemplateDetails();

    return () => controller.abort();
  }, [detailsRefreshKey, drawerOpen, selectedTemplate]);

  return (
    <div className="space-y-4">
      <section className="rounded border border-line bg-white p-5 shadow-soft">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-brand">
              <Library aria-hidden="true" className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-950">Templates</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Gerencie os templates utilizados nas campanhas e conversas.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Total", summary.total],
          ["Prontos", summary.ready],
          ["Aguardando", summary.waiting],
          ["Pendências", summary.pending]
        ].map(([label, value]) => (
          <div
            className="rounded-2xl border border-line bg-white p-4 shadow-soft"
            key={label}
          >
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
              {label}
            </p>
            <p className="mt-2 text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <section
        className={`flex flex-col gap-3 rounded-2xl border p-4 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${
          pendingNotice.tone === "rose"
            ? "border-rose-100 bg-rose-50 text-rose-800"
            : pendingNotice.tone === "amber"
              ? "border-amber-100 bg-amber-50 text-amber-800"
              : pendingNotice.tone === "blue"
                ? "border-blue-100 bg-blue-50 text-brand"
                : "border-emerald-100 bg-emerald-50 text-emerald-800"
        }`}
      >
        <span>{pendingNotice.message}</span>
        {pendingNotice.action && pendingNotice.actionLabel && (
          <button
            className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-xs font-bold text-slate-700 shadow-sm disabled:opacity-60"
            disabled={syncing && pendingNotice.actionLabel === "Atualizar"}
            onClick={pendingNotice.action}
            type="button"
          >
            {pendingNotice.actionLabel}
          </button>
        )}
      </section>

      <TemplateToolbar
        channelsError={channelsError}
        channelsLoading={channelsLoading}
        filters={filters}
        hasActiveFilters={hasActiveFilters}
        loading={loading}
        onClearFilters={clearFilters}
        onCreateTemplate={openCreatePanel}
        onFilterChange={updateFilter}
        onRefresh={refreshTemplates}
        onSelectSyncChannel={selectTemplateChannel}
        onSyncTemplates={syncTemplates}
        selectedSyncChannelId={selectedSyncChannel?.id ?? ""}
        syncFeedback={syncFeedback}
        syncableChannels={syncableChannels}
        syncing={syncing}
      />

      {createPanelOpen && (
        <TemplateCreatePanel
          channels={syncableChannels}
          channelsLoading={channelsLoading}
          onCreated={refreshTemplates}
          onClose={closeCreatePanel}
          preferredChannelId={selectedTemplateChannelId}
        />
      )}

      {loading && templates.length === 0 && <TemplateLoading />}
      {error && (
        <section
          className="rounded border border-rose-100 bg-rose-50 p-4 text-sm font-semibold text-rose-700"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            {error}
          </div>
          <button
            className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-xs font-bold text-rose-700 shadow-sm disabled:opacity-60"
            disabled={loading}
            onClick={refreshTemplates}
            type="button"
          >
            Tentar novamente
          </button>
        </section>
      )}
      {!error && !loading && templates.length === 0 && (
        <TemplateEmptyState
          emptyTitle="Nenhum template encontrado para este canal."
          hasActiveFilters={hasActiveFilters}
          onClearFilters={clearFilters}
          onCreateTemplate={openCreatePanel}
          onSyncTemplates={syncTemplates}
          syncDisabled={!selectedSyncChannel || syncing || channelsLoading}
          syncing={syncing}
        />
      )}
      {!error && templates.length > 0 && (
        <section aria-busy={loading} className="space-y-3">
          {loading && (
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-brand">
              <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
              Atualizando...
            </div>
          )}
          <TemplateTable
            onSelectTemplate={openTemplateDetails}
            selectedTemplateId={selectedTemplate?.id ?? null}
            templates={templates}
          />
          <div className="flex flex-col gap-3 rounded border border-line bg-white px-4 py-3 text-sm text-slate-600 shadow-soft sm:flex-row sm:items-center sm:justify-between">
            <span className="font-semibold">
              {pagination.total} template(s)
              {pagination.totalPages > 0
                ? ` · página ${pagination.page} de ${pagination.totalPages}`
                : ""}
            </span>
            {pagination.totalPages > 0 && (
              <div className="flex items-center gap-2">
                <button
                  className="inline-flex h-9 items-center gap-1 rounded-full border border-line px-3 text-xs font-bold text-slate-600 disabled:opacity-50"
                  disabled={!pagination.hasPreviousPage || loading}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  type="button"
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  className="inline-flex h-9 items-center gap-1 rounded-full border border-line px-3 text-xs font-bold text-slate-600 disabled:opacity-50"
                  disabled={!pagination.hasNextPage || loading}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Próxima
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      <TemplateDetailsDrawer
        detail={templateDetails}
        error={detailsError}
        isOpen={drawerOpen}
        loading={detailsLoading}
        onClose={closeTemplateDetails}
        onMediaAssociated={handleTemplateMediaAssociated}
        onRetry={retryTemplateDetails}
        template={selectedTemplate}
      />
    </div>
  );
}
