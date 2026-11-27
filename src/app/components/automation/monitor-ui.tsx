"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Section } from "@/lib/sidebar-navigation";
export type Navigate = (section: Section) => void;
export function technicalDate(value: unknown) {
  return value
    ? new Date(String(value)).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      })
    : "Não registrado";
}
export const panel = "rounded-2xl border border-line bg-white p-5 shadow-soft";
export const action =
  "rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50";
export const count = (
  rows: Array<{ _count: { _all: number }; state?: string; status?: string }>,
  states?: string[],
) =>
  rows
    .filter((r) => !states || states.includes(r.state ?? r.status ?? ""))
    .reduce((n, r) => n + r._count._all, 0);
export function useMonitor<T>(path: string) {
  const [snapshot, setSnapshot] = useState<{ path: string; data: T } | null>(
      null,
    ),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError("");
    try {
      const r = await fetch(path, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!r.ok) throw Error("READ_FAILED");
      const data = (await r.json()) as T;
      if (!controller.signal.aborted) setSnapshot({ path, data });
    } catch {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setError(
          "Não foi possível carregar os dados. Nenhuma alteração foi realizada. Tente atualizar.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
  }, [refresh]);
  return {
    data: snapshot?.path === path ? snapshot.data : null,
    loading,
    error,
    refresh,
  };
}
export function MonitorHeader({
  title,
  description,
  updatedAt,
  loading,
  onRefresh,
}: {
  title: string;
  description: string;
  updatedAt?: unknown;
  loading: boolean;
  onRefresh: () => unknown;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl bg-[#0b2445] p-5 text-white">
      <div className="min-w-0">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-blue-100">{description}</p>
        <p className="mt-2 text-xs text-blue-200">
          Última leitura: {technicalDate(updatedAt)} · Atualização manual ·
          Horário de Brasília
        </p>
      </div>
      <button
        className={action}
        type="button"
        disabled={loading}
        onClick={() => void onRefresh()}
      >
        Atualizar {title}
      </button>
    </header>
  );
}
export function MonitorState({
  error,
  loading,
  hasData,
}: {
  error: string;
  loading: boolean;
  hasData: boolean;
}) {
  return error ? (
    <p
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
    >
      {error}
    </p>
  ) : loading && !hasData ? (
    <p role="status" className="p-6 text-sm text-slate-500">
      Carregando monitoramento…
    </p>
  ) : null;
}
export function Fact({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-line/60 py-2 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
