"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { EmptyState } from "@/app/components/opportunities/EmptyState";
import { LoadingState } from "@/app/components/opportunities/LoadingState";
import { MissionCard } from "@/app/components/opportunities/MissionCard";
import { OpportunityGroup } from "@/app/components/opportunities/OpportunityGroup";
import {
  buildTeamSummary,
  getVisibleOpportunityGroups,
  groupOpportunityItems
} from "@/app/components/opportunities/opportunity-presentation";
import type {
  OpportunityQueueItem,
  OpportunityQueueResponse
} from "@/app/components/opportunities/types";

const INITIAL_VISIBLE_OPPORTUNITIES = 10;

async function loadOpportunityQueue(signal: AbortSignal) {
  const response = await fetch("/api/opportunities/queue?limit=50", {
    signal,
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("Não foi possível carregar a fila comercial.");
  }

  return (await response.json()) as OpportunityQueueResponse;
}

export function MotorCommercialPage({
  onOpenConversation
}: {
  onOpenConversation: (conversationId: string) => void | Promise<void>;
}) {
  const [items, setItems] = useState<OpportunityQueueItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const requestRef = useRef(0);

  const loadQueue = useCallback(() => {
    const controller = new AbortController();
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;

    setLoading(true);
    setError(null);

    void loadOpportunityQueue(controller.signal)
      .then((data) => {
        if (requestRef.current !== requestId) return;
        setItems(data.items);
        setNextCursor(data.nextCursor);
        setShowAll(false);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a fila comercial.");
        setItems([]);
        setNextCursor(null);
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

  useEffect(() => loadQueue(), [loadQueue]);

  const groups = useMemo(() => groupOpportunityItems(items), [items]);
  const visibleGroups = useMemo(
    () =>
      getVisibleOpportunityGroups({
        groups,
        limit: INITIAL_VISIBLE_OPPORTUNITIES,
        expanded: showAll
      }),
    [groups, showAll]
  );
  const teamSummary = useMemo(() => buildTeamSummary(items), [items]);
  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.items.length, 0);
  const hasHiddenLoadedItems = visibleCount < items.length;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="rounded-[1.75rem] border border-line/80 bg-white p-6 shadow-soft">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand">Operação do dia</p>
        <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-ink">Motor Comercial</h1>
            <p className="mt-2 text-sm text-slate-500">
              O CRM organizou as oportunidades mais importantes do dia.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadQueue()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-brand/40 hover:text-brand"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar fila
          </button>
        </div>
      </header>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <div className="rounded-[1.5rem] border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-soft">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="font-semibold">Fila indisponível</h2>
                <p className="mt-1 text-sm">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => loadQueue()}
              className="rounded-2xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <MissionCard
            groups={groups}
            hasMoreItems={Boolean(nextCursor)}
            visibleCount={visibleCount}
          />

          <section className="rounded-[1.5rem] border border-line/80 bg-white p-4 shadow-soft md:p-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-ink">Equipe hoje</h2>
              <p className="text-sm text-slate-500">
                Distribuição operacional das oportunidades carregadas.
              </p>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {teamSummary.map((member) => (
                <div key={member.id} className="rounded-2xl border border-line bg-slate-50 p-4">
                  <p className="truncate text-sm font-semibold text-ink">{member.name}</p>
                  <p className="mt-2 text-2xl font-bold text-brand">{member.total}</p>
                  <p className="text-xs font-medium text-slate-500">
                    {member.total === 1 ? "oportunidade" : "oportunidades"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-5">
            {visibleGroups.map((group) => (
              <OpportunityGroup
                key={group.key}
                group={group}
                onOpenConversation={(conversationId) => void onOpenConversation(conversationId)}
              />
            ))}
          </div>

          {hasHiddenLoadedItems && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="rounded-2xl border border-line bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-brand/40 hover:text-brand"
              >
                Ver todas
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
