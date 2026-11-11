import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import type { SessionUser } from "./auth";
import { OPEN_CREDIT_CONVERSATION_CHANNEL } from "./conversation-channel.service";
import { conversationVisibilityWhere, isAdmin } from "./permissions";
import { conversationListSelect, mapConversationListItem } from "./conversations";

class InvalidPagination extends Error {}
type Position = { at: string; id: string };
type Db = Pick<PrismaClient, "$transaction">;
const activity = Prisma.sql`COALESCE(c."lastMessageAt", c."createdAt")`;
function secret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("CURSOR_CONFIGURATION_UNAVAILABLE");
  return "dev-conversation-pagination";
}
const sign = (payload: string) => createHmac("sha256", secret()).update("conversation-list-v1\0" + payload).digest();
function encode(position: Position, filter: string) {
  const data = Buffer.from(JSON.stringify({ v: 1, ...position, filter })).toString("base64url");
  return data + "." + sign(data).toString("base64url");
}
function decode(cursor: string, filter: string): Position {
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidPagination();
  const [data, signature] = cursor.split(".");
  const actual = Buffer.from(signature, "base64url"), expected = sign(data);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new InvalidPagination();
  let p;
  try { p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")); } catch { throw new InvalidPagination(); }
  if (!p || p.v !== 1 || p.filter !== filter || Object.keys(p).sort().join() !== "at,filter,id,v"
    || typeof p.at !== "string" || !Number.isFinite(Date.parse(p.at)) || new Date(p.at).toISOString() !== p.at
    || typeof p.id !== "string" || !p.id.length || p.id.length > 200 || /[\u0000-\u001f]/.test(p.id)) throw new InvalidPagination();
  return { at: p.at, id: p.id };
}

export function conversationListQuery(session: SessionUser, params: URLSearchParams) {
  if (params.getAll("cursor").length > 1 || params.getAll("limit").length > 1) throw new InvalidPagination();
  const value = params.get("limit");
  if (value !== null && (!/^[1-9]\d{0,5}$/.test(value) || !Number.isSafeInteger(Number(value)))) throw new InvalidPagination();
  const limit = Math.min(100, value === null ? 100 : Number(value));
  const search = params.get("search")?.trim() ?? "";
  const status = params.get("status") ?? "OPEN";
  const assignedTo = params.get("assignedTo")?.trim() ?? "";
  const tagIds = Array.from(new Set(params.getAll("tagId").concat(params.get("tagIds")?.split(",") ?? [])
    .map(x => x.trim()).filter(Boolean))).sort();
  const assignmentWhere = assignedTo === "me" ? { agentId: session.id }
    : assignedTo === "unassigned" ? { agentId: null }
      : assignedTo && isAdmin(session) ? { agentId: assignedTo } : conversationVisibilityWhere(session);
  const assignmentSql = assignedTo === "me" ? Prisma.sql`c."agentId"=${session.id}`
    : assignedTo === "unassigned" ? Prisma.sql`c."agentId" IS NULL`
      : assignedTo && isAdmin(session) ? Prisma.sql`c."agentId"=${assignedTo}`
        : isAdmin(session) ? Prisma.sql`1=1` : Prisma.sql`(c."agentId"=${session.id} OR c."agentId" IS NULL)`;
  const baseWhere: Prisma.ConversationWhereInput = {
    ...assignmentWhere,
    channel: { not: OPEN_CREDIT_CONVERSATION_CHANNEL },
    contact: { companyId: session.companyId, archivedAt: null,
      ...(search ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { cpf: { contains: search } }] } : {}) },
    ...(tagIds.length ? { tags: { some: { tagId: { in: tagIds }, companyId: session.companyId,
      tag: { companyId: session.companyId, isActive: true } } } } : {}),
  };
  const baseSql = Prisma.sql`p."companyId"=${session.companyId} AND p."archivedAt" IS NULL
    AND c."channel" <> ${OPEN_CREDIT_CONVERSATION_CHANNEL} AND ${assignmentSql}
    ${search ? Prisma.sql`AND (p."name" LIKE ${"%" + search + "%"} OR p."phone" LIKE ${"%" + search + "%"} OR p."cpf" LIKE ${"%" + search + "%"})` : Prisma.empty}
    ${tagIds.length ? Prisma.sql`AND EXISTS (SELECT 1 FROM "ConversationTag" ct JOIN "Tag" t ON t."id"=ct."tagId"
      WHERE ct."conversationId"=c."id" AND ct."companyId"=${session.companyId} AND t."companyId"=${session.companyId}
      AND t."isActive"=true AND ct."tagId" IN (${Prisma.join(tagIds)}))` : Prisma.empty}`;
  const filter = createHash("sha256").update(JSON.stringify([session.companyId, session.id, session.role, search, status, assignedTo, tagIds, limit])).digest("hex");
  const cursor = params.has("cursor") ? decode(params.get("cursor")!, filter) : null;
  // Prisma binds Date as timestamptz on PostgreSQL, while these columns are
  // timestamp(3) without timezone. Bind the validated UTC clock text explicitly;
  // SQLite instead stores Prisma DateTime as epoch milliseconds.
  const cursorAt = cursor ? /^postgres(?:ql)?:/.test(process.env.DATABASE_URL ?? "")
    ? Prisma.sql`CAST(${cursor.at.slice(0, -1)} AS timestamp)` : Prisma.sql`${Date.parse(cursor.at)}` : Prisma.empty;
  const query = Prisma.sql`SELECT c."id", ${activity} AS "effectiveActivityAt"
    FROM "Conversation" c JOIN "Contact" p ON p."id"=c."contactId"
    WHERE ${baseSql} ${status === "ALL" ? Prisma.empty : Prisma.sql`AND c."status"=${status}`}
    ${cursor ? Prisma.sql`AND (${activity},c."id") < (${cursorAt},${cursor.id})` : Prisma.empty}
    ORDER BY ${activity} DESC,c."id" DESC LIMIT ${limit + 1}`;
  return { query, baseWhere, where: { ...baseWhere, ...(status === "ALL" ? {} : { status }) }, limit, filter };
}

