"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  SkipForward,
  Sparkles,
  X,
  UserRound
} from "lucide-react";
import type { OpportunityQueueItem } from "@/app/components/opportunities/types";

type ActionNotice = {
  tone: "success" | "info";
  message: string;
} | null;

type LifecycleAction = "COMPLETED" | "SKIPPED" | "RETURNED";

type ReasonModalState = {
  action: Extract<LifecycleAction, "SKIPPED" | "RETURNED">;
  title: string;
  description: string;
  confirmLabel: string;
} | null;

type ActionResult = {
  id: string;
  label: string;
  consequence: string;
};

const ACTION_RESULTS: ActionResult[] = [
  {
    id: "client_replied",
    label: "Cliente respondeu",
    consequence: "A oportunidade sairá da sua ação atual e ficará aguardando o próximo movimento do cliente."
  },
  {
    id: "requested_return",
    label: "Cliente pediu retorno",
    consequence: "A oportunidade deverá voltar para a fila no horário combinado."
  },
  {
    id: "proposal_created",
    label: "Proposta criada",
    consequence: "A oportunidade seguirá como negociação em andamento."
  },
  {
    id: "sale_closed",
    label: "Venda realizada",
    consequence: "A oportunidade será considerada concluída e sairá da fila ativa."
  },
  {
    id: "not_interested",
    label: "Sem interesse",
    consequence: "A oportunidade ficará fora da fila até surgir um novo sinal comercial."
  },
  {
    id: "contact_failed",
    label: "Não consegui contato",
    consequence: "A oportunidade poderá voltar para uma nova tentativa posteriormente."
  },
  {
    id: "invalid_number",
    label: "Número inválido",
    consequence: "A oportunidade deverá ficar fora da fila até o contato ser corrigido."
  }
];

type NextOpportunityResponse = {
  opportunity: OpportunityQueueItem | null;
  empty: boolean;
  scanned: number;
  skipped: number;
  claimed?: boolean;
  claimStatus?: "CLAIMED" | "ALREADY_OWNED" | "TAKEN" | "MISSING" | "IDEMPOTENT";
  message?: string;
};

type OpportunityActionResponse = {
  action: LifecycleAction;
  idempotent: boolean;
  suppressedUntil: string | null;
  message: string;
};

