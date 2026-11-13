import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import ts from "typescript";
import type { SessionUser } from "./auth";
import { parseTaskPage, TaskPaginationError } from "./tasks-pagination";

const admin: SessionUser = { id: "admin", companyId: "company-a", role: "ADMIN", name: "Synthetic", email: "synthetic@example.invalid" };
function rows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `task-${String(i).padStart(5, "0")}`, companyId: "company-a", contactId: "contact-a", assigneeId: "agent-a",
    title: "Retorno sintetico", note: null, dueAt: new Date("2026-11-10T12:00:00.000Z"), status: "PENDING",
    completedAt: null, createdAt: new Date("2026-11-01T12:00:00.000Z"), updatedAt: new Date("2026-11-01T12:00:00.000Z"),
    contact: { id: "contact-a", name: "Cliente sintetico", phone: "synthetic-phone" },
    assignee: { id: "agent-a", name: "Agente sintetico", email: "agent@example.invalid" }
  }));
}
type Row = ReturnType<typeof rows>[number];
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some(part => matches(row, part));
    const value = row[key as keyof Row];
    if (condition instanceof Date) return (value as Date).getTime() === condition.getTime();
    if (condition && typeof condition === "object" && "gt" in condition) {
      const gt = condition.gt;
      return value instanceof Date ? value.getTime() > (gt as Date).getTime() : String(value) > String(gt);
    }
    return value === condition;
  });
}
function compare(a: Row, b: Row) {
  return (a.status < b.status ? -1 : a.status > b.status ? 1 : 0) || a.dueAt.getTime() - b.dueAt.getTime() ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
function fixture(data: Row[], session: SessionUser | null = admin) {
  const calls: Array<Record<string, unknown>> = [];
  const activities: unknown[] = [];
  const task = {
    findMany: async (query: { where: Record<string, unknown>; take: number; orderBy: unknown }) => {
      calls.push(query);
      assert.equal(query.where.companyId, session?.companyId);
      assert.ok(!("skip" in query) && !("cursor" in query));
      assert.deepEqual(query.orderBy, [{ status: "asc" }, { dueAt: "asc" }, { id: "asc" }]);
      assert.ok(query.take <= 1001);
      return data.filter(row => matches(row, query.where)).sort(compare).slice(0, query.take).map(row => ({ ...row }));
    },
    findFirst: async ({ where }: { where: Record<string, unknown> }) => {
      const row = data.find(item => matches(item, where)); return row ? { ...row } : null;
    },
    update: async ({ where, data: changes }: { where: { id: string }; data: Partial<Row> }) => {
      const row = data.find(item => item.id === where.id)!; Object.assign(row, changes); return row;
    }
  };
  const db = { task, $transaction: async (work: (tx: { task: typeof task }) => unknown) => work({ task }) };
  function load(relative: string) {
    const file = path.resolve(relative), from = createRequire(file);
    const loaded = { exports: {} as Record<string, (...args: never[]) => Promise<Response>> };
    const code = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
    }).outputText;
    new Function("require", "module", "exports", code)((name: string) => {
      if (name === "@/lib/auth") return { getSessionFromRequest: async () => session };
      if (name === "@/lib/db") return { prisma: db };
      if (name === "@/lib/tasks") return createRequire(path.resolve("src/lib/tasks.ts"))("./tasks.ts");
      if (name === "@/lib/tasks-pagination") return requirePagination;
      if (name === "@/lib/activities") return { createActivity: async (...args: unknown[]) => { activities.push(args); } };
      if (name === "@/lib/safe-logger") return { safeLogError: () => {} };
      if (name === "@/lib/permissions") return { isAdmin: (user: SessionUser) => user.role === "ADMIN" || user.role === "SUPERVISOR" };
      if (name === "@/lib/http-error-response") return { publicErrorResponse: ({ status, code }: { status: number; code: string }) => Response.json({ error: code }, { status }) };
      return from(name);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  // Both routes use the actual pagination implementation and task projection.
  const requirePagination = createRequire(path.resolve("src/lib/tasks-pagination.ts"))("./tasks-pagination.ts");
  const getRoute = load("src/app/api/tasks/route.ts");
  const patchRoute = load("src/app/api/tasks/[id]/route.ts");
  return {
    calls, activities,
    get: (query = "") => getRoute.GET(new NextRequest(`https://synthetic.invalid/api/tasks?${query}`) as never),
    patch: (id: string, body: unknown) => patchRoute.PATCH(new NextRequest(`https://synthetic.invalid/api/tasks/${id}`, {
      method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }
    }) as never, { params: Promise.resolve({ id }) } as never)
  };
}

for (const count of [0, 1, 100, 101, 1000, 1001]) {
  for (const limit of [100, 1000]) test(`${count} synthetic rows, page size ${limit}, no omissions or duplicates`, async () => {
    const f = fixture(rows(count)); const ids: string[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const response = await f.get(`limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.ok(page.tasks.length <= limit);
      ids.push(...page.tasks.map((row: Row) => row.id));
      assert.equal(page.hasMore, ids.length < count);
      assert.equal(page.nextCursor === null, !page.hasMore);
      cursor = page.nextCursor; assert.ok(++pages <= 11);
    } while (cursor);
    assert.deepEqual(ids, rows(count).map(row => row.id));
    assert.equal(new Set(ids).size, count);
  });
}

test("legacy request keeps tasks projection, default 100 and PENDING without pagination parameters", async () => {
  const f = fixture(rows(101)); const response = await f.get(); const data = await response.json();
  assert.equal(response.status, 200); assert.equal(data.tasks.length, 100); assert.equal(data.hasMore, true);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(f.calls[0].take, 101);
  assert.deepEqual(data.tasks[0].contact, rows(1)[0].contact);
  assert.equal(data.tasks[0].note, null); assert.equal(data.tasks[0].assigneeId, "agent-a");
});

for (const value of ["", "null", "undefined", "0", "-1", "1.1", "1e3", "1001", "10000", "NaN", "+10", " 10", "01"]) {
  test(`invalid limit ${JSON.stringify(value)} is 400 before any database read`, async () => {
    const f = fixture(rows(1)); const response = await f.get(`limit=${encodeURIComponent(value)}`);
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  });
}

test("duplicate pagination arguments and client companyId are rejected", async () => {
  for (const query of ["limit=10&limit=20", "cursor=a&cursor=b", "companyId=company-b"]) {
    const f = fixture(rows(1)); assert.equal((await f.get(query)).status, 400); assert.equal(f.calls.length, 0);
  }
});

test("combined filters and status/date/id ordering survive equal dates and status boundaries", async () => {
  const source = rows(1001).map((row, i) => ({ ...row, status: i % 2 ? "DONE" : "PENDING",
    contactId: i % 3 ? "contact-a" : "contact-b", assigneeId: i % 5 ? "agent-a" : "agent-b",
    dueAt: new Date(Date.UTC(2026, 10, 1 + i % 3)) }));
  for (const filters of ["status=ALL", "status=ALL&contactId=contact-a&assigneeId=agent-a", "status=DONE&contactId=contact-b"]) {
    const f = fixture(source); const found: string[] = []; let cursor: string | null = null;
    do {
      const response = await f.get(`${filters}&limit=17${cursor ? `&cursor=${cursor}` : ""}`);
      const page = await response.json(); found.push(...page.tasks.map((row: Row) => row.id)); cursor = page.nextCursor;
    } while (cursor);
    const selected = new URLSearchParams(filters);
    const expected = source.filter(row => (selected.get("status") === "ALL" || row.status === selected.get("status")) &&
      (!selected.has("contactId") || row.contactId === selected.get("contactId")) &&
      (!selected.has("assigneeId") || row.assigneeId === selected.get("assigneeId")));
    assert.deepEqual(found, expected.sort(compare).map(row => row.id));
  }
});

test("cursor is bound to company, authenticated user, role and all existing filters", async () => {
  const f = fixture(rows(3)); const first = await (await f.get("limit=1")).json();
  for (const user of [{ ...admin, companyId: "company-b" }, { ...admin, id: "other-admin" }, { ...admin, role: "AGENT" as const }]) {
    const other = fixture(rows(3), user);
    assert.equal((await other.get(`cursor=${first.nextCursor}`)).status, 400); assert.equal(other.calls.length, 0);
  }
  for (const filter of ["status=ALL", "contactId=contact-a", "assigneeId=agent-a"]) {
    assert.equal((await f.get(`cursor=${first.nextCursor}&${filter}`)).status, 400);
  }
  assert.equal((await f.get(`limit=1000&cursor=${first.nextCursor}`)).status, 200);
});

test("invalid, tampered, expired and signed malformed cursors are rejected before SQL", async () => {
  const f = fixture(rows(2)); const page = await (await f.get("limit=1")).json();
  const [encoded, mac] = page.nextCursor.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  const mint = (value: unknown) => {
    const body = Buffer.from(JSON.stringify(value)).toString("base64url");
    const signature = createHmac("sha256", process.env.AUTH_SECRET || "dev-secret-change-me").update(`task-page-v1:${body}`).digest("hex");
    return `${body}.${signature}`;
  };
  for (const cursor of ["", "invalid", `${encoded}.${mac[0] === "0" ? "1" : "0"}${mac.slice(1)}`, "x".repeat(4097),
    mint(null), mint({ ...payload, exp: Date.now() - 1 }), mint({ ...payload, key: ["PENDING", "invalid", "id"] }),
    mint({ ...payload, key: ["PENDING", "2026-11-01", "id"] }), mint({ ...payload, key: [1, payload.key[1], "id"] }),
    mint({ ...payload, key: ["PENDING", payload.key[1], ""] }), mint({ ...payload, v: 2 }), mint({ ...payload, exp: "future" })]) {
    const other = fixture(rows(2)); assert.equal((await other.get(`cursor=${encodeURIComponent(cursor)}`)).status, 400);
    assert.equal(other.calls.length, 0);
  }
});

test("ADMIN and SUPERVISOR retain company-wide access; AGENT cannot read another assignee", async () => {
  for (const role of ["ADMIN", "SUPERVISOR", "AGENT"] as const) {
    const source = rows(2); source[1].companyId = "company-b";
    const f = fixture(source, { ...admin, role });
    const page = await (await f.get()).json(); assert.equal(page.tasks.length, role === "AGENT" ? 0 : 1);
    if (role !== "AGENT") assert.equal(page.tasks[0].assigneeId, "agent-a");
  }
  const anonymous = fixture(rows(2), null);
  assert.equal((await anonymous.get()).status, 401); assert.equal(anonymous.calls.length, 0);
});

test("AGENT pages only own tasks with 1203 foreign rows, including contact panel, omitted and forged filters", async () => {
  const agent: SessionUser = { ...admin, id: "agent-a", role: "AGENT" };
  const own = rows(1001);
  const foreign = rows(1203).map(row => ({ ...row, id: `foreign-${row.id}`, assigneeId: "agent-b" }));
  const f = fixture([...own, ...foreign, { ...own[0], id: "other-company", companyId: "company-b" }], agent);
  for (const query of ["", "assigneeId=agent-b", "contactId=contact-a&status=ALL&assigneeId=agent-b"]) {
    const params = new URLSearchParams(query);
    params.set("limit", "1000");
    const first = await (await f.get(params.toString())).json();
    assert.equal(first.tasks.length, 1000);
    params.set("cursor", first.nextCursor);
    const last = await (await f.get(params.toString())).json();
    assert.equal(last.hasMore, false);
    assert.deepEqual([...first.tasks, ...last.tasks].map((row: Row) => row.id), own.map(row => row.id));
    const [encoded, mac] = first.nextCursor.split(".");
    const changed = JSON.parse(Buffer.from(encoded, "base64url").toString());
    changed.key[2] = foreign[0].id;
    params.set("cursor", `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${mac}`);
    const reads = f.calls.length;
    assert.equal((await f.get(params.toString())).status, 400);
    assert.equal(f.calls.length, reads);
  }
  assert.ok(f.calls.every(call => (call.where as Record<string, unknown>).assigneeId === agent.id));
  const elevated = await (await fixture(foreign).get("limit=1&assigneeId=agent-b")).json();
  assert.equal((await f.get(`assigneeId=agent-b&cursor=${elevated.nextCursor}`)).status, 400);
  // A genuine V1 signature from before the own-assignee restriction is insufficient.
  const scope = createHash("sha256").update(JSON.stringify([
    agent.companyId, agent.id, agent.role, "", "agent-b", "PENDING"
  ])).digest("hex");
  const encoded = Buffer.from(JSON.stringify({
    v: 1, scope, key: ["PENDING", foreign[0].dueAt.toISOString(), foreign[0].id], exp: Date.now() + 60_000
  })).toString("base64url");
  const mac = createHmac("sha256", process.env.AUTH_SECRET || "dev-secret-change-me")
    .update(`task-page-v1:${encoded}`).digest("hex");
  const reads = f.calls.length;
  assert.equal((await f.get(`assigneeId=agent-b&cursor=${encoded}.${mac}`)).status, 400);
  assert.equal(f.calls.length, reads);
});

test("signed tuple survives rescheduling and deletion of anchors; earlier inserts need refresh", async () => {
  const source = rows(4); const f = fixture(source); const first = await (await f.get("limit=1")).json();
  source[0].dueAt = new Date("2026-12-01T00:00:00.000Z");
  const next = await (await f.get(`limit=1&cursor=${first.nextCursor}`)).json();
  assert.equal(next.tasks[0].id, "task-00001");
  source.splice(1, 1);
  const early = { ...rows(1)[0], id: "created-earlier", dueAt: new Date("2026-11-01T00:00:00.000Z") }; source.push(early);
  const later = await (await f.get(`cursor=${next.nextCursor}`)).json();
  assert.deepEqual(later.tasks.map((row: Row) => row.id), ["task-00002", "task-00003", "task-00000"]);
  assert.ok(!later.tasks.some((row: Row) => row.id === early.id));
  assert.ok((await (await f.get()).json()).tasks.some((row: Row) => row.id === early.id));
});

test("tasks from additional pages still complete and reschedule with unchanged PATCH permissions", async () => {
  const source = rows(201), f = fixture(source);
  const first = await (await f.get()).json(), second = await (await f.get(`cursor=${first.nextCursor}`)).json();
  const id = second.tasks[0].id;
  assert.equal((await f.patch(id, { dueAt: "2026-12-01T15:00:00.000Z" })).status, 200);
  assert.equal(source.find(row => row.id === id)!.dueAt.toISOString(), "2026-12-01T15:00:00.000Z");
  const done = await f.patch(id, { status: "DONE" }); assert.equal(done.status, 200);
  assert.equal(source.find(row => row.id === id)!.status, "DONE"); assert.equal(f.activities.length, 1);
  assert.equal((await fixture(source, { ...admin, role: "AGENT" }).patch(second.tasks[1].id, { status: "DONE" })).status, 403);
});

test("runtime validation rejects null-like limit with explicit pagination error", () => {
  assert.throws(() => parseTaskPage(new URLSearchParams("limit=null"), admin), TaskPaginationError);
});
