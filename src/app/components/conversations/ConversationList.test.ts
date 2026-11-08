import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConversationList } from "./ConversationList";
import type { ConversationRow } from "./types";
Object.assign(globalThis, { React });
const row = { id: "synthetic", status: "OPEN", channel: "OPEN_CREDIT", summary: "Lead recebido via OpenCredit",
  unreadCount: 0, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", lastMessageAt: null,
  lastMessage: null, lastMessagePreview: null, messages: [], agent: null, tags: [], assignmentStatus: "UNASSIGNED",
  contact: { id: "contact", name: "Synthetic", phone: "synthetic", tags: [], temperature: "COLD" } } as unknown as ConversationRow;
function render(extra = {}) {
  return renderToStaticMarkup(React.createElement(ConversationList, { conversations: [row], selectedConversation: row,
    statusCounts: { OPEN: 250, PENDING: 0, BOT: 0, RESOLVED: 0, SOLD: 0 },
    filters: { status: "OPEN", search: "", tagIds: [], assignedTo: "default" }, availableTags: [], attendants: [],
    isAdmin: true, loading: false, onFiltersChange: () => {}, onSelectConversation: () => {}, ...extra }));
}
test("message-free card renders summary without manufacturing a message", () => {
  const html = render(); assert(html.includes("Lead recebido via OpenCredit")); assert.equal(row.lastMessageAt, null);
  assert.deepEqual(row.messages, []); assert(html.includes("Synthetic"));
});
test("load more and loading states render without hiding existing rows", () => {
  assert(render({ hasMore: true }).includes("Carregar mais"));
  const html = render({ hasMore: true, loadingMore: true });
  assert(html.includes("Carregando mais...")); assert(html.includes("disabled")); assert(html.includes("Synthetic"));
  assert(!render({ hasMore: false }).includes("Carregar mais"));
});
test("error retains rows and provides retry instead of replacing the list", () => {
  const html = render({ pageError: "Falha temporaria", hasMore: true });
  assert(html.includes('role="alert"')); assert(html.includes("Recarregar lista")); assert(html.includes("Synthetic"));
});
