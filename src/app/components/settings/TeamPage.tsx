"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Search, UsersRound, X } from "lucide-react";
import {
  availabilityLabels,
  settingsRequest,
  type TeamUser,
  type TeamRole,
  type Availability,
} from "./settings-types";
const roles: Record<TeamRole, string> = {
  ADMIN: "Administrador da empresa",
  SUPERVISOR: "Supervisor",
  AGENT: "Agente",
};
const field =
  "h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500";
export function TeamPage({
  actor,
  onChanged,
}: {
  actor: { id: string; role: TeamRole };
  onChanged: () => Promise<void>;
}) {
  const [users, setUsers] = useState<TeamUser[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [tab, setTab] = useState<"users" | "permissions" | "availability">(
      "users",
    ),
    [search, setSearch] = useState(""),
    [role, setRole] = useState("ALL"),
    [status, setStatus] = useState("ALL");
  const [editing, setEditing] = useState<{ user: TeamUser | null } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const mutation = useRef(false),
    generation = useRef(0);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await settingsRequest("/api/settings/users", "GET");
      if (token === generation.current) setUsers(result.users);
    } catch (e) {
      if (token === generation.current) {
        setUsers([]);
        setError(
          e instanceof Error
            ? e.message
            : "Não foi possível carregar a equipe.",
        );
      }
    } finally {
      if (token === generation.current) setLoading(false);
    }
  }, []);
  const invalidateReads = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    void load();
    return invalidateReads;
  }, [load, invalidateReads]);
  useEffect(() => {
    const run = () => {
      if (!document.hidden && !mutation.current && !editing) void load();
    };
    const timer = setInterval(run, 30000);
    window.addEventListener("focus", run);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", run);
    };
  }, [load, editing]);
  async function change(user: TeamUser, method: string, body?: unknown) {
    if (mutation.current) return;
    if (
      method === "DELETE" &&
      !confirm(
        "Excluir esta conta? Esta ação não é uma pausa. Vínculos existentes podem impedir a exclusão.",
      )
    )
      return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await settingsRequest("/api/settings/users/" + user.id, method, body);
      await load();
      await onChanged();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível alterar a conta.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  async function presence(user: TeamUser, next: Availability) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await settingsRequest("/api/users/" + user.id + "/status", "PATCH", {
        status: next,
      });
      await load();
      await onChanged();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível alterar a disponibilidade.",
      );
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }
  const filtered = users.filter(
    (u) =>
      (role === "ALL" || u.role === role) &&
      (status === "ALL" || u.availabilityStatus === status) &&
      `${u.name} ${u.email}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  const metrics = [
    { label: "Usuários", value: users.length },
    {
      label: "Disponíveis",
      value: users.filter((u) => u.availabilityStatus === "ONLINE").length,
    },
    {
      label: "Pausados",
      value: users.filter((u) => u.availabilityStatus === "PAUSED").length,
    },
    {
      label: "Atendimentos atribuídos",
      value: users.reduce((n, u) => n + u.openConversations, 0),
    },
  ];
  return (
    <div className="space-y-4" aria-label="Equipe e Permissões">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#0b2445] p-5 text-white">
        <div>
          <h1 className="text-xl font-bold">Equipe e Permissões</h1>
          <p className="mt-1 text-sm text-blue-100">
            Usuários, responsabilidades e disponibilidade operacional
          </p>
        </div>
        {actor.role === "ADMIN" && (
          <button
            type="button"
            onClick={() => setEditing({ user: null })}
            className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2 text-sm font-semibold"
          >
            <Plus className="h-4 w-4" />
            Novo usuário
          </button>
        )}
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl border bg-white p-4">
            <p className="text-xs text-slate-500">{m.label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">
              {loading || error ? "—" : m.value}
            </p>
          </div>
        ))}
      </div>
      <div
        role="tablist"
        aria-label="Gerenciamento da equipe"
        className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1"
      >
        {(
          [
            ["users", "Usuários"],
            ["permissions", "Permissões"],
            ["availability", "Disponibilidade"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={
              "rounded-lg px-4 py-2 text-sm " +
              (tab === id
                ? "bg-white font-semibold text-blue-700 shadow-sm"
                : "text-slate-600")
            }
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700"
        >
          {error}
        </p>
      )}
      {tab === "permissions" ? (
        <section className="space-y-3 rounded-2xl border bg-white p-5">
          <h2 className="font-bold">Responsabilidades dos perfis</h2>
          <p className="text-sm text-slate-500">
            As permissões são verificadas no servidor. Não há permissões
            granulares adicionais.
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {(
              [
                [
                  "ADMIN",
                  "Gerencia usuários da própria empresa, funções, tags, etapas, origens e disponibilidade.",
                ],
                [
                  "SUPERVISOR",
                  "Supervisiona a operação e gerencia disponibilidade, tags e etapas. Não cadastra usuários nem muda funções.",
                ],
                [
                  "AGENT",
                  "Atende as conversas permitidas, usa a própria disponibilidade e acessa suas tarefas na Agenda. Não gerencia a equipe.",
                ],
              ] as const
            ).map(([id, description]) => (
              <article key={id} className="rounded-xl border p-4">
                <h3 className="font-semibold">{roles[id]}</h3>
                <p className="mt-2 text-sm text-slate-600">{description}</p>
              </article>
            ))}
          </div>
          <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-800">
            Administrador da plataforma é um vínculo separado, controlado no
            servidor. Selecionar o perfil ADMIN não concede acesso a outras
            empresas ou administração da plataforma.
          </p>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 rounded-2xl border bg-white p-4">
            <div className="relative min-w-40 flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                aria-label="Pesquisar equipe"
                placeholder="Pesquisar nome ou e-mail"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={field + " w-full pl-9"}
              />
            </div>
            <select
              aria-label="Perfil da equipe"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={field}
            >
              <option value="ALL">Todos os perfis</option>
              {Object.entries(roles).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Disponibilidade da equipe"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className={field}
            >
              <option value="ALL">Todas as disponibilidades</option>
              {Object.entries(availabilityLabels).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={loading}
              onClick={() => void load()}
              className={field + " flex items-center gap-2"}
            >
              <RefreshCw className="h-4 w-4" />
              Atualizar
            </button>
          </div>
          {loading ? (
            <p role="status" className="p-8 text-center text-sm text-slate-500">
              Carregando equipe…
            </p>
          ) : !error && !filtered.length ? (
            <div className="rounded-2xl border border-dashed p-10 text-center text-slate-500">
              <UsersRound className="mx-auto mb-2 h-8 w-8" />
              Nenhum usuário para estes filtros.
            </div>
          ) : (
            !error && (
              <div className="divide-y overflow-hidden rounded-2xl border bg-white">
                {filtered.map((u) => (
                  <article
                    key={u.id}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <h2 className="break-words font-semibold text-slate-900">
                        {u.name}
                        {u.id === actor.id ? " · Você" : ""}
                      </h2>
                      <p className="break-all text-sm text-slate-500">
                        {u.email}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        {u.platformAdmin
                          ? "Administrador da plataforma"
                          : roles[u.role]}{" "}
                        · Conta cadastrada
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {u.openConversations} atendimento(s) aberto(s) · Última
                        presença:{" "}
                        {u.lastSeenAt
                          ? new Date(u.lastSeenAt).toLocaleString("pt-BR", {
                              timeZone: "America/Sao_Paulo",
                            })
                          : "não registrada"}
                      </p>
                    </div>
                <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                      <select
                        aria-label={"Disponibilidade de " + u.name}
                        disabled={busy}
                        value={u.availabilityStatus}
                        onChange={(e) =>
                          void presence(u, e.target.value as Availability)
                        }
                        className={field}
                      >
                        {Object.entries(availabilityLabels).map(
                          ([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                      {tab === "users" && u.canManage && (
                        <>
                          <button
                            disabled={busy}
                            type="button"
                            onClick={() => setEditing({ user: u })}
                            className="text-sm font-semibold text-blue-700"
                          >
                            Editar
                          </button>
                          <button
                            disabled={busy || u.id === actor.id}
                            type="button"
                            onClick={() => void change(u, "DELETE")}
                            className="text-sm text-rose-600 disabled:opacity-40"
                          >
                            Excluir conta
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )
          )}
          <p className="text-xs text-slate-500">
            Disponibilidade controla o recebimento de atendimentos conforme a
            distribuição atual; não bloqueia login. O sistema não possui
            desativação reversível de conta. Exclusão respeita os vínculos
            existentes.
          </p>
        </>
      )}
      {editing && (
        <TeamEditor
          user={editing.user}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
            await onChanged();
          }}
        />
      )}
    </div>
  );
}
function TeamEditor({
  user,
  onClose,
  onSaved,
}: {
  user: TeamUser | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    saving = useRef(false);
  const [name, setName] = useState(user?.name ?? ""),
    [email, setEmail] = useState(user?.email ?? ""),
    [role, setRole] = useState<TeamRole>(user?.role ?? "AGENT"),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await settingsRequest(
        "/api/settings/users" + (user ? "/" + user.id : ""),
        user ? "PATCH" : "POST",
        { name, email, role, ...(password ? { password } : {}) },
      );
      setPassword("");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-label={user ? "Editar usuário" : "Novo usuário"}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50"
    >
      <form onSubmit={(e) => void submit(e)} className="space-y-4 p-6">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {user ? "Editar usuário" : "Novo usuário"}
          </h2>
          <button
            disabled={busy}
            type="button"
            aria-label="Fechar"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <label className="block text-sm font-medium">
          Nome
          <input
            required
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={field + " mt-1 w-full"}
          />
        </label>
        <label className="block text-sm font-medium">
          E-mail
          <input
            required
            type="email"
            maxLength={254}
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field + " mt-1 w-full"}
          />
        </label>
        <label className="block text-sm font-medium">
          Perfil
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TeamRole)}
            className={field + " mt-1 w-full"}
          >
            {Object.entries(roles).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {user ? "Nova senha (opcional)" : "Senha inicial"}
          <input
            required={!user}
            type="password"
            minLength={6}
            maxLength={1024}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field + " mt-1 w-full"}
          />
        </label>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
        <footer className="flex justify-end gap-2">
          <button
            disabled={busy}
            type="button"
            onClick={onClose}
            className={field}
          >
            Cancelar
          </button>
          <button
            disabled={busy}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar usuário"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
