"use client";
import { useEffect, useRef, useState } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { saoPauloDate } from "@/lib/agenda-policy";
import { notifyTaskChanges } from "./task-updates";
import { taskError, type AgendaData, type AgendaTask } from "./agenda-types";

export function AgendaTaskEditor({ task, data, onClose, onSaved }: {
  task: AgendaTask | null; data: AgendaData; onClose(): void; onSaved(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const saving = useRef(false);
  const [contact, setContact] = useState(task?.contact ?? null);
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);
  const [searchError, setSearchError] = useState("");
  const [title, setTitle] = useState(task?.title ?? "");
  const [note, setNote] = useState(task?.note ?? "");
  const [assigneeId, setAssigneeId] = useState(task?.assigneeId ?? (data.canManage ? "" : data.attendants[0]?.id ?? ""));
  const initialDate = task ? saoPauloDate(new Date(task.dueAt)) + "T" +
    new Date(task.dueAt).toLocaleTimeString("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    : saoPauloDate() + "T09:00";
  const [dueAt, setDueAt] = useState(initialDate);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (task) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearchError("");
      void fetch("/api/tasks/contacts?search=" + encodeURIComponent(search), { cache: "no-store", signal: controller.signal })
        .then(async r => { if (!r.ok) throw Error(); return r.json(); })
        .then(result => { if (!controller.signal.aborted) setContacts(result.contacts); })
        .catch(() => { if (!controller.signal.aborted) setSearchError("Não foi possível pesquisar os clientes."); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, task]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current || !contact || !dueAt) return;
    saving.current = true; setBusy(true); setError("");
    try {
      const r = await fetch(task ? "/api/tasks/" + task.id : "/api/tasks", {
        method: task ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({ title, note, dueAt: new Date(dueAt + ":00-03:00").toISOString(),
          ...(task ? { expectedUpdatedAt: task.updatedAt } : { contactId: contact.id }),
          ...(data.canManage || !task ? { assigneeId } : {}) }),
      });
      const result = await r.json();
      if (!r.ok) throw Error(taskError(result.error));
      notifyTaskChanges(); onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : taskError()); }
    finally { saving.current = false; setBusy(false); }
  }
  const field = "mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  return <dialog ref={dialog} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}
    className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border-0 bg-white p-0 shadow-2xl backdrop:bg-slate-900/50"
    aria-label={task ? "Editar agendamento" : "Novo agendamento"}>
    <form onSubmit={e => void submit(e)} className="space-y-4 p-5 md:p-6">
      <header className="flex items-center justify-between"><h2 className="text-lg font-bold">{task ? "Editar agendamento" : "Novo agendamento"}</h2>
        <button type="button" aria-label="Fechar" disabled={busy} onClick={onClose}><X className="h-5 w-5" /></button></header>
      <div><p className="text-sm font-medium">Cliente</p>
        {task ? <p className="mt-1 text-sm text-slate-600">{task.contact.name}</p> : <>
          <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input className={field + " pl-9"} aria-label="Pesquisar cliente existente" value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar cliente existente" /></div>
          <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-slate-100">
            {contacts.map(c => <button key={c.id} type="button" onClick={() => setContact({ ...c, phone: "" })}
              className={"block w-full px-3 py-2 text-left text-sm hover:bg-blue-50 " + (contact?.id === c.id ? "bg-blue-50 font-semibold text-blue-700" : "")}>{c.name}</button>)}
            {!contacts.length && <p className="p-3 text-sm text-slate-500">Nenhum cliente nesta pesquisa.</p>}
          </div>
          {contact && <p className="mt-1 text-xs text-blue-700">Selecionado: {contact.name}</p>}
          {searchError && <p role="alert" className="text-sm text-rose-700">{searchError}</p>}
        </>}
      </div>
      <label className="block text-sm font-medium">Motivo ou tarefa<input required maxLength={200} className={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Retorno: Proposta em análise" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Data e horário<input required type="datetime-local" className={field} value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
        <label className="text-sm font-medium">Responsável<select aria-label="Responsável do agendamento" disabled={!data.canManage} className={field} value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
          {data.canManage && <option value="">{task ? "Sem responsável" : "Eu"}</option>}
          {data.attendants.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      </div>
      <p className="text-xs text-slate-500">Horários de Brasília · America/Sao_Paulo</p>
      <label className="block text-sm font-medium">Observações<textarea maxLength={4000} rows={3} className={field} value={note} onChange={e => setNote(e.target.value)} /></label>
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <footer className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className="rounded-xl border px-4 py-2 text-sm">Fechar</button>
        <button disabled={busy || !contact} className="flex items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Salvando…" : "Salvar agendamento"}</button></footer>
    </form>
  </dialog>;
}
