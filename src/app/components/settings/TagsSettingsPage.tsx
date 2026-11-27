"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { Tags, Plus, Edit3, Trash2, X, Check, Loader2 } from "lucide-react";
import type { SettingsTagRow } from "./settings-types";
const tagColorPalette = [
  { label: "Fechado", color: "#16a34a", textColor: "#ffffff" },
  { label: "Negociacao", color: "#f59e0b", textColor: "#111827" },
  { label: "Problema", color: "#dc2626", textColor: "#ffffff" },
  { label: "CLT", color: "#2563eb", textColor: "#ffffff" },
  { label: "FGTS", color: "#7c3aed", textColor: "#ffffff" },
  { label: "Retomar", color: "#0f766e", textColor: "#ffffff" },
  { label: "Documento", color: "#475569", textColor: "#ffffff" },
];

type TagFormState = {
  name: string;
  color: string;
  textColor: string;
  category: string;
  isActive: boolean;
};

function emptyTagForm(): TagFormState {
  return {
    name: "",
    color: "#2563eb",
    textColor: "#ffffff",
    category: "",
    isActive: true,
  };
}

export function TagsSettingsPage({
  tags,
  loading,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  renderTag,
  formatDate,
}: {
  renderTag: (tag: SettingsTagRow) => React.ReactNode;
  formatDate: (date: string) => string;
  tags: SettingsTagRow[];
  loading: boolean;
  onCreateTag: (payload: {
    name: string;
    color: string;
    textColor?: string;
    category?: string | null;
    isActive?: boolean;
  }) => Promise<void>;
  onUpdateTag: (
    id: string,
    payload: {
      name?: string;
      color?: string;
      textColor?: string;
      category?: string | null;
      isActive?: boolean;
    },
  ) => Promise<void>;
  onDeleteTag: (id: string) => Promise<void>;
}) {
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingTag, setEditingTag] = useState<SettingsTagRow | null>(null);
  const [toast, setToast] = useState("");
  const [actionError, setActionError] = useState("");
  const activeCount = tags.filter((tag) => tag.isActive).length;
  const inactiveCount = tags.length - activeCount;

  async function deactivateTag(tag: SettingsTagRow) {
    if (tag.protectedAutomation) return;
    if (!window.confirm(`Desativar a tag "${tag.name}"?`)) return;
    try {
      await onDeleteTag(tag.id);
      setToast("Tag desativada.");
    } catch {
      setActionError("Não foi possível desativar a tag.");
    }
  }

  async function activateTag(tag: SettingsTagRow) {
    try {
      await onUpdateTag(tag.id, { isActive: true });
      setToast("Tag ativada.");
    } catch {
      setActionError("Não foi possível ativar a tag.");
    }
  }

  return (
    <section className="space-y-5">
      {actionError && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
        >
          {actionError}
        </p>
      )}
      <div className="flex flex-col gap-3 rounded-[1.5rem] border border-line/80 bg-white p-5 shadow-soft md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
            Relacionamento
          </p>
          <h3 className="mt-1 text-2xl font-bold text-slate-950">Tags</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Organize conversas por perfil, produto, etapa comercial e proximo
            passo.
          </p>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-soft hover:bg-blue-700"
          onClick={() => {
            setEditingTag(null);
            setModalMode("create");
          }}
          type="button"
        >
          <Plus className="h-4 w-4" />
          Nova tag
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Total de tags</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">
            {tags.length}
          </p>
        </div>
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Ativas</p>
          <p className="mt-2 text-2xl font-bold text-emerald-600">
            {activeCount}
          </p>
        </div>
        <div className="rounded-2xl border border-line/80 bg-white p-4 shadow-soft">
          <p className="text-sm text-slate-500">Inativas</p>
          <p className="mt-2 text-2xl font-bold text-slate-500">
            {inactiveCount}
          </p>
        </div>
      </div>

      {toast && (
        <div className="flex items-center justify-between rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {toast}
          <button
            className="text-emerald-800"
            onClick={() => setToast("")}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-[1.5rem] border border-line/80 bg-white shadow-soft">
        <div className="hidden grid-cols-[1.4fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr] gap-4 border-b border-line/70 bg-slate-50 px-5 py-3 text-xs font-bold uppercase tracking-wide text-slate-400 md:grid">
          <span>Tag</span>
          <span>Categoria</span>
          <span>Status</span>
          <span>Conversas</span>
          <span>Criada</span>
          <span className="text-right">Acoes</span>
        </div>
        <div className="divide-y divide-line/70">
          {loading && (
            <div className="space-y-3 p-5">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="h-16 animate-pulse rounded-2xl bg-slate-100"
                />
              ))}
            </div>
          )}
          {!loading && tags.length === 0 && (
            <div className="grid place-items-center p-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-brand">
                <Tags className="h-5 w-5" />
              </div>
              <p className="mt-3 font-semibold text-slate-900">
                Nenhuma tag criada ainda.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Crie tags como CLT, FGTS, Proposta enviada ou Retomar hoje.
              </p>
            </div>
          )}
          {!loading &&
            tags.map((tag) => (
              <div
                key={tag.id}
                className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1.4fr_1fr_0.8fr_0.7fr_0.8fr_0.8fr] md:items-center"
              >
                <div className="min-w-0">
                  {renderTag(tag)}
                  {tag.protectedAutomation && (
                    <p className="mt-1 text-xs text-blue-700">
                      Automação SEM MARGEM · protegida
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    Fundo {tag.color} · Texto {tag.textColor || "#ffffff"}
                  </p>
                </div>
                <p className="text-slate-600">
                  {tag.category || "Sem categoria"}
                </p>
                <span
                  className={clsx(
                    "w-fit rounded-full px-2.5 py-1 text-xs font-bold",
                    tag.isActive
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500",
                  )}
                >
                  {tag.isActive ? "Ativa" : "Inativa"}
                </span>
                <p className="font-semibold text-slate-800">
                  {tag.conversationCount}
                </p>
                <p className="text-slate-500">
                  {tag.createdAt ? formatDate(tag.createdAt) : "-"}
                </p>
                <div className="flex justify-start gap-2 md:justify-end">
                  <button
                    className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-600 hover:bg-slate-50"
                    onClick={() => {
                      setEditingTag(tag);
                      setModalMode("edit");
                    }}
                    title="Editar"
                    type="button"
                  >
                    <Edit3 className="h-4 w-4" />
                  </button>
                  {tag.isActive ? (
                    <button
                      disabled={tag.protectedAutomation}
                      className="grid h-9 w-9 place-items-center rounded-full border border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={() => void deactivateTag(tag)}
                      title={
                        tag.protectedAutomation
                          ? "Protegida pela automação SEM MARGEM"
                          : "Desativar"
                      }
                      type="button"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      className="grid h-9 w-9 place-items-center rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => void activateTag(tag)}
                      title="Ativar"
                      type="button"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {modalMode && (
        <TagEditorModal
          mode={modalMode}
          tag={editingTag}
          onClose={() => setModalMode(null)}
          onSubmit={async (payload) => {
            if (modalMode === "edit" && editingTag) {
              await onUpdateTag(editingTag.id, payload);
              setToast("Tag atualizada.");
            } else {
              await onCreateTag(payload);
              setToast("Tag criada.");
            }
            setModalMode(null);
          }}
        />
      )}
    </section>
  );
}

function TagEditorModal({
  mode,
  tag,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit";
  tag: SettingsTagRow | null;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    color: string;
    textColor: string;
    category: string | null;
    isActive: boolean;
  }) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const [form, setForm] = useState<TagFormState>(() =>
    tag
      ? {
          name: tag.name,
          color: tag.color,
          textColor: tag.textColor || "#ffffff",
          category: tag.category || "",
          isActive: tag.isActive,
        }
      : emptyTagForm(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Informe o nome da tag.");
      return;
    }

    setSaving(true);
    setError("");
    await onSubmit({
      name: form.name.trim(),
      color: form.color,
      textColor: form.textColor,
      category: form.category.trim() || null,
      isActive: form.isActive,
    });
    setSaving(false);
  }

  return (
    <dialog
      ref={dialog}
      aria-label={mode === "edit" ? "Editar tag" : "Criar tag"}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-[1.5rem] bg-white p-0 shadow-soft backdrop:bg-slate-950/30"
    >
      <form
        className="w-full max-w-lg overflow-hidden rounded-[1.5rem] border border-line bg-white shadow-soft"
        onSubmit={submit}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line/70 p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
              Tags
            </p>
            <h3 className="mt-1 text-xl font-bold text-slate-950">
              {mode === "edit" ? "Editar tag" : "Criar tag"}
            </h3>
          </div>
          <button
            className="grid h-9 w-9 place-items-center rounded-full border border-line text-slate-500 hover:bg-slate-50"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {error}
            </div>
          )}

          <div className="rounded-2xl border border-line bg-slate-50 p-4">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">
              Preview
            </p>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: form.color, color: form.textColor }}
            >
              {form.name || "Cliente fechado"}
            </span>
          </div>

          <label className="block text-sm font-semibold text-slate-800">
            Nome da tag
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              placeholder="Ex: Cliente fechado"
              readOnly={tag?.protectedAutomation}
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
            />
          </label>
          {tag?.protectedAutomation && (
            <p className="text-xs text-blue-700">
              Nome e ativação são preservados para proteger os agendamentos SEM
              MARGEM.
            </p>
          )}

          <label className="block text-sm font-semibold text-slate-800">
            Categoria opcional
            <input
              className="mt-2 h-11 w-full rounded-2xl border border-line px-3 text-sm outline-none focus:border-blue-200"
              placeholder="Ex: Produto, Status, Follow-up"
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
            />
          </label>

          <div>
            <p className="text-sm font-semibold text-slate-800">
              Paleta rapida
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagColorPalette.map((option) => (
                <button
                  key={option.label}
                  className="rounded-full border border-line px-2.5 py-1 text-xs font-semibold hover:bg-slate-50"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      color: option.color,
                      textColor: option.textColor,
                    }))
                  }
                  type="button"
                >
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm font-semibold text-slate-800">
              Cor de fundo
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line px-2"
                type="color"
                value={form.color}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
              />
            </label>
            <label className="text-sm font-semibold text-slate-800">
              Cor do texto
              <input
                className="mt-2 h-11 w-full rounded-2xl border border-line px-2"
                type="color"
                value={form.textColor}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    textColor: event.target.value,
                  }))
                }
              />
            </label>
          </div>

          <label className="flex items-center justify-between rounded-2xl border border-line px-3 py-3 text-sm font-semibold text-slate-800">
            Tag ativa
            <input
              checked={form.isActive}
              disabled={tag?.protectedAutomation && form.isActive}
              className="h-4 w-4"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  isActive: event.target.checked,
                }))
              }
              type="checkbox"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line/70 bg-slate-50 px-5 py-4">
          <button
            className="h-10 rounded-full border border-line bg-white px-4 text-sm font-semibold text-slate-600"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white disabled:bg-slate-300"
            disabled={saving}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar tag
          </button>
        </div>
      </form>
    </dialog>
  );
}
