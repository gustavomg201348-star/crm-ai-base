import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { SessionUser } from "./auth";
import { createActivity } from "./activities";
import { taskInclude, mapTask } from "./tasks";
import { agendaWhere, localDay, managesTasks, saoPauloDate, shiftDate, taskOrigin, taskScope, type AgendaFilters } from "./agenda-policy";

type Db = Pick<PrismaClient, "$transaction">;
export class AgendaError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT", readonly status = 400) { super(code); }
}
const deny = (code: ConstructorParameters<typeof AgendaError>[0], status = 400): never => { throw new AgendaError(code, status); };
export async function listAgenda(db: Db, actor: SessionUser, filters: AgendaFilters) {
  return db.$transaction(async tx => {
    const where = agendaWhere(actor, filters);
    const today = localDay(saoPauloDate()), tomorrow = localDay(shiftDate(saoPauloDate(today), 1)), now = new Date();
    const pageWhere: Prisma.TaskWhereInput = filters.cursor ? { AND: [where, { OR: [
      { dueAt: { gt: new Date(filters.cursor.dueAt) } }, { dueAt: new Date(filters.cursor.dueAt), id: { gt: filters.cursor.id } },
    ] }] } : where;
    const rows = await tx.task.findMany({ where: pageWhere, include: taskInclude, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: 51 });
    const count = (condition: Prisma.TaskWhereInput) => tx.task.count({ where: { AND: [where, condition] } });
    const [total, todayCount, overdue, upcoming, completed, attendants] = await Promise.all([
      count({}), count({ status: "PENDING", dueAt: { gte: today, lt: tomorrow } }),
      count({ status: "PENDING", dueAt: { lt: now } }), count({ status: "PENDING", dueAt: { gte: tomorrow } }),
      count({ status: "DONE" }),
      tx.user.findMany({ where: { companyId: actor.companyId, ...(!managesTasks(actor) ? { id: actor.id } : {}),
        role: { in: ["ADMIN", "SUPERVISOR", "AGENT"] } }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 500 }),
    ]);
    const page = rows.slice(0, 50), last = page.at(-1);
    return { tasks: page.map(task => ({ ...mapTask(task), origin: taskOrigin(task.id) })), total, attendants,
      canManage: managesTasks(actor), canExport: managesTasks(actor), counters: { today: todayCount, overdue, upcoming, completed },
      nextCursor: rows.length > 50 && last ? JSON.stringify({ id: last.id, dueAt: last.dueAt.toISOString() }) : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export function contactSelection(actor: SessionUser, search: string): Prisma.ContactWhereInput {
  return { companyId: actor.companyId, archivedAt: null, name: { contains: search.slice(0, 100) },
    ...(!managesTasks(actor) ? { OR: [{ ownerId: actor.id }, { conversations: { some: { agentId: actor.id } } }] } : {}) };
}
type Command = { contactId?: unknown; title?: unknown; note?: unknown; dueAt?: unknown; assigneeId?: unknown;
  status?: unknown; expectedUpdatedAt?: unknown };
function text(value: unknown, max: number, optional = false): string {
  if (optional && (value === null || value === undefined)) return "";
  if (typeof value !== "string" || value.trim().length > max || !optional && !value.trim()) return deny("INVALID_REQUEST");
  return value.trim();
}
function parseCommand(value: unknown, creating: boolean) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return deny("INVALID_REQUEST");
  const v = value as Command;
  const allowed = creating ? ["contactId", "title", "note", "dueAt", "assigneeId"] : ["title", "note", "dueAt", "assigneeId", "status", "expectedUpdatedAt"];
  if (!Object.keys(v).length || Object.keys(v).some(k => !allowed.includes(k))) return deny("INVALID_REQUEST");
  const title = v.title !== undefined || creating ? text(v.title, 200) : undefined;
  const note = v.note !== undefined || creating ? text(v.note, 4000, true) || null : undefined;
  const dueAt = v.dueAt !== undefined || creating ? new Date(text(v.dueAt, 40)) : undefined;
  if (dueAt && !Number.isFinite(dueAt.getTime())) return deny("INVALID_REQUEST");
  if (v.status !== undefined && !["PENDING", "DONE", "CANCELLED"].includes(String(v.status))) return deny("INVALID_REQUEST");
  const expectedUpdatedAt = v.expectedUpdatedAt === undefined ? undefined : text(v.expectedUpdatedAt, 40);
  if (expectedUpdatedAt && (!Number.isFinite(Date.parse(expectedUpdatedAt)) || new Date(expectedUpdatedAt).toISOString() !== expectedUpdatedAt)) return deny("INVALID_REQUEST");
  return { title, note, dueAt, assigneeId: v.assigneeId === undefined ? undefined : text(v.assigneeId, 128, true) || null,
    contactId: creating ? text(v.contactId, 128) : undefined, status: v.status as string | undefined, expectedUpdatedAt };
}
async function transaction<T>(db: Db, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code) && attempt < 3) {
        // Yield before starting a new snapshot so the winning request can commit.
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002", "P2025"].includes(error.code)) return deny("CONFLICT", 409);
      throw error;
    }
  }
}
export async function createAgendaTask(db: Db, actor: SessionUser, value: unknown, key: string | null) {
  const command = parseCommand(value, true);
  if (key !== null && !/^[A-Za-z0-9_-]{8,128}$/.test(key)) return deny("INVALID_REQUEST");
  if (!managesTasks(actor) && command.assigneeId && command.assigneeId !== actor.id) return deny("FORBIDDEN", 403);
  const data = { companyId: actor.companyId, contactId: command.contactId!, assigneeId: command.assigneeId ?? actor.id,
    title: command.title!, note: command.note ?? null, dueAt: command.dueAt! };
  const id = "agenda-" + createHash("sha256").update(JSON.stringify([actor.companyId, actor.id, key ?? data])).digest("hex");
  return transaction(db, async tx => {
    const old = await tx.task.findUnique({ where: { id }, include: taskInclude });
    if (old) {
      if (!Object.entries(data).every(([k, v]) => JSON.stringify(old[k as keyof typeof data]) === JSON.stringify(v))) return deny("CONFLICT", 409);
      return { task: mapTask(old), duplicate: true };
    }
    const contact = await tx.contact.findFirst({ where: { AND: [contactSelection(actor, ""), { id: data.contactId }] }, select: { id: true } });
    if (!contact) return deny("NOT_FOUND", 404);
    if (!await tx.user.findFirst({ where: { id: data.assigneeId, companyId: actor.companyId }, select: { id: true } })) return deny("INVALID_REQUEST");
    const task = await tx.task.create({ data: { id, ...data, status: "PENDING" }, include: taskInclude });
    await createActivity(tx, { contactId: task.contactId, userId: actor.id, type: "TASK_CREATED",
      title: "Tarefa criada", detail: task.title });
    return { task: mapTask(task), duplicate: false };
  });
}
export async function updateAgendaTask(db: Db, actor: SessionUser, id: string, value: unknown) {
  const command = parseCommand(value, false);
  if (!managesTasks(actor) && command.assigneeId !== undefined) return deny("FORBIDDEN", 403);
  return transaction(db, async tx => {
    const current = await tx.task.findFirst({ where: { AND: [taskScope(actor), { id }] }, include: taskInclude });
    if (!current) return deny("NOT_FOUND", 404);
    if (command.expectedUpdatedAt && command.expectedUpdatedAt !== current.updatedAt.toISOString()) return deny("CONFLICT", 409);
    if (command.assigneeId && !await tx.user.findFirst({ where: { id: command.assigneeId, companyId: actor.companyId }, select: { id: true } })) return deny("INVALID_REQUEST");
    const data = { ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.note !== undefined ? { note: command.note } : {}), ...(command.dueAt ? { dueAt: command.dueAt } : {}),
      ...(command.assigneeId !== undefined ? { assigneeId: command.assigneeId } : {}),
      ...(command.status ? { status: command.status, completedAt: command.status === "DONE"
        ? current.completedAt ?? new Date() : null } : {}) };
    if (Object.entries(data).every(([k, v]) => JSON.stringify(current[k as keyof typeof data]) === JSON.stringify(v))) return { task: mapTask(current) };
    const updated = await tx.task.update({ where: { id, companyId: actor.companyId, updatedAt: current.updatedAt,
      ...(!managesTasks(actor) ? { assigneeId: actor.id } : {}) }, data, include: taskInclude });
    const type = command.status === "DONE" ? "TASK_DONE" : command.status === "CANCELLED" ? "TASK_CANCELLED" : "TASK_UPDATED";
    await createActivity(tx, { contactId: current.contactId, userId: actor.id,
      type, title: type === "TASK_DONE" ? "Tarefa concluída" : type === "TASK_CANCELLED" ? "Tarefa cancelada" : "Tarefa atualizada", detail: updated.title });
    return { task: mapTask(updated) };
  });
}