export async function getConversationList(db: Db, session: SessionUser, params: URLSearchParams) {
  const q = conversationListQuery(session, params);
  return db.$transaction(async tx => {
    // SELECT only. IDs are ordered and bounded in the database, before fetching the DTO.
    const rows = await tx.$queryRaw<Array<{ id: string; effectiveActivityAt: Date | bigint }>>(q.query);
    const hasMore = rows.length > q.limit;
    const page = rows.slice(0, q.limit);
    const [items, groups] = await Promise.all([
      tx.conversation.findMany({ where: { ...q.where, id: { in: page.map(r => r.id) } }, select: conversationListSelect }),
      tx.conversation.groupBy({ by: ["status"], where: q.baseWhere, _count: { _all: true } }),
    ]);
    const byId = new Map(items.map(item => [item.id, item]));
    const statusCounts = { OPEN: 0, PENDING: 0, BOT: 0, RESOLVED: 0, SOLD: 0 };
    for (const g of groups) if (Object.hasOwn(statusCounts, g.status)) statusCounts[g.status as keyof typeof statusCounts] = g._count._all;
    const last = page.at(-1);
    return { conversations: page.flatMap(row => { const item = byId.get(row.id); return item ? [mapConversationListItem(item)] : []; }), statusCounts,
      hasMore, nextCursor: hasMore && last ? encode({ at: new Date(typeof last.effectiveActivityAt === "bigint"
        ? Number(last.effectiveActivityAt) : last.effectiveActivityAt).toISOString(), id: last.id }, q.filter) : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 8000 });
}

export function createConversationListGetHandler(deps: { db: Db; getSession(request: NextRequest): Promise<SessionUser | null> }) {
  return async (request: NextRequest) => {
    try {
      const session = await deps.getSession(request);
      if (!session) return NextResponse.json({ error: "Nao autenticado." }, { status: 401, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(await getConversationList(deps.db, session, request.nextUrl.searchParams), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof InvalidPagination ? "Paginacao invalida." : "Nao foi possivel carregar conversas." },
        { status: error instanceof InvalidPagination ? 400 : 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}
