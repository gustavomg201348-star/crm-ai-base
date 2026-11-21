"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createTaskPages, hasTaskListFields, type TaskPageData } from "@/lib/tasks-page-state";

export function useTaskPages<T extends { id: string }>(query: string | null, enabled = true) {
  const controller = useMemo(() => createTaskPages<T>(async (cursor, signal) => {
    const params = new URLSearchParams(query ?? "");
    params.set("limit", "100");
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/tasks?${params}`, { signal });
    if (!response.ok) throw new Error(response.status === 400 && cursor
      ? "A paginacao expirou ou ficou invalida. Atualize a lista."
      : "Nao foi possivel carregar os agendamentos. Tente novamente.");
    return await response.json() as TaskPageData<T>;
  }, hasTaskListFields), [query]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  useEffect(() => {
    if (!enabled || query === null) return;
    void controller.refresh();
    return controller.cancel;
  }, [controller, enabled, query]);
  return { ...state, prepend: controller.prepend, remove: controller.remove, replace: controller.replace,
    refresh: controller.refresh, loadMore: controller.loadMore };
}
