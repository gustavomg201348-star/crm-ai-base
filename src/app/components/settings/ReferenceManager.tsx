"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { settingsRequest } from "./settings-types";
type Item = {
  id: string;
  name: string;
  color?: string | null;
  position?: number;
};
export function ReferenceManager({
  kind,
  items,
  onChanged,
}: {
  kind: "stages" | "origins";
  items: Item[];
  onChanged(): Promise<void>;
}) {
  const [open, setOpen] = useState(kind === "origins"),
    [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState(""),
    [color, setColor] = useState("#0f766e"),
    [position, setPosition] = useState(1);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saving = useRef(false);
  const title = kind === "stages" ? "Etapas do funil" : "Origens dos leads";
  useEffect(() => {
    if (!editing && !name)
      setPosition(Math.max(0, ...items.map((item) => item.position ?? 0)) + 1);
  }, [items, editing, name]);
  async function mutate(id?: string, removing = false) {
    if (saving.current) return;
    if (
      removing &&
      !confirm(
        "Remover este registro? Os vínculos existentes serão tratados pelas regras atuais do sistema.",
      )
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await settingsRequest(
        "/api/settings/" + kind + (id ? "/" + id : ""),
        removing ? "DELETE" : id ? "PATCH" : "POST",
        removing
          ? undefined
          : { name, ...(kind === "stages" ? { color, position } : {}) },
      );
      await onChanged();
      setEditing(null);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      aria-label={title}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <span className="block font-bold text-slate-900">{title}</span>
          <span className="text-xs text-slate-500">
            {kind === "stages"
              ? "Configuração administrativa do Kanban, contatos e propostas"
              : "Dados compartilhados com contatos, filtros e Dashboard"}
          </span>
        </span>
        <ChevronDown className="h-4 w-4" />
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
            >
              {error}
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(editing ?? undefined);
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="min-w-40 flex-1 text-xs font-medium">
              Nome
              <input
                aria-label={
                  kind === "stages" ? "Nome da etapa" : "Nome da origem"
                }
                required
                maxLength={150}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-10 w-full rounded-xl border px-3 text-sm"
              />
            </label>
            {kind === "stages" && (
              <>
                <label className="text-xs">
                  Cor
                  <input
                    aria-label="Cor da etapa"
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="mt-1 block h-10 w-16 rounded-xl border p-1"
                  />
                </label>
                <label className="text-xs">
                  Posição
                  <input
                    aria-label="Posição da etapa"
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={position}
                    onChange={(e) => setPosition(Number(e.target.value))}
                    className="mt-1 block h-10 w-20 rounded-xl border px-2"
                  />
                </label>
              </>
            )}
            <button
              disabled={busy}
              className="flex h-10 items-center gap-1 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {editing ? "Salvar" : "Adicionar"}
            </button>
            {editing && (
              <button
                disabled={busy}
                type="button"
                onClick={() => {
                  setEditing(null);
                  setName("");
                }}
                className="h-10 px-3 text-sm"
              >
                Cancelar edição
              </button>
            )}
          </form>
          <div className="divide-y rounded-xl border border-slate-100">
            {items
              .slice()
              .sort(
                (a, b) =>
                  (a.position ?? 0) - (b.position ?? 0) ||
                  a.name.localeCompare(b.name),
              )
              .map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {item.color && (
                      <span
                        className="h-3 w-3 rounded"
                        style={{ backgroundColor: item.color }}
                      />
                    )}
                    {item.name}
                    {kind === "stages" && (
                      <span className="text-xs text-slate-400">
                        Posição {item.position}
                      </span>
                    )}
                  </span>
                  <div className="flex gap-3">
                    <button
                      disabled={busy}
                      type="button"
                      className="text-blue-700"
                      onClick={() => {
                        setEditing(item.id);
                        setName(item.name);
                        setColor(item.color ?? "#0f766e");
                        setPosition(item.position ?? 1);
                      }}
                    >
                      Editar
                    </button>
                    <button
                      disabled={busy}
                      type="button"
                      className="text-rose-600"
                      onClick={() => void mutate(item.id, true)}
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
            {!items.length && (
              <p className="p-4 text-sm text-slate-500">
                Nenhum registro cadastrado.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
