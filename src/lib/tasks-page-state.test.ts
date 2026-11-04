import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createTaskPages, hasTaskListFields, type TaskPageData } from "./tasks-page-state";

type Item = { id: string; status: string; dueAt?: string };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const page = (ids: string[], cursor: string | null): TaskPageData<Item> => ({
  tasks: ids.map(id => ({ id, status: "PENDING" })), hasMore: cursor !== null, nextCursor: cursor
});

test("first page, append, duplicate suppression and EOF never fetch 1000 automatically", async () => {
  const cursors: Array<string | null> = [];
  const controller = createTaskPages<Item>(async cursor => {
    cursors.push(cursor); return cursor ? page(["b", "c"], null) : page(["a", "b"], "page-2");
  });
  assert.equal(cursors.length, 0);
  await controller.refresh(); assert.deepEqual(cursors, [null]);
  await controller.loadMore(); await controller.loadMore();
  assert.deepEqual(cursors, [null, "page-2"]);
  assert.deepEqual(controller.snapshot().items.map(row => row.id), ["a", "b", "c"]);
  assert.equal(controller.snapshot().hasMore, false);
});

test("load-more failures keep existing items and the same cursor available for manual retry", async () => {
  let fail = true; const seen: Array<string | null> = [];
  const controller = createTaskPages<Item>(async cursor => {
    seen.push(cursor); if (cursor && fail) throw new Error("synthetic failure");
    return cursor ? page(["b"], null) : page(["a"], "next");
  });
  await controller.refresh(); await controller.loadMore();
  assert.deepEqual(controller.snapshot().items.map(row => row.id), ["a"]);
  assert.equal(controller.snapshot().error, "synthetic failure");
  assert.equal(controller.snapshot().nextCursor, "next");
  fail = false; await controller.loadMore();
  assert.equal(controller.snapshot().error, ""); assert.deepEqual(seen, [null, "next", "next"]);
});

test("repeated load-more clicks do not overlap requests", async () => {
  const pending = deferred<TaskPageData<Item>>(); let count = 0;
  const controller = createTaskPages<Item>(async cursor => { count++; return cursor ? pending.promise : page(["a"], "next"); });
  await controller.refresh(); const operation = controller.loadMore();
  assert.equal(controller.snapshot().loadingMore, true);
  await controller.loadMore(); assert.equal(count, 2);
  pending.resolve(page(["b"], null)); await operation;
  assert.equal(controller.snapshot().loadingMore, false);
});

test("refresh aborts an old page and ignores its eventual response", async () => {
  const pending = deferred<TaskPageData<Item>>(); let signal: AbortSignal | undefined;
  let initial = 0;
  const controller = createTaskPages<Item>(async (cursor, active) => {
    if (cursor) { signal = active; return pending.promise; }
    return ++initial === 1 ? page(["old"], "next") : page(["fresh"], null);
  });
  await controller.refresh(); const more = controller.loadMore(); await controller.refresh();
  assert.equal(signal?.aborted, true);
  pending.resolve(page(["stale"], null)); await more;
  assert.deepEqual(controller.snapshot().items.map(row => row.id), ["fresh"]);
});

test("cancel ignores a response from a closed modal/contact and still allows reopening", async () => {
  const pending = deferred<TaskPageData<Item>>(); let count = 0;
  const controller = createTaskPages<Item>(async () => ++count === 1 ? pending.promise : page(["reopened"], null));
  const operation = controller.refresh(); controller.cancel();
  pending.resolve(page(["old-company-or-contact"], null)); await operation;
  assert.equal(controller.snapshot().items.length, 0);
  await controller.refresh(); assert.equal(controller.snapshot().items[0].id, "reopened");
});

test("completion and rescheduling from additional pages survive stale append results", async () => {
  const pending = deferred<TaskPageData<Item>>(); let count = 0;
  const controller = createTaskPages<Item>(async () => ++count === 1 ? page(["a"], "second") :
    count === 2 ? page(["b", "c"], "third") : pending.promise);
  await controller.refresh(); await controller.loadMore();
  const operation = controller.loadMore();
  controller.remove("b"); controller.replace({ id: "c", status: "PENDING", dueAt: "2026-12-01" });
  pending.resolve(page(["b", "c", "d"], null)); await operation;
  assert.deepEqual(controller.snapshot().items.map(row => row.id), ["a", "c", "d"]);
  assert.equal(controller.snapshot().items.find(row => row.id === "c")?.dueAt, "2026-12-01");
});

test("mutations during first-page refresh do not resurrect a completed task", async () => {
  const pending = deferred<TaskPageData<Item>>();
  const controller = createTaskPages<Item>(() => pending.promise);
  const operation = controller.refresh(); controller.remove("a");
  controller.replace({ id: "b", status: "DONE" });
  pending.resolve(page(["a", "b"], null)); await operation;
  assert.deepEqual(controller.snapshot().items, [{ id: "b", status: "DONE" }]);
});

test("contact completion retains DONE and creation is not duplicated by later pages", async () => {
  const controller = createTaskPages<Item>(async cursor => cursor ? page(["b", "created"], null) : page(["a", "b"], "next"));
  await controller.refresh(); controller.replace({ id: "b", status: "DONE" });
  controller.prepend({ id: "created", status: "PENDING" });
  await controller.loadMore();
  assert.equal(controller.snapshot().items.filter(row => row.id === "created").length, 1);
  assert.equal(controller.snapshot().items.find(row => row.id === "b")?.status, "DONE");
});

