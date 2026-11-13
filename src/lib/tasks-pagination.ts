import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";

const cursorLifetime = 60 * 60 * 1000;
type TaskKey = { id: string; status: string; dueAt: Date };
type Cursor = { v: number; scope: string; key: [string, string, string]; exp: number };

export class TaskPaginationError extends Error {
  constructor() { super("Paginacao de tarefas invalida."); }
}

function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("Task cursor secret unavailable");
  return "dev-secret-change-me";
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(`task-page-v1:${payload}`).digest();
}

export function parseTaskPage(params: URLSearchParams, session: SessionUser, now = Date.now()) {
  const rawLimit = params.get("limit");
  if (params.has("companyId") || params.getAll("limit").length > 1 || params.getAll("cursor").length > 1 ||
      (rawLimit !== null && (!/^[1-9]\d{0,3}$/.test(rawLimit) || Number(rawLimit) > 1000))) {
    throw new TaskPaginationError();
  }
  const limit = rawLimit === null ? 100 : Number(rawLimit);
  const contactId = params.get("contactId") ?? "";
  const assigneeId = session.role === "AGENT" ? session.id : params.get("assigneeId") ?? "";
  const status = params.get("status") ?? "PENDING";
  const scope = createHash("sha256").update(JSON.stringify([
    session.companyId, session.id, session.role, contactId, assigneeId, status
  ])).digest("hex");
  const where: Prisma.TaskWhereInput = {
    companyId: session.companyId,
    ...(contactId ? { contactId } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(status === "ALL" ? {} : { status })
  };
  const token = params.get("cursor");
  if (token !== null) {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(token)) throw new TaskPaginationError();
    const [encoded, mac] = token.split(".");
    if (!timingSafeEqual(signature(encoded), Buffer.from(mac, "hex"))) throw new TaskPaginationError();
    let cursor: Cursor;
    try { cursor = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Cursor; }
    catch { throw new TaskPaginationError(); }
    if (!cursor || cursor.v !== 1 || cursor.scope !== scope || !Number.isSafeInteger(cursor.exp) ||
        cursor.exp <= now || !Array.isArray(cursor.key) || cursor.key.length !== 3 ||
        cursor.key.some(value => typeof value !== "string") || !cursor.key[2] ||
        cursor.key[2].length > 1024 || cursor.key[0].length > 1024) throw new TaskPaginationError();
    const [lastStatus, date, id] = cursor.key;
    const dueAt = new Date(date);
    if (!Number.isFinite(dueAt.getTime()) || dueAt.toISOString() !== date) throw new TaskPaginationError();
    // A signed value tuple survives deletion or rescheduling of the anchor row.
    where.OR = [
      { status: { gt: lastStatus } },
      { status: lastStatus, dueAt: { gt: dueAt } },
      { status: lastStatus, dueAt, id: { gt: id } }
    ];
  }
  return { limit, where, scope, now };
}

export function taskPage<T extends TaskKey>(rows: T[], query: ReturnType<typeof parseTaskPage>) {
  const hasMore = rows.length > query.limit;
  const tasks = rows.slice(0, query.limit);
  let nextCursor: string | null = null;
  if (hasMore) {
    const last = tasks[tasks.length - 1];
    const payload = Buffer.from(JSON.stringify({
      v: 1, scope: query.scope, key: [last.status, last.dueAt.toISOString(), last.id],
      exp: query.now + cursorLifetime
    } satisfies Cursor)).toString("base64url");
    nextCursor = `${payload}.${signature(payload).toString("hex")}`;
  }
  return { tasks, hasMore, nextCursor };
}
