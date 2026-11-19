"use client";

import { useEffect, useState } from "react";
import { Edit3, Loader2, Plus, Trash2, X } from "lucide-react";
import clsx from "clsx";

type QuickReplyRow = {
  id: string;
  title: string;
  body: string;
  position: number;
};

export function QuickRepliesPanel({
  open,
  isAdmin,
  className,
  onClose,
  onInsert
}: {
  open: boolean;
  isAdmin: boolean;
  className?: string;
  onClose: () => void;
  onInsert: (body: string) => void;
}) {
  const [items, setItems] = useState<QuickReplyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", body: "" });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/quick-replies", {
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await response.json().catch(() => null) as { quickReplies?: QuickReplyRow[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Nao foi possivel carregar as respostas rapidas.");
      setItems(data?.quickReplies ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nao foi possivel carregar as respostas rapidas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
    else {
      setEditingId(null);
      setForm({ title: "", body: "" });
      setError("");
    }
  }, [open]);

  function startNew() {
    setEditingId("new");
    setForm({ title: "", body: "" });
    setError("");
  }

  function startEdit(item: QuickReplyRow) {
    setEditingId(item.id);
    setForm({ title: item.title, body: item.body });
    setError("");
  }

  async function save() {
    if (!isAdmin || saving) return;
    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) {
      setError("Informe titulo e mensagem.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const isNew = editingId === "new";
      const response = await fetch(
        isNew ? "/api/quick-replies" : "/api/quick-replies/" + encodeURIComponent(editingId ?? ""),
        {
          method: isNew ? "POST" : "PATCH",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body })
        }
      );
      const data = await response.json().catch(() => null) as { quickReply?: QuickReplyRow; error?: string } | null;
      if (!response.ok || !data?.quickReply) {
        throw new Error(data?.error ?? "Nao foi possivel salvar a resposta rapida.");
      }

      setItems(current =>
        isNew
          ? [...current, data.quickReply!]
          : current.map(item => item.id === data.quickReply!.id ? data.quickReply! : item)
      );
      setEditingId(null);
      setForm({ title: "", body: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nao foi possivel salvar a resposta rapida.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: QuickReplyRow) {
    if (!isAdmin || saving) return;
    if (!window.confirm(`Remover a resposta rapida "${item.title}"?`)) return;

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/quick-replies/" + encodeURIComponent(item.id), {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store"
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Nao foi possivel remover a resposta rapida.");
      setItems(current => current.filter(currentItem => currentItem.id !== item.id));
      if (editingId === item.id) {
        setEditingId(null);
        setForm({ title: "", body: "" });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nao foi possivel remover a resposta rapida.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className={clsx("z-30 w-[min(560px,calc(100vw-2rem))] min-w-0 rounded-2xl border border-line bg-white p-3 shadow-lift", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">Respostas rapidas</p>
          <p className="text-xs text-slate-500">Clique para inserir no campo e revisar antes de enviar.</p>
        </div>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <button
              type="button"
              className="inline-flex h-8 items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2.5 text-xs font-bold text-brand hover:bg-blue-100"
              onClick={startNew}
            >
              <Plus className="h-3.5 w-3.5" /> Nova
            </button>
          )}
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100" onClick={onClose} aria-label="Fechar respostas rapidas">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {editingId && isAdmin && (
        <div className="mb-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3">
          <p className="text-xs font-black uppercase tracking-wide text-brand">
            {editingId === "new" ? "Nova resposta" : "Editar resposta"}
          </p>
          <input
            className="mt-2 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-semibold text-slate-800 outline-none focus:border-brand"
            maxLength={80}
            placeholder="Titulo"
            value={form.title}
            onChange={event => setForm(current => ({ ...current, title: event.target.value }))}
          />
          <textarea
            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-brand"
            maxLength={4000}
            placeholder="Mensagem"
            value={form.body}
            onChange={event => setForm(current => ({ ...current, body: event.target.value }))}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="h-9 rounded-full border border-line bg-white px-3 text-xs font-bold text-slate-600"
              disabled={saving}
              onClick={() => { setEditingId(null); setForm({ title: "", body: "" }); }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="h-9 rounded-full bg-brand px-4 text-xs font-bold text-white disabled:opacity-50"
              disabled={saving || !form.title.trim() || !form.body.trim()}
              onClick={() => void save()}
            >
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mb-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando respostas...
        </div>
      ) : items.length ? (
        <div className="grid max-h-80 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
          {items.map(item => (
            <div key={item.id} className="group relative rounded-2xl border border-slate-200 bg-white transition hover:border-blue-200 hover:bg-blue-50">
              <button
                type="button"
                className="w-full p-3 pr-16 text-left"
                onClick={() => onInsert(item.body)}
              >
                <span className="text-xs font-black text-slate-900">{item.title}</span>
                <span className="mt-1 block line-clamp-3 text-xs leading-5 text-slate-500">{item.body}</span>
              </button>
              {isAdmin && (
                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-brand"
                    title="Editar"
                    onClick={() => startEdit(item)}
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-rose-600"
                    title="Excluir"
                    onClick={() => void remove(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          Nenhuma resposta rapida cadastrada.
        </div>
      )}
    </div>
  );
}