test("empty result, first-load error and invalid/nonadvancing page produce explicit state", async () => {
  const empty = createTaskPages<Item>(async () => page([], null)); await empty.refresh();
  assert.equal(empty.snapshot().items.length, 0); assert.equal(empty.snapshot().loading, false);
  const failure = createTaskPages<Item>(async () => { throw new Error("synthetic error"); }); await failure.refresh();
  assert.equal(failure.snapshot().error, "synthetic error");
  const invalid = createTaskPages<Item>(async cursor => page(["a"], cursor ?? "same"));
  await invalid.refresh(); await invalid.loadMore();
  assert.match(invalid.snapshot().error, /invalida/); assert.equal(invalid.snapshot().items.length, 1);
});

test("refresh preserves two loaded pages and cursor during network failure and malformed response", async () => {
  const pending = deferred<TaskPageData<Item>>();
  let refreshes = 0;
  const controller = createTaskPages<Item>(async cursor => {
    if (cursor) return page(["b"], "third");
    switch (++refreshes) {
      case 1: return page(["a"], "second");
      case 2: return pending.promise;
      case 3: return { tasks: [{ id: "bad", status: "PENDING" }], hasMore: true, nextCursor: null };
      default: return page(["fresh"], null);
    }
  });
  await controller.refresh();
  await controller.loadMore();
  const before = controller.snapshot().items;
  const failed = controller.refresh();
  assert.equal(controller.snapshot().loading, true);
  assert.equal(controller.snapshot().items, before);
  pending.reject(new Error("synthetic network failure"));
  await failed;
  assert.equal(controller.snapshot().items, before);
  assert.equal(controller.snapshot().nextCursor, "third");
  assert.equal(controller.snapshot().hasMore, true);
  assert.match(controller.snapshot().error, /network failure/);
  await controller.refresh();
  assert.equal(controller.snapshot().items, before);
  assert.equal(controller.snapshot().nextCursor, "third");
  assert.match(controller.snapshot().error, /invalida/);
  await controller.refresh();
  assert.deepEqual(controller.snapshot().items.map(item => item.id), ["fresh"]);
  assert.equal(controller.snapshot().nextCursor, null);
});

test("legacy first page stays visible with unknown total and does not fabricate load more", async () => {
  let calls = 0;
  const controller = createTaskPages<Item>(async () => ++calls === 1
    ? { tasks: [{ id: "legacy", status: "PENDING" }] }
    : page(["modern"], "next"));
  await controller.refresh();
  assert.equal(controller.snapshot().legacy, true);
  assert.equal(controller.snapshot().items[0].id, "legacy");
  assert.equal(controller.snapshot().nextCursor, null);
  assert.equal(controller.snapshot().hasMore, false);
  await controller.loadMore();
  assert.equal(calls, 1);
  await controller.refresh();
  assert.equal(controller.snapshot().legacy, false);
  assert.equal(controller.snapshot().nextCursor, "next");
});

test("legacy response to an append during rollback is not merged and requires refresh", async () => {
  const controller = createTaskPages<Item>(async cursor => cursor ? { tasks: page(["legacy"], null).tasks } : page(["a"], "next"));
  await controller.refresh();
  await controller.loadMore();
  assert.deepEqual(controller.snapshot().items.map(item => item.id), ["a"]);
  assert.equal(controller.snapshot().nextCursor, "next");
  assert.match(controller.snapshot().error, /Atualize/);
});

test("a malformed task cannot replace the visible list even with valid page metadata", async () => {
  const good = { id: "good", title: "Synthetic", status: "PENDING", dueAt: "2026-11-10T12:00:00.000Z",
    contact: { id: "contact", name: "Synthetic", phone: "" }, assignee: null };
  let calls = 0;
  const controller = createTaskPages(async () => ({
    tasks: [++calls === 1 ? good : { ...good, contact: null }], hasMore: false, nextCursor: null
  }), hasTaskListFields);
  await controller.refresh();
  await controller.refresh();
  assert.deepEqual(controller.snapshot().items, [good]);
  assert.match(controller.snapshot().error, /invalida/);
});

test("both real consumers use the same tested controller through a 100-item hook", () => {
  const hook = readFileSync("src/app/hooks/use-task-pages.ts", "utf8");
  const ui = readFileSync("src/app/page.tsx", "utf8");
  assert.ok(hook.includes('params.set("limit", "100")'));
  assert.ok(hook.includes("createTaskPages<T>")); assert.ok(hook.includes("return controller.cancel"));
  assert.ok(ui.includes("onTaskCompleted={scheduledPages.remove}"));
  assert.ok(ui.includes("onTaskUpdated={scheduledPages.replace}"));
  assert.ok(ui.includes("taskPages.replace(updated)"));
  assert.ok(ui.includes("scheduledPages.loadMore()") && ui.includes("taskPages.loadMore()"));
  assert.ok(ui.includes("retorno(s) carregado(s)") && ui.includes("Mais resultados disponiveis"));
  assert.ok(ui.includes("legacy={scheduledPages.legacy}") && ui.includes("taskPages.legacy &&"));
  assert.ok(ui.includes('taskAssigneeId={session.user.role === "AGENT" ? session.user.id : undefined}'));
});
