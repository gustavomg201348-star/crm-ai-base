export type ConversationPage<Row> = {
  conversations: Row[];
  statusCounts?: Partial<Record<"OPEN" | "PENDING" | "BOT" | "RESOLVED" | "SOLD", number>>;
  nextCursor: string | null;
  hasMore: boolean;
};
type Mode = "reset" | "refresh" | "more";

export function appendConversationPage<Row extends { id: string }>(current: Row[], incoming: Row[]) {
  const seen = new Set(current.map(row => row.id));
  return current.concat(incoming.filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; }));
}

/** Only used for single-item live/optimistic updates; fetched pages keep server order. */
export function compareConversationActivity(a: { id: string; lastMessageAt?: string | null; createdAt: string },
  b: { id: string; lastMessageAt?: string | null; createdAt: string }) {
  const delta = Date.parse(b.lastMessageAt ?? b.createdAt) - Date.parse(a.lastMessageAt ?? a.createdAt);
  return delta || (a.id === b.id ? 0 : a.id < b.id ? 1 : -1);
}

export class ConversationPageLoader<Row extends { id: string }> {
  key = "";
  nextCursor: string | null = null;
  hasMore = false;
  pages = 0;
  private generation = 0;
  private abort: AbortController | null = null;
  private mode: Mode | null = null;
  private refreshAfter = 0;
  constructor(private readonly fetchPage: (params: URLSearchParams, signal: AbortSignal) => Promise<ConversationPage<Row>>,
    private readonly clock = Date.now) {}
  get canLoadMore() { return this.hasMore && this.nextCursor !== null && (!this.abort || this.mode === "refresh"); }

  async load(key: string, params: URLSearchParams, mode: Mode) {
    if (mode !== "reset" && key !== this.key) return null;
    if (mode === "more" && (!this.hasMore || !this.nextCursor)) return null;
    if (mode === "refresh" && (this.abort || this.clock() < this.refreshAfter)) return null;
    if (this.abort && mode === "more" && this.mode !== "refresh") return null;
    this.abort?.abort();
    const controller = new AbortController(); this.abort = controller; this.mode = mode;
    const generation = ++this.generation;
    if (mode === "reset") { this.key = key; this.nextCursor = null; this.hasMore = false; this.pages = 0; }
    const desired = mode === "refresh" ? Math.max(1, this.pages) : 1;
    let cursor = mode === "more" ? this.nextCursor : null;
    let rows: Row[] = [], result: ConversationPage<Row> | null = null, pages = 0;
    try {
      do {
        const query = new URLSearchParams(params); query.set("limit", "100");
        if (cursor) query.set("cursor", cursor); else query.delete("cursor");
        const data = await this.fetchPage(query, controller.signal);
        if (generation !== this.generation || controller.signal.aborted) return null;
        if (!Array.isArray(data.conversations) || data.conversations.length > 100 || typeof data.hasMore !== "boolean"
          || (data.hasMore ? typeof data.nextCursor !== "string" || !data.nextCursor.length || data.nextCursor === cursor : data.nextCursor !== null)) throw new Error("INVALID_CONVERSATION_PAGE");
        rows = appendConversationPage(rows, data.conversations);
        result = data; cursor = data.nextCursor; pages++;
      } while (pages < desired && result.hasMore);
      if (!result) return null;
      this.nextCursor = result.nextCursor; this.hasMore = result.hasMore;
      this.pages = mode === "more" ? this.pages + pages : pages;
      // Refresh the entire loaded prefix, never discard page 2+. Pace polling with
      // depth so loading more does not multiply the average 100-rows/3s budget.
      this.refreshAfter = this.clock() + Math.max(1, this.pages) * 3000;
      return { ...result, conversations: rows, append: mode === "more", key };
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return null;
      throw error;
    } finally {
      if (generation === this.generation) { this.abort = null; this.mode = null; }
    }
  }
}
