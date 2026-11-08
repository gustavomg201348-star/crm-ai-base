import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createConversationListGetHandler, conversationListQuery, getConversationList } from "./conversation-list.service";
import type { SessionUser } from "./auth";

const actor: SessionUser = { id: "operator", companyId: "synthetic-company", role: "AGENT", name: "Synthetic", email: "synthetic@example.invalid" };
test("database SQL orders effective activity and ID before bounded LIMIT, without OFFSET", () => {
  const q = conversationListQuery(actor, new URLSearchParams("limit=10000&search=x%27&tagIds=red,blue&status=ALL"));
  assert.equal(q.limit, 100);
  assert.match(q.query.sql, /ORDER BY COALESCE\(c\."lastMessageAt", c\."createdAt"\) DESC,c\."id" DESC LIMIT/);
  assert.doesNotMatch(q.query.sql, /OFFSET|x%27/);
  assert(q.query.sql.includes('p."companyId"=')); assert(q.query.sql.includes('p."archivedAt" IS NULL'));
  assert(q.query.sql.includes('c."agentId" IS NULL'));
  assert.equal(q.query.values.at(-1), 101);
});
test("agent cannot choose another owner; admin can, while me/unassigned preserve their meaning", () => {
  const q = (role: SessionUser["role"], query: string) => conversationListQuery({ ...actor, role }, new URLSearchParams(query));
  assert(q("AGENT", "assignedTo=other").query.values.includes(actor.id));
  assert(!q("AGENT", "assignedTo=other").query.values.includes("other"));
  assert(q("ADMIN", "assignedTo=other").query.values.includes("other"));
  assert(q("ADMIN", "assignedTo=me").query.values.includes(actor.id));
  assert.match(q("AGENT", "assignedTo=unassigned").query.sql, /AND c\."agentId" IS NULL/);
});
test("invalid or duplicate pagination is rejected before any database read", async () => {
  let reads = 0;
  const handler = createConversationListGetHandler({ db: { $transaction: async () => { reads++; } } as never, getSession: async () => actor });
  for (const query of ["limit=0", "limit=-1", "limit=1.5", "limit=", "limit=2&limit=3", "cursor=", "cursor=bad", "cursor=a&cursor=b"]) {
    const r = await handler(new NextRequest("https://crm.example/api/conversations?" + query));
    assert.equal(r.status, 400); assert.equal(r.headers.get("cache-control"), "no-store");
  }
  assert.equal(reads, 0);
});
test("GET requires session and sanitizes storage errors", async () => {
  let reads = 0;
  const db = { $transaction: async () => { reads++; throw Error("PRIVATE_SQL_CREDENTIAL"); } } as never;
  const req = new NextRequest("https://crm.example/api/conversations");
  assert.equal((await createConversationListGetHandler({ db, getSession: async () => null })(req)).status, 401);
  assert.equal(reads, 0);
  const r = await createConversationListGetHandler({ db, getSession: async () => actor })(req);
  assert.equal(r.status, 500); assert(!(await r.text()).includes("PRIVATE"));
});
test("empty GET returns global filtered counts and no cursor; SELECT paths have no domain writes", async () => {
  const tx = { $queryRaw: async () => [], conversation: { findMany: async () => [], groupBy: async () => [{ status: "OPEN", _count: { _all: 250 } }] } };
  const db = { $transaction: async (fn: (value: unknown) => unknown) => fn(tx) } as never;
  const r = await getConversationList(db, actor, new URLSearchParams());
  assert.deepEqual(r.conversations, []); assert.equal(r.statusCounts.OPEN, 250);
  assert.equal(r.hasMore, false); assert.equal(r.nextCursor, null);
  const source = readFileSync("src/lib/conversation-list.service.ts", "utf8");
  assert.doesNotMatch(source, /tx\.[a-zA-Z]+\.(?:create|update|delete|upsert|createMany|updateMany|deleteMany)\(/);
  const route = readFileSync("src/app/api/conversations/route.ts", "utf8");
  assert.match(route, /export const GET = createConversationListGetHandler/);
});
test("cursor uses timezone-independent PG timestamp text and SQLite epoch milliseconds", async () => {
  const at = new Date("2026-11-01T12:34:56.789Z");
  const tx = { $queryRaw: async () => Array.from({ length: 101 }, (_, n) => ({ id: "synthetic-" + n, effectiveActivityAt: BigInt(at.getTime()) })),
    conversation: { findMany: async () => [], groupBy: async () => [] } };
  const db = { $transaction: async (fn: (value: unknown) => unknown) => fn(tx) } as never;
  const page = await getConversationList(db, actor, new URLSearchParams());
  assert(page.hasMore); assert(page.nextCursor);
  const original = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "postgresql://synthetic.invalid/db";
    const pg = conversationListQuery(actor, new URLSearchParams({ cursor: page.nextCursor! }));
    assert.match(pg.query.sql, /CAST\(.* AS timestamp\)/); assert(pg.query.values.includes("2026-11-01T12:34:56.789"));
    process.env.DATABASE_URL = "file:synthetic.db";
    const sqlite = conversationListQuery(actor, new URLSearchParams({ cursor: page.nextCursor! }));
    assert(!sqlite.query.sql.includes("AS timestamp")); assert(sqlite.query.values.includes(at.getTime()));
  } finally { if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original; }
});
