export type TaskPageData<T> = { tasks: T[] } & (
  { hasMore: boolean; nextCursor: string | null } | { hasMore?: never; nextCursor?: never }
);
type Item = { id: string };
type State<T> = {
  items: T[]; loading: boolean; loadingMore: boolean; error: string;
  hasMore: boolean; nextCursor: string | null;
  legacy: boolean;
};

export function hasTaskListFields(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  const contact = task.contact as Record<string, unknown> | null | undefined;
  const assignee = task.assignee as Record<string, unknown> | null | undefined;
  return typeof task.title === "string" && typeof task.status === "string" &&
    typeof task.dueAt === "string" && Number.isFinite(Date.parse(task.dueAt)) &&
    !!contact && typeof contact.id === "string" && typeof contact.name === "string" && typeof contact.phone === "string" &&
    (assignee === null || (!!assignee && typeof assignee.name === "string")) &&
    (task.note == null || typeof task.note === "string");
}

export function createTaskPages<T extends Item>(
  fetchPage: (cursor: string | null, signal: AbortSignal) => Promise<TaskPageData<T>>,
  validItem: (item: T) => boolean = () => true
) {
  let state: State<T> = { items: [], loading: false, loadingMore: false, error: "", hasMore: false, nextCursor: null, legacy: false };
  let generation = 0;
  let request: AbortController | undefined;
  let edits = new Map<string, T | null>();
  let refreshEdits: Map<string, T | null> | undefined;
  let refreshPrepends: Set<string> | undefined;
  const recordEdit = (id: string, item: T | null) => {
    edits.set(id, item);
    refreshEdits?.set(id, item);
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<State<T>>) => {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };
  async function load(append: boolean) {
    if (append && (state.loading || state.loadingMore || !state.hasMore)) return;
    const cursor = append ? state.nextCursor : null;
    const ticket = ++generation;
    request?.abort();
    const active = new AbortController(); request = active;
    const pendingEdits = append ? undefined : new Map<string, T | null>();
    const pendingPrepends = append ? undefined : new Set<string>();
    refreshEdits = pendingEdits;
    refreshPrepends = pendingPrepends;
    publish({ loading: !append, loadingMore: append, error: "" });
    try {
      const page = await fetchPage(cursor, active.signal);
      if (ticket !== generation) return;
      const legacy = !!page && typeof page === "object" && !("hasMore" in page) && !("nextCursor" in page);
      if (!page || !Array.isArray(page.tasks) || page.tasks.some(task => !task || typeof task.id !== "string" || !task.id || !validItem(task)) ||
          (!legacy && (typeof page.hasMore !== "boolean" || (page.hasMore
            ? typeof page.nextCursor !== "string" || !page.nextCursor.trim() || page.nextCursor === cursor
            : page.nextCursor !== null)))) {
        throw new Error("Resposta de paginacao invalida. Atualize a lista.");
      }
      if (legacy && append) throw new Error("A API nao oferece paginacao nesta versao. Atualize a lista.");
      if (pendingEdits) edits = pendingEdits;
      const retained = append ? state.items : state.items.filter(item => pendingPrepends?.has(item.id));
      const merged = new Map(retained.map(item => [item.id, item]));
      for (const item of page.tasks) {
        const edited = edits.get(item.id);
        if (edited === null) continue;
        if (!merged.has(item.id)) merged.set(item.id, edited ?? item);
      }
      publish({ items: Array.from(merged.values()), legacy, hasMore: page.hasMore === true,
        nextCursor: page.hasMore ? page.nextCursor : null });
    } catch (error) {
      if (ticket === generation && !active.signal.aborted) {
        publish({ error: error instanceof Error ? error.message : "Nao foi possivel carregar os agendamentos." });
      }
    } finally {
      if (ticket === generation) {
        refreshEdits = undefined;
        refreshPrepends = undefined;
        publish({ loading: false, loadingMore: false });
      }
    }
  }
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => load(false),
    loadMore: () => load(true),
    cancel: () => { generation++; request?.abort(); refreshEdits = undefined; refreshPrepends = undefined; publish({ loading: false, loadingMore: false }); },
    remove: (id: string) => { recordEdit(id, null); publish({ items: state.items.filter(item => item.id !== id) }); },
    replace: (item: T) => { recordEdit(item.id, item); publish({ items: state.items.map(previous => previous.id === item.id ? item : previous) }); },
    prepend: (item: T) => { refreshPrepends?.add(item.id); recordEdit(item.id, item); publish({ items: [item, ...state.items.filter(previous => previous.id !== item.id)] }); }
  };
}
