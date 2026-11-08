# Atendimento: effective activity and cursor pagination

GET `/api/conversations` keeps its session, company, owner/visibility, archived
Contact, status, search and active-tag filters. It adds `limit` (default/max 100;
larger positive limits are capped) and `cursor`. Invalid pagination returns 400.
Responses retain `conversations` and `statusCounts`, adding `hasMore` and
`nextCursor` (null on the final page). Responses are no-store.

The database selects IDs with
`ORDER BY COALESCE(lastMessageAt, createdAt) DESC, id DESC LIMIT limit+1`.
Subsequent pages add a strict tuple `< (effectiveActivityAt, id)` predicate.
There is no OFFSET, NULLS-LAST priority or JavaScript sort of a pre-limited page.
Cursor boundaries use explicit timestamp-without-timezone text on PostgreSQL and
epoch milliseconds on SQLite, matching existing column storage independently of
the PostgreSQL session timezone. The configured DATABASE_URL identifies the dialect.
The selected DTOs are hydrated in the same read-only application transaction and
reassembled in the database ID order. Counts use only the base filters, excluding
the selected status and cursor. No write operation is part of GET.

The versioned cursor carries an ISO millisecond timestamp, technical conversation
ID and hash of the normalized filter/user/company/role/limit context. It is
base64url encoded and HMAC-SHA256 signed with the existing AUTH_SECRET, with domain
separation from session signing. No new secret or configuration is required.
Tampered, malformed or context-mismatched cursors are rejected. Every request
reauthenticates and reapplies permissions; the cursor grants no authority.

The list uses an explicit **Carregar mais** button, preserving selection and
deduplicating IDs. Filter or session-scope changes clear pages and restart at the
first page. Generation checks and AbortController discard stale responses even
when a transport ignores abort. A failed additional page keeps existing rows and
the prior cursor. Retry reloads the list from its beginning.

Silent refresh rereads the loaded prefix from page one, committing the replacement
only when all requested pages succeed. Its delay scales at 3 seconds per loaded
page, avoiding multiplying the average polling request rate with list depth.
Loading more can interrupt a refresh; duplicate load-more requests are suppressed.
Fetched pages retain backend order. Single-item live/optimistic updates use the
same effective timestamp and descending ID tie-break instead of message presence.

As with any keyset over mutable activity, pages describe the database at each
request, not a permanent cross-request snapshot: messages/status/permission changes
can move rows between requests. Loaded-prefix refresh reconciles these changes,
and client dedup prevents repeated cards. Static data traversal is tested for
complete 100/100/50 coverage with deterministic ties. No artificial Message is
created; existing summary fallback renders message-free cards.

Disposable PostgreSQL tests cover ordering before LIMIT, cursor traversal,
filters, tenant/agent/archived isolation, tampering and zero GET writes. The
20,000-conversation fixture also emits sanitized EXPLAIN ANALYZE metrics. Initial
local PostgreSQL 17 measurement: ordered SELECT 23.8 ms; full page plus counters
59 ms. No schema/index migration is included. A future expression index should
be considered separately if representative production-scale measurements warrant
it; these fixture timings are not a production latency guarantee.

Rollback is a code revert: no data, schema, worker or transport changes are
required. This PR does not deploy, alter Railway, activate the OpenCredit worker,
process jobs or access production. Tests mutate only disposable synthetic fixtures.
