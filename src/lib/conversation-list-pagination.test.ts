import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ConversationPageLoader, appendConversationPage, compareConversationActivity, type ConversationPage } from "./conversation-list-pagination";
const params = new URLSearchParams("status=OPEN");
const rows = Array.from({ length: 250 }, (_, n) => ({ id: String(n) }));
function fixture() {
  const requests: string[] = []; let fail = false, clock = 0;
  const loader = new ConversationPageLoader(async (q) => {
    requests.push(q.toString()); if (fail) throw Error("NETWORK");
    const start = Number(q.get("cursor") ?? 0), end = Math.min(start + 100, 250);
    return { conversations: rows.slice(start, end), hasMore: end < 250, nextCursor: end < 250 ? String(end) : null };
  }, () => clock);
  return { loader, requests, fail: (value: boolean) => { fail = value; }, tick: () => { clock += 100000; } };
}
test("first page, more, final cursor and dedup preserve backend order", async () => {
  const f = fixture(); const a = await f.loader.load("one", params, "reset");
  assert.equal(a!.conversations.length, 100); assert.equal(f.loader.hasMore, true);
  const b = await f.loader.load("one", params, "more"), c = await f.loader.load("one", params, "more");
  const merged = appendConversationPage(appendConversationPage(a!.conversations, b!.conversations), c!.conversations);
  assert.deepEqual(merged, rows); assert.equal(f.loader.hasMore, false); assert.equal(f.loader.nextCursor, null);
  assert.equal(await f.loader.load("one", params, "more"), null);
  assert.deepEqual(appendConversationPage(rows, [rows[0]]), rows);
});
for (const query of ["status=PENDING", "search=Synthetic", "assignedTo=me", "tagId=tag"]) test("filter change resets every cursor/page: " + query, async () => {
  const f = fixture(); await f.loader.load("old", params, "reset"); await f.loader.load("old", params, "more");
  const result = await f.loader.load(query, new URLSearchParams(query), "reset");
  assert.equal(result!.conversations[0].id, "0"); assert.equal(f.loader.pages, 1);
  assert(!new URLSearchParams(f.requests.at(-1)).has("cursor"));
  assert.equal(await f.loader.load("old", params, "more"), null);
});
test("refresh preserves all loaded pages, global order and scales polling with loaded depth", async () => {
  const f = fixture(); await f.loader.load("x", params, "reset"); await f.loader.load("x", params, "more");
  assert.equal(await f.loader.load("x", params, "refresh"), null);
  f.tick(); const result = await f.loader.load("x", params, "refresh");
  assert.deepEqual(result!.conversations, rows.slice(0, 200)); assert.equal(result!.append, false);
  assert.equal(f.loader.pages, 2); assert.equal(f.loader.nextCursor, "200");
});
test("network failure retains pages/cursor and more can be retried without omissions", async () => {
  const f = fixture(); const a = await f.loader.load("x", params, "reset");
  f.fail(true); await assert.rejects(f.loader.load("x", params, "more"));
  assert.equal(f.loader.pages, 1); assert.equal(f.loader.nextCursor, "100");
  f.tick(); await assert.rejects(f.loader.load("x", params, "refresh")); assert.equal(f.loader.nextCursor, "100");
  f.fail(false); const b = await f.loader.load("x", params, "more");
  assert.equal(appendConversationPage(a!.conversations, b!.conversations).length, 200);
});
test("stale response/body from a previous filter is discarded, even when abort is ignored", async () => {
  let resolve!: (page: ConversationPage<{ id: string }>) => void;
  const loader = new ConversationPageLoader<{ id: string }>(async q => q.get("status") === "OPEN"
    ? new Promise(r => { resolve = r; }) : { conversations: [{ id: "fresh" }], hasMore: false, nextCursor: null });
  const pending = loader.load("old", params, "reset");
  const fresh = await loader.load("new", new URLSearchParams("status=BOT"), "reset");
  resolve({ conversations: [{ id: "stale" }], hasMore: false, nextCursor: null });
  assert.equal(await pending, null); assert.equal(fresh!.conversations[0].id, "fresh"); assert.equal(loader.key, "new");
});
test("duplicate load-more clicks cannot advance two cursors concurrently", async () => {
  let resolve!: (page: ConversationPage<{ id: string }>) => void;
  let calls = 0;
  const loader = new ConversationPageLoader<{ id: string }>(async () => {
    calls++;
    if (calls === 1) return { conversations: [{ id: "one" }], hasMore: true, nextCursor: "next" };
    return new Promise(r => { resolve = r; });
  });
  await loader.load("x", params, "reset");
  const more = loader.load("x", params, "more"); assert.equal(loader.canLoadMore, false);
  assert.equal(await loader.load("x", params, "more"), null); assert.equal(calls, 2);
  resolve({ conversations: [{ id: "two" }], hasMore: false, nextCursor: null });
  assert.equal((await more)!.conversations[0].id, "two"); assert.equal(loader.pages, 2);
});
test("malformed page never consumes the prior cursor", async () => {
  let calls = 0;
  const loader = new ConversationPageLoader(async () => ++calls === 1
    ? { conversations: [{ id: "one" }], hasMore: true, nextCursor: "next" }
    : { conversations: [{ id: "two" }], hasMore: true, nextCursor: "next" });
  await loader.load("x", params, "reset"); await assert.rejects(loader.load("x", params, "more"));
  assert.equal(loader.nextCursor, "next"); assert.equal(loader.pages, 1);
});
test("single-item updates use exactly coalesce plus descending ID, never lastMessage fallback", () => {
  const r = [
    { id: "a", createdAt: "2026-01-03T00:00:00Z", lastMessageAt: null },
    { id: "z", createdAt: "2026-01-01T00:00:00Z", lastMessageAt: "2026-01-03T00:00:00Z" },
    { id: "c", createdAt: "2026-01-01T00:00:00Z", lastMessageAt: null },
  ];
  assert.deepEqual(r.sort(compareConversationActivity).map(x => x.id), ["z", "a", "c"]);
});
test("page wiring appends uniquely, resets by filter/scope and preserves selected timeline", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");
  assert.match(source, /setConversationList\(\[\]\)/);
  assert.match(source, /data.append \? appendConversationPage/);
  assert.match(source, /preserveConversationTimeline\(current, next\)/);
  assert.match(source, /conversationScopeRef.current.*session/);
  assert.match(source, /onLoadMore=.*loadConversations\(conversationFilters, \{ more: true \}\)/);
});