class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function createIdempotencyKey(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${random}`;
}

async function readApiError(response: Response, fallback: string) {
  const data = (await response.json().catch(() => null)) as
    | { error?: string; code?: string }
    | null;

  return new ApiRequestError(data?.error ?? fallback, data?.code, response.status);
}

async function requestNextOpportunity({
  signal,
  excludeConversationIds
}: {
  signal: AbortSignal;
  excludeConversationIds: string[];
}) {
  const response = await fetch("/api/opportunities/next", {
    method: "POST",
    signal,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: "peek", excludeConversationIds })
  });

  if (!response.ok) {
    throw new Error("Não foi possível carregar a próxima melhor ação.");
  }

  return (await response.json()) as NextOpportunityResponse;
}

async function claimVisibleOpportunity({
  conversationId,
  idempotencyKey,
  excludeConversationIds
}: {
  conversationId: string;
  idempotencyKey: string;
  excludeConversationIds: string[];
}) {
  const response = await fetch("/api/opportunities/next", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action: "claim", conversationId, idempotencyKey, excludeConversationIds })
  });

  if (!response.ok) {
    throw await readApiError(response, "Não foi possível assumir esta oportunidade.");
  }

  return (await response.json()) as NextOpportunityResponse;
}

async function recordOpportunityAction({
  action,
  conversationId,
  idempotencyKey,
  reason,
  outcome
}: {
  action: LifecycleAction;
  conversationId: string;
  idempotencyKey: string;
  reason?: string;
  outcome?: string;
}) {
  const response = await fetch("/api/opportunities/action", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ action, conversationId, idempotencyKey, reason, outcome })
  });

  if (!response.ok) {
    throw await readApiError(response, "Não foi possível registrar a ação.");
  }

  return (await response.json()) as OpportunityActionResponse;
}

function ActionField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </span>
      <span className="mt-1 block font-medium text-slate-700">{value}</span>
    </div>
  );
}

export function NextBestActionPage({
  onOpenConversation
}: {
  onOpenConversation: (conversationId: string) => void | Promise<void>;
}) {
  const [currentOpportunity, setCurrentOpportunity] = useState<OpportunityQueueItem | null>(null);
  const [excludedConversationIds, setExcludedConversationIds] = useState<string[]>([]);
  const [queueMeta, setQueueMeta] = useState({ scanned: 0, skipped: 0 });
  const [loading, setLoading] = useState(true);
  const [claimLoading, setClaimLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<LifecycleAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice>(null);
  const [claimedConversationId, setClaimedConversationId] = useState<string | null>(null);
  const [isResultModalOpen, setIsResultModalOpen] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [resultIdempotencyKey, setResultIdempotencyKey] = useState<string | null>(null);
  const [reasonModal, setReasonModal] = useState<ReasonModalState>(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonIdempotencyKey, setReasonIdempotencyKey] = useState<string | null>(null);
  const requestRef = useRef(0);
  const claimIdempotencyKeyRef = useRef<string | null>(null);

  const loadNextOpportunity = useCallback((excludeConversationIdsSnapshot: string[]) => {
    const controller = new AbortController();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setLoading(true);
    setError(null);
    setNotice(null);

    void requestNextOpportunity({
      signal: controller.signal,
      excludeConversationIds: excludeConversationIdsSnapshot
    })
      .then((data) => {
        if (requestRef.current !== requestId) return;
        setCurrentOpportunity(data.opportunity);
        setClaimedConversationId(null);
        claimIdempotencyKeyRef.current = data.opportunity
          ? createIdempotencyKey(`nba-claim-${data.opportunity.conversationId}`)
          : null;
        setQueueMeta({ scanned: data.scanned, skipped: data.skipped });
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a próxima melhor ação.");
        setCurrentOpportunity(null);
        setQueueMeta({ scanned: 0, skipped: 0 });
      })
      .finally(() => {
        if (requestRef.current === requestId) {
          setLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => loadNextOpportunity([]), [loadNextOpportunity]);

  const reloadFromStart = useCallback(() => {
    setExcludedConversationIds([]);
    setClaimedConversationId(null);
    loadNextOpportunity([]);
  }, [loadNextOpportunity]);

  useEffect(() => {
    if (!isResultModalOpen && !reasonModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsResultModalOpen(false);
        setSelectedResultId(null);
        setResultIdempotencyKey(null);
        setReasonModal(null);
        setReasonText("");
        setReasonIdempotencyKey(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isResultModalOpen, reasonModal]);

  const queueInfo = useMemo(
    () => `${queueMeta.scanned} conversas analisadas. ${queueMeta.skipped} ignorada(s) nesta rodada local.`,
    [queueMeta.scanned, queueMeta.skipped]
  );

  const handleWorkOpportunity = useCallback(async () => {
    if (!currentOpportunity || claimLoading) return;

    setClaimLoading(true);
    setError(null);
    setNotice(null);

    try {
      const data = await claimVisibleOpportunity({
        conversationId: currentOpportunity.conversationId,
        idempotencyKey:
          claimIdempotencyKeyRef.current ??
          createIdempotencyKey(`nba-claim-${currentOpportunity.conversationId}`),
        excludeConversationIds: excludedConversationIds
      });

      setQueueMeta({ scanned: data.scanned, skipped: data.skipped });

      if (data.claimed && data.opportunity) {
        setCurrentOpportunity(data.opportunity);
        setClaimedConversationId(data.opportunity.conversationId);
        setNotice({ tone: "success", message: "Oportunidade assumida. Agora você pode abrir a conversa, concluir ou devolver." });
        return;
      }

      const nextExcluded = [...excludedConversationIds, currentOpportunity.conversationId];
      setExcludedConversationIds(nextExcluded);
      setCurrentOpportunity(data.opportunity);
      setNotice({
        tone: "info",
        message: data.message ?? "Essa oportunidade foi assumida por outro operador. Preparamos a próxima opção."
      });
    } catch (claimError) {
      const message =
        claimError instanceof Error ? claimError.message : "Não foi possível assumir esta oportunidade.";
      setError(message);
    } finally {
      setClaimLoading(false);
    }
  }, [claimLoading, currentOpportunity, excludedConversationIds]);

  const handleComplete = useCallback(() => {
    if (!currentOpportunity || claimedConversationId !== currentOpportunity.conversationId) return;

    setSelectedResultId(null);
    setResultIdempotencyKey(createIdempotencyKey(`nba-complete-${currentOpportunity.conversationId}`));
    setIsResultModalOpen(true);
    setNotice(null);
  }, [claimedConversationId, currentOpportunity]);

  const handleCloseResultModal = useCallback(() => {
    setIsResultModalOpen(false);
    setSelectedResultId(null);
    setResultIdempotencyKey(null);
  }, []);

  const handleConfirmResult = useCallback(async () => {
    if (!currentOpportunity || !selectedResultId || !resultIdempotencyKey || actionLoading) return;

    const selectedResult = ACTION_RESULTS.find((result) => result.id === selectedResultId);
    if (!selectedResult) return;

    setActionLoading("COMPLETED");
    setError(null);

    try {
      await recordOpportunityAction({
        action: "COMPLETED",
        conversationId: currentOpportunity.conversationId,
        idempotencyKey: resultIdempotencyKey,
        outcome: selectedResult.label
      });

      setIsResultModalOpen(false);
      setSelectedResultId(null);
      setResultIdempotencyKey(null);
      setExcludedConversationIds([]);
      setNotice({
        tone: "success",
        message: "Resultado registrado. Próxima oportunidade preparada."
      });
      loadNextOpportunity([]);
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : "Não foi possível registrar o resultado.";
      setError(message);
    } finally {
      setActionLoading(null);
    }
  }, [actionLoading, currentOpportunity, loadNextOpportunity, resultIdempotencyKey, selectedResultId]);

  const handleSkip = useCallback(() => {
    if (!currentOpportunity || claimedConversationId === currentOpportunity.conversationId) return;

    setReasonText("");
    setReasonIdempotencyKey(createIdempotencyKey(`nba-skip-${currentOpportunity.conversationId}`));
    setReasonModal({
      action: "SKIPPED",
      title: "Por que pular esta oportunidade?",
      description: "A oportunidade ficará oculta para você por algumas horas, sem alterar o responsável.",
      confirmLabel: "Pular oportunidade"
    });
    setNotice(null);
  }, [claimedConversationId, currentOpportunity]);

  const handleReturnToQueue = useCallback(() => {
    if (!currentOpportunity || claimedConversationId !== currentOpportunity.conversationId) return;

    setReasonText("");
    setReasonIdempotencyKey(createIdempotencyKey(`nba-return-${currentOpportunity.conversationId}`));
    setReasonModal({
      action: "RETURNED",
      title: "Devolver oportunidade para a fila?",
      description: "A conversa só será liberada se ainda estiver atribuída pelo claim da Próxima Melhor Ação.",
      confirmLabel: "Devolver para fila"
    });
    setNotice(null);
  }, [claimedConversationId, currentOpportunity]);

  const handleCloseReasonModal = useCallback(() => {
    setReasonModal(null);
    setReasonText("");
    setReasonIdempotencyKey(null);
  }, []);

  const handleConfirmReasonAction = useCallback(async () => {
    if (!currentOpportunity || !reasonModal || !reasonIdempotencyKey || actionLoading) return;

    const reason = reasonText.trim();
    if (!reason) return;

    setActionLoading(reasonModal.action);
    setError(null);

    try {
      await recordOpportunityAction({
        action: reasonModal.action,
        conversationId: currentOpportunity.conversationId,
        idempotencyKey: reasonIdempotencyKey,
        reason
      });

      setReasonModal(null);
      setReasonText("");
      setReasonIdempotencyKey(null);
      setExcludedConversationIds([]);
      setNotice({
        tone: "info",
        message:
          reasonModal.action === "SKIPPED"
            ? "Oportunidade pulada. Próxima oportunidade preparada."
            : "Oportunidade devolvida para a fila. Próxima oportunidade preparada."
      });
      loadNextOpportunity([]);
    } catch (actionError) {
      const message =
        actionError instanceof Error ? actionError.message : "Não foi possível registrar a ação.";
      setError(message);
    } finally {
      setActionLoading(null);
    }
  }, [actionLoading, currentOpportunity, loadNextOpportunity, reasonIdempotencyKey, reasonModal, reasonText]);

  const isCurrentClaimed = Boolean(
    currentOpportunity && claimedConversationId === currentOpportunity.conversationId
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">Next Best Action</p>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ink">Próxima Melhor Ação</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">
              O CRM apresenta uma oportunidade por vez. A conversa só é assumida quando o operador decide trabalhar nela.
            </p>
          </div>
          <button
            type="button"
            onClick={reloadFromStart}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand"
          >
            <RotateCcw className="h-4 w-4" />
            Recarregar fila
          </button>
        </div>
      </header>

      {loading ? (
        <div className="rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-soft">
          <div className="flex gap-4">
            <div className="h-12 w-12 animate-pulse rounded-2xl bg-slate-100" />
            <div className="flex-1">
              <div className="h-3 w-36 animate-pulse rounded-full bg-slate-100" />
              <div className="mt-3 h-8 max-w-xl animate-pulse rounded-full bg-slate-100" />
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
                <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
                <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
                <div className="h-20 animate-pulse rounded-2xl bg-slate-50" />
              </div>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-soft">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-semibold">Próxima ação indisponível</h2>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={reloadFromStart}
              className="rounded-2xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : !currentOpportunity ? (
        <div className="rounded-[1.75rem] border border-dashed border-line bg-white p-8 text-center shadow-soft">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-ink">
            Excelente! Não há próxima ação prioritária nesta rodada.
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500">
            Recarregue a fila quando quiser buscar novas oportunidades calculadas pelo CRM.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-soft">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                    <Sparkles className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand">
                      Próxima oportunidade
                    </p>
                    <h2 className="mt-1 text-2xl font-bold text-ink">
                      {currentOpportunity.contact.name}
                    </h2>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl border border-brand/15 bg-brand/5 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                    Ação recomendada
                  </p>
                  <p className="mt-2 text-xl font-bold text-ink">
                    {currentOpportunity.primaryAction.title}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {currentOpportunity.primaryAction.reason}
                  </p>
                </div>

                <div className="mt-5 grid gap-4 text-sm md:grid-cols-2">
                  <ActionField label="Produto provável" value={currentOpportunity.product.label} />
                  <ActionField label="Motivo" value={currentOpportunity.queueReason} />
                  <ActionField
                    label="Responsável"
                    value={currentOpportunity.owner?.name ?? "Sem responsável"}
                  />
                  <div>
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Rodada atual
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 font-medium text-slate-700">
                      <UserRound className="h-3.5 w-3.5 text-slate-400" />
                      {queueInfo}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex w-full flex-col gap-3 lg:w-56">
                {isCurrentClaimed ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void onOpenConversation(currentOpportunity.conversationId)}
                      disabled={Boolean(actionLoading)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      Abrir conversa
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleComplete}
                      disabled={Boolean(actionLoading)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Concluir
                    </button>
                    <button
                      type="button"
                      onClick={handleReturnToQueue}
                      disabled={Boolean(actionLoading)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Voltar para fila
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleWorkOpportunity()}
                      disabled={claimLoading || Boolean(actionLoading)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    >
                      {claimLoading ? "Assumindo..." : "Trabalhar esta oportunidade"}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleSkip}
                      disabled={claimLoading || Boolean(actionLoading)}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <SkipForward className="h-4 w-4" />
                      Pular
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>

          {notice && (
            <div
              className={
                notice.tone === "success"
                  ? "rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-medium text-emerald-800"
                  : "rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-800"
              }
            >
              {notice.message}
            </div>
          )}

          {isResultModalOpen && (
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
              role="dialog"
            >
              <div className="w-full max-w-lg rounded-[1.5rem] border border-line bg-white p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                      Resultado da ação
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-ink">
                      Como terminou este atendimento?
                    </h3>
                    <p className="mt-2 text-sm text-slate-500">
                      Escolha um resultado para registrar o encerramento desta ação e avançar para a próxima oportunidade.
                    </p>
                  </div>
                  <button
                    aria-label="Fechar"
                    className="rounded-full border border-line p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    onClick={handleCloseResultModal}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-5 grid gap-2">
                  {ACTION_RESULTS.map((result) => {
                    const isSelected = selectedResultId === result.id;

                    return (
                      <div className="grid gap-2" key={result.id}>
                        <button
                          className={
                            isSelected
                              ? "rounded-2xl border border-brand bg-brand/10 px-4 py-3 text-left text-sm font-semibold text-brand transition"
                              : "rounded-2xl border border-line bg-white px-4 py-3 text-left text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand"
                          }
                          onClick={() => setSelectedResultId(result.id)}
                          type="button"
                        >
                          {result.label}
                        </button>
                        {isSelected && (
                          <p className="rounded-2xl border border-brand/15 bg-brand/5 px-4 py-3 text-sm leading-6 text-slate-600">
                            {result.consequence}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                    onClick={handleCloseResultModal}
                    type="button"
                  >
                    Cancelar
                  </button>
                  <button
                    className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    disabled={!selectedResultId}
                    onClick={() => void handleConfirmResult()}
                    type="button"
                  >
                    {actionLoading === "COMPLETED" ? "Registrando..." : "Confirmar resultado"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {reasonModal && (
            <div
              aria-modal="true"
              className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6"
              role="dialog"
            >
              <div className="w-full max-w-md rounded-[1.5rem] border border-line bg-white p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
                      Próxima Melhor Ação
                    </p>
                    <h3 className="mt-1 text-xl font-bold text-ink">{reasonModal.title}</h3>
                    <p className="mt-2 text-sm text-slate-500">{reasonModal.description}</p>
                  </div>
                  <button
                    aria-label="Fechar"
                    className="rounded-full border border-line p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                    onClick={handleCloseReasonModal}
                    type="button"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <label className="mt-5 block text-sm font-semibold text-slate-700" htmlFor="nba-action-reason">
                  Motivo
                </label>
                <textarea
                  className="mt-2 min-h-[96px] w-full resize-none rounded-2xl border border-line px-4 py-3 text-sm outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
                  id="nba-action-reason"
                  onChange={(event) => setReasonText(event.target.value)}
                  placeholder="Descreva rapidamente o motivo..."
                  value={reasonText}
                />

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button
                    className="rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300"
                    onClick={handleCloseReasonModal}
                    type="button"
                  >
                    Cancelar
                  </button>
                  <button
                    className="rounded-2xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-soft transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                    disabled={!reasonText.trim() || actionLoading === reasonModal.action}
                    onClick={() => void handleConfirmReasonAction()}
                    type="button"
                  >
                    {actionLoading === reasonModal.action ? "Registrando..." : reasonModal.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
