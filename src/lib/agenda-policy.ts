import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";

export type AgendaView = "day" | "week" | "month" | "list";
export type AgendaStatus = "ALL" | "PENDING" | "DONE" | "CANCELLED";
export type AgendaOrigin = "ALL" | "MANUAL" | "AUTOMATIC" | "UNKNOWN";
export const agendaTimezone = "America/Sao_Paulo";
export const managesTasks = (actor: SessionUser) => actor.role === "ADMIN" || actor.role === "SUPERVISOR";
export const taskScope = (actor: SessionUser): Prisma.TaskWhereInput => ({
  companyId: actor.companyId, contact: { companyId: actor.companyId }, ...(!managesTasks(actor) ? { assigneeId: actor.id } : {}),
});
export function taskOrigin(id: string): Exclude<AgendaOrigin, "ALL"> {
  if (/^sem-margem-[a-f0-9]{32}$/.test(id)) return "AUTOMATIC";
  if (/^agenda-[a-f0-9]{64}$/.test(id)) return "MANUAL";
  return "UNKNOWN";
}
export function saoPauloDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: agendaTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function shiftDate(date: string, days: number) {
  const value = new Date(date + "T12:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function localDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().slice(0, 10) !== date) throw new Error("INVALID_PERIOD");
  return new Date(date + "T00:00:00-03:00");
}
export function agendaPeriod(date: string, view: AgendaView) {
  localDay(date);
  let from = date, to = shiftDate(date, 1);
  if (view === "week") {
    const weekday = new Date(date + "T12:00:00Z").getUTCDay();
    from = shiftDate(date, -(weekday === 0 ? 6 : weekday - 1));
    to = shiftDate(from, 7);
  } else if (view === "month") {
    from = date.slice(0, 7) + "-01";
    const next = new Date(from + "T12:00:00Z");
    next.setUTCMonth(next.getUTCMonth() + 1);
    to = next.toISOString().slice(0, 10);
  }
  return { from, to };
}
export type AgendaFilters = { from: Date; to: Date; search: string; assigneeId: string; status: AgendaStatus;
  type: "ALL" | "RETURN" | "TASK"; origin: AgendaOrigin; cursor: { dueAt: string; id: string } | null };
export function parseAgendaFilters(params: URLSearchParams): AgendaFilters {
  const from = new Date(params.get("from") ?? ""), to = new Date(params.get("to") ?? "");
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to
    || to.getTime() - from.getTime() > 367 * 86400000) throw new Error("INVALID_PERIOD");
  const status = params.get("status") ?? "ALL", type = params.get("type") ?? "ALL", origin = params.get("origin") ?? "ALL";
  if (!["ALL", "PENDING", "DONE", "CANCELLED"].includes(status) || !["ALL", "RETURN", "TASK"].includes(type)
    || !["ALL", "MANUAL", "AUTOMATIC", "UNKNOWN"].includes(origin)) throw new Error("INVALID_FILTER");
  let cursor = null;
  if (params.get("cursor")) {
    try {
      const parsed = JSON.parse(params.get("cursor")!);
      if (typeof parsed.id !== "string" || parsed.id.length > 150 || typeof parsed.dueAt !== "string"
        || new Date(parsed.dueAt).toISOString() !== parsed.dueAt) throw Error();
      cursor = { id: parsed.id, dueAt: parsed.dueAt };
    } catch { throw new Error("INVALID_CURSOR"); }
  }
  return { from, to, status: status as AgendaStatus, type: type as AgendaFilters["type"], origin: origin as AgendaOrigin,
    search: (params.get("search") ?? "").trim().slice(0, 100), assigneeId: (params.get("assigneeId") ?? "").slice(0, 128), cursor };
}
export function agendaWhere(actor: SessionUser, filters: AgendaFilters): Prisma.TaskWhereInput {
  const clauses: Prisma.TaskWhereInput[] = [taskScope(actor), { dueAt: { gte: filters.from, lt: filters.to } }];
  if (filters.assigneeId) clauses.push({ assigneeId: filters.assigneeId });
  if (filters.status !== "ALL") clauses.push({ status: filters.status });
  if (filters.search) clauses.push({ contact: { companyId: actor.companyId, name: { contains: filters.search } } });
  if (filters.type !== "ALL") clauses.push(filters.type === "RETURN" ? { title: { startsWith: "Retorno:" } } : { NOT: { title: { startsWith: "Retorno:" } } });
  if (filters.origin === "MANUAL") clauses.push({ id: { startsWith: "agenda-" } });
  if (filters.origin === "AUTOMATIC") clauses.push({ id: { startsWith: "sem-margem-" } });
  if (filters.origin === "UNKNOWN") clauses.push({ NOT: { OR: [{ id: { startsWith: "agenda-" } }, { id: { startsWith: "sem-margem-" } }] } });
  return { AND: clauses };
}
