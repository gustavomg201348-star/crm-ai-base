"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, CheckCheck, ChevronLeft, ChevronRight, Clock3, Download, Loader2, MessageSquare, Plus, RefreshCw, Search, X } from "lucide-react";
import { agendaPeriod, localDay, saoPauloDate, shiftDate, type AgendaView } from "@/lib/agenda-policy";
import { AgendaTaskEditor } from "./AgendaTaskEditor";
import { notifyTaskChanges, useTaskRefresh } from "./task-updates";
import { taskError, type AgendaData, type AgendaTask } from "./agenda-types";

const views: { id: AgendaView; label: string }[] = [{ id: "day", label: "Dia" }, { id: "week", label: "Semana" }, { id: "month", label: "Mês" }, { id: "list", label: "Lista" }];
const statusLabels = { PENDING: "Pendente", DONE: "Concluído", CANCELLED: "Cancelado" };
const origins = { MANUAL: "Manual", AUTOMATIC: "Automático · Sem margem", UNKNOWN: "Origem não informada" };
const compactDate = (date: string) => new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
export function AgendaPage({ onOpenConversation }: { onOpenConversation(id: string): Promise<void> }) {
  const [view, setView] = useState<AgendaView>("week"), [date, setDate] = useState(saoPauloDate());
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [search, setSearch] = useState(""), [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL"), [assignee, setAssignee] = useState(""), [type, setType] = useState("ALL"), [origin, setOrigin] = useState("ALL");
  const [data, setData] = useState<AgendaData | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [editor, setEditor] = useState<{ task: AgendaTask | null } | null>(null);
  const [choices, setChoices] = useState<{ id: string; channel: string; status: string; channelRef: { name: string } | null }[] | null>(null);
  const request = useRef<AbortController | null>(null), mutation = useRef(false), appendPending = useRef(false);
  const conversationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (choices) conversationDialog.current?.showModal(); }, [choices]);
  const period = useMemo(() => custom ? { from: custom.from, to: shiftDate(custom.to, 1) } : agendaPeriod(date, view === "list" ? "month" : view), [custom, date, view]);
  const params = useMemo(() => new URLSearchParams({ view: "agenda", from: localDay(period.from).toISOString(),
    to: localDay(period.to).toISOString(), search: query, status, assigneeId: assignee, type, origin }), [period, query, status, assignee, type, origin]);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  const load = useCallback(async (cursor?: string) => {
    if (!cursor) appendPending.current = false;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    if (cursor) appendPending.current = true;
    setLoading(true); setError("");
    try {
      const pageParams = new URLSearchParams(params);
      if (cursor) pageParams.set("cursor", cursor);
      const r = await fetch("/api/tasks?" + pageParams, { cache: "no-store", signal: controller.signal });
      if (!r.ok) throw Error();
      const result = await r.json() as AgendaData;
      if (!controller.signal.aborted) setData(old => ({ ...result, tasks: cursor && old
        ? Array.from(new Map([...old.tasks, ...result.tasks].map(t => [t.id, t])).values()) : result.tasks }));
    } catch { if (!controller.signal.aborted) { setData(null); setError("Não foi possível carregar a Agenda. Tente atualizar."); } }
    finally { if (cursor) appendPending.current = false; if (!controller.signal.aborted) setLoading(false); }
  }, [params]);
  useEffect(() => { setData(null); void load(); return () => request.current?.abort(); }, [load]);
  useTaskRefresh(() => { if (!mutation.current && !editor) void load(); });
  function navigate(direction: number) {
    setCustom(null);
    if (view === "month" || view === "list") {
      const next = new Date(date.slice(0, 7) + "-01T12:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + direction); setDate(next.toISOString().slice(0, 10));
    } else setDate(shiftDate(date, direction * (view === "week" ? 7 : 1)));
  }
  async function change(task: AgendaTask, nextStatus: "DONE" | "CANCELLED") {
    if (mutation.current || !confirm(nextStatus === "DONE" ? "Concluir este agendamento?" : "Cancelar este agendamento? O histórico será preservado.")) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/tasks/" + task.id, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, expectedUpdatedAt: task.updatedAt }) });
      const result = await r.json(); if (!r.ok) throw Error(taskError(result.error));
      notifyTaskChanges(); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : taskError()); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function open(task: AgendaTask) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const r = await fetch("/api/tasks/" + task.id + "/conversations", { cache: "no-store" });
      if (!r.ok) throw Error("Não foi possível consultar as conversas deste cliente.");
      const result = await r.json();
      if (!result.conversations.length) throw Error("Este cliente ainda não tem uma conversa acessível no Atendimento.");
      if (result.conversations.length === 1) await onOpenConversation(result.conversations[0].id);
      else setChoices(result.conversations);
    } catch (failure) { setError(failure instanceof Error ? failure.message : taskError()); }
    finally { mutation.current = false; setBusy(false); }
  }
  async function exportAgenda() {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/tasks/export?" + params, { cache: "no-store" });
      if (!r.ok) { const result = await r.json(); throw Error(taskError(result.error)); }
      const url = URL.createObjectURL(await r.blob()), a = document.createElement("a");
      a.href = url; a.download = "agenda-" + period.from + ".xlsx"; a.click(); URL.revokeObjectURL(url);
    } catch (failure) { setError(failure instanceof Error ? failure.message : taskError()); }
    finally { setBusy(false); }
  }
  const days = useMemo(() => {
    const result: string[] = [];
    for (let value = period.from; value < period.to && result.length < 367; value = shiftDate(value, 1)) result.push(value);
    return result;
  }, [period]);
  const groups = new Map<string, AgendaTask[]>();
  for (const task of data?.tasks ?? []) { const day = saoPauloDate(new Date(task.dueAt)); groups.set(day, [...groups.get(day) ?? [], task]); }
  const field = "h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500";
  const button = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40";
  const card = (task: AgendaTask) => {
    const overdue = task.status === "PENDING" && new Date(task.dueAt) < new Date();
    return <article key={task.id} className={"rounded-xl border bg-white p-3 shadow-sm " + (overdue ? "border-rose-200" : "border-slate-200")}>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <time className="text-xs font-semibold text-slate-600" dateTime={task.dueAt}>{new Date(task.dueAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</time>
        <span className={"rounded-md px-2 py-0.5 text-[11px] font-medium " + (task.status === "DONE" ? "bg-emerald-50 text-emerald-700" : task.status === "CANCELLED" ? "bg-slate-100 text-slate-500" : overdue ? "bg-rose-50 text-rose-700" : "bg-blue-50 text-blue-700")}>
          {overdue ? "Atrasado" : statusLabels[task.status]}</span>
      </div>
      <h3 className="mt-2 break-words text-sm font-semibold text-slate-900">{task.contact.name}</h3>
      <p className="mt-1 break-words text-sm text-slate-600">{task.title}</p>
      {task.note && <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs text-slate-500">{task.note}</p>}
      <p className="mt-3 text-xs text-slate-500">{task.assignee?.name ?? "Sem responsável"}</p>
      <p className="mt-1 text-[11px] text-slate-400">{origins[task.origin]}</p>
      <div className="mt-3 flex flex-wrap gap-1 border-t border-slate-100 pt-2">
        <button type="button" disabled={busy} onClick={() => void open(task)} className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50" title="Abrir conversa" aria-label={"Abrir conversa de " + task.contact.name}><MessageSquare className="h-4 w-4" /></button>
        <button type="button" disabled={busy} onClick={() => setEditor({ task })} className="rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">Editar / reagendar</button>
        {task.status === "PENDING" && <><button type="button" disabled={busy} onClick={() => void change(task, "DONE")} className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-50" title="Concluir" aria-label={"Concluir " + task.title}><Check className="h-4 w-4" /></button>
          <button type="button" disabled={busy} onClick={() => void change(task, "CANCELLED")} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-700" title="Cancelar" aria-label={"Cancelar " + task.title}><X className="h-4 w-4" /></button></>}
      </div>
    </article>;
  };
  const counters = [
    { label: "Hoje", value: data?.counters.today, Icon: CalendarDays, tone: "text-blue-600 bg-blue-50" },
    { label: "Atrasados", value: data?.counters.overdue, Icon: Clock3, tone: "text-rose-600 bg-rose-50" },
    { label: "Próximos", value: data?.counters.upcoming, Icon: CalendarDays, tone: "text-violet-600 bg-violet-50" },
    { label: "Concluídos", value: data?.counters.completed, Icon: CheckCheck, tone: "text-emerald-600 bg-emerald-50" },
  ];
  return <div className="mx-auto max-w-[1600px] space-y-4" aria-label="Agenda">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0b2445] px-5 py-5 text-white">
      <div><h1 className="text-xl font-bold tracking-tight">Agenda</h1><p className="mt-1 text-sm text-blue-100">Retornos e tarefas da sua operação</p></div>
      <div className="flex gap-2">{data?.canExport && <button type="button" disabled={busy} onClick={() => void exportAgenda()} className={button}><Download className="h-4 w-4 text-slate-700" /><span className="text-slate-700">Exportar</span></button>}
        <button type="button" disabled={busy || !data} onClick={() => setEditor({ task: null })} className="inline-flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />Novo agendamento</button></div>
    </header>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {counters.map(({ label, value, Icon, tone }) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
        <span className={"rounded-xl p-2.5 " + tone}><Icon className="h-5 w-5" /></span><div><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{value === undefined ? "—" : value}</p></div></div>)}
    </div>
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className={button} aria-label="Período anterior" onClick={() => navigate(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" className={button} onClick={() => { setCustom(null); setDate(saoPauloDate()); }}>Hoje</button>
          <button type="button" className={button} aria-label="Próximo período" onClick={() => navigate(1)}><ChevronRight className="h-4 w-4" /></button>
          <span className="text-sm font-semibold text-slate-700">{compactDate(period.from)} – {compactDate(shiftDate(period.to, -1))}</span>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">{views.map(v => <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => { setView(v.id); setCustom(null); }}
          className={"rounded-lg px-3 py-1.5 text-sm " + (view === v.id ? "bg-white font-semibold text-blue-700 shadow-sm" : "text-slate-500")}>{v.label}</button>)}</div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input aria-label="Pesquisar por cliente" className={field + " w-full pl-9"} value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar cliente" /></div>
        <select aria-label="Responsável" className={field} value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">Todos os responsáveis permitidos</option>{data?.attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select aria-label="Status" className={field} value={status} onChange={e => setStatus(e.target.value)}><option value="ALL">Todos os status</option><option value="PENDING">Pendentes</option><option value="DONE">Concluídos</option><option value="CANCELLED">Cancelados</option></select>
        <div className="flex gap-2"><select aria-label="Tipo" className={field + " flex-1"} value={type} onChange={e => setType(e.target.value)}><option value="ALL">Todos os tipos</option><option value="RETURN">Retornos</option><option value="TASK">Tarefas</option></select>
          <select aria-label="Origem" className={field + " flex-1"} value={origin} onChange={e => setOrigin(e.target.value)}><option value="ALL">Todas as origens</option><option value="MANUAL">Manual</option><option value="AUTOMATIC">Automática</option><option value="UNKNOWN">Não informada</option></select></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><label>De <input aria-label="Data inicial" type="date" className={field} value={period.from} onChange={e => { if (e.target.value && e.target.value <= shiftDate(period.to, -1)) setCustom({ from: e.target.value, to: shiftDate(period.to, -1) }); }} /></label>
        <label>Até <input aria-label="Data final" type="date" className={field} value={shiftDate(period.to, -1)} onChange={e => { if (e.target.value && e.target.value >= period.from) setCustom({ from: period.from, to: e.target.value }); }} /></label>
        <span className="flex-1">Horários de Brasília · Indicadores respeitam os filtros</span>
        <button type="button" className={button} disabled={loading} onClick={() => void load()}><RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />Atualizar</button>
      </div>
    </div>
    {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    {loading && !data && <div role="status" className="flex items-center justify-center gap-2 p-12 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />Carregando agendamentos…</div>}
    {data && <><div className="flex items-center justify-between text-xs text-slate-500"><p>{data.tasks.length} de {data.total} agendamentos{data.nextCursor ? " · Carregue mais para completar o período" : ""}</p><span>{loading ? "Atualizando…" : "Dados compartilhados com Atendimento e Dashboard"}</span></div>
      {!data.tasks.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center"><CalendarDays className="mx-auto h-9 w-9 text-slate-300" /><h2 className="mt-3 font-semibold text-slate-800">Nenhum agendamento neste período</h2><p className="mt-1 text-sm text-slate-500">Ajuste os filtros ou crie um novo agendamento.</p></div>
        : view === "list" ? <div className="space-y-5">{Array.from(groups).map(([day, tasks]) => <section key={day}><h2 className="mb-2 text-sm font-semibold text-slate-700">{compactDate(day)}</h2><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{tasks.map(card)}</div></section>)}</div>
          : <div className={"grid gap-2 " + (view === "day" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-7")}>
            {view === "month" && !custom && Array.from({ length: (new Date(period.from + "T12:00:00Z").getUTCDay() + 6) % 7 }, (_, i) => <div key={"pad-" + i} className="hidden lg:block" />)}
            {days.map(day => <section key={day} className={"min-w-0 rounded-xl border p-2 " + (day === saoPauloDate() ? "border-blue-300 bg-blue-50/50" : "border-slate-200 bg-slate-50/70")}>
              <h2 className="mb-3 flex items-center justify-between px-1 text-xs font-semibold text-slate-600"><span>{new Date(day + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "short" })}</span><span className={day === saoPauloDate() ? "rounded-full bg-blue-600 px-2 py-1 text-white" : ""}>{compactDate(day)}</span></h2>
              <div className="space-y-2">{(groups.get(day) ?? []).map(card)}</div>
            </section>)}
          </div>}
      {data.nextCursor && <div className="text-center"><button type="button" disabled={loading} className={button} onClick={() => void load(data.nextCursor!)}>Carregar próximos 50 agendamentos</button></div>}
    </>}
    {editor && data && <AgendaTaskEditor task={editor.task} data={data} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} />}
    {choices && <dialog ref={conversationDialog} onCancel={() => setChoices(null)} aria-label="Escolher conversa" className="fixed inset-0 z-50 m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl backdrop:bg-slate-900/50">
      <h2 className="font-semibold">Escolha o canal da conversa</h2><div className="my-3 space-y-2">{choices.map(c => <button type="button" key={c.id} className={button + " w-full"} onClick={() => { setChoices(null); void onOpenConversation(c.id).catch(() => setError("Não foi possível abrir a conversa.")); }}>{c.channelRef?.name ?? c.channel} · {c.status}</button>)}</div>
      <button type="button" className={button} onClick={() => setChoices(null)}>Fechar</button></dialog>}
  </div>;
}
