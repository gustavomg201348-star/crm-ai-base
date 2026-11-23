"use client";

import { useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";

type AttendantOption = { id: string; name: string };

const reasons = [
  "Sem margem",
  "Juros alto",
  "Valor baixo",
  "Vai pensar",
  "Sem tempo",
  "Comparando",
  "Sem documentos",
  "Aguardando pagamento",
  "Outro"
];

function isoStartOfDay(value: string) {
  return new Date(`${value}T00:00:00`).toISOString();
}

function isoStartOfNextDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function TaskTurnoverExportPanel({ attendants }: { attendants: AttendantOption[] }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("Sem margem");
  const [assigneeId, setAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState("");
  const [error, setError] = useState("");

  async function backfillExistingSemMargem() {
    setError("");
    setBackfillResult("");
    if (!window.confirm("Colocar em hoje todos os clientes que ja tinham a tag Sem margem antes de hoje?")) {
      return;
    }
    setBackfillBusy(true);
    try {
      const response = await fetch("/api/tasks/sem-margem/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const data = (await response.json().catch(() => null)) as
        | { candidates?: number; created?: number; movedToToday?: number; alreadyScheduled?: number; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Nao foi possivel agendar os clientes existentes.");
      }
      setBackfillResult(
        `${data?.created ?? 0} criado(s) para hoje; ${data?.movedToToday ?? 0} movido(s) para hoje; ${data?.alreadyScheduled ?? 0} ja estavam em hoje; ${data?.candidates ?? 0} cliente(s) historicos encontrados.`
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Nao foi possivel agendar os clientes existentes.");
    } finally {
      setBackfillBusy(false);
    }
  }

  async function exportSheet() {
    setError("");
    if (!from || !to || from > to) {
      setError("Informe um periodo valido.");
      return;
    }
    setBusy(true);
    try {
      const params = new URLSearchParams({
        from: isoStartOfDay(from),
        to: isoStartOfNextDay(to),
        ...(reason ? { reason } : {}),
        ...(assigneeId ? { assigneeId } : {})
      });
      const response = await fetch(`/api/tasks/export?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Nao foi possivel gerar a planilha.");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName = disposition.match(/filename="?([^"]+)"?/i)?.[1] ?? "retornos-virada-folha.xlsx";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Nao foi possivel gerar a planilha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand">Virada de folha CLT</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">Exportar retornos em XLSX</p>
          <p className="mt-1 text-xs text-slate-500">Exporte a lista para consulta apos a virada com nome, CPF e telefone.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={backfillBusy}
            onClick={() => void backfillExistingSemMargem()}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-blue-200 bg-white px-4 text-sm font-bold text-brand disabled:opacity-60"
          >
            {backfillBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {backfillBusy ? "Agendando..." : "Trazer Sem margem antigos para hoje"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportSheet()}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? "Gerando..." : "Exportar XLSX"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-700">
          Data inicial
          <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Data final
          <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Motivo
          <select className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">Todos</option>
            {reasons.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-700">
          Vendedor / atendente
          <select className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
            <option value="">Todos</option>
            {attendants.map((attendant) => <option key={attendant.id} value={attendant.id}>{attendant.name}</option>)}
          </select>
        </label>
      </div>

      {backfillResult && <p className="mt-3 text-xs font-semibold text-emerald-700">{backfillResult}</p>}
      {error && <p className="mt-3 text-xs font-semibold text-rose-700">{error}</p>}
    </div>
  );
}
