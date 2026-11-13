# Task pagination V1

Base: a0dd1831d5839efd3ed8e9756db84835a89422d5. No schema, migration or export.

GET /api/tasks retains `tasks` and adds top-level `hasMore` and `nextCursor`.
`limit` defaults to 100 and accepts canonical decimal integers 1..1000.
Empty, null-like, fractional, repeated and out-of-range values return 400 before
reading tasks. A one-row lookahead means at most 1001 internal rows are read;
at most 1000 are returned. No count or offset/skip query is added.

Order: status ASC, dueAt ASC, id ASC. The cursor signs the last value tuple,
not a mutable database anchor. HMAC-SHA256 uses AUTH_SECRET and a task-specific
domain. Development follows the existing local authentication fallback; production
does not introduce a default secret. Cursor lifetime is one hour. The signed
scope binds company, authenticated user, role, contactId, assigneeId and status.
Changing page size is allowed. Changing filters/user/company/role requires a
fresh page. Company is always taken from the authenticated session; an explicit
client companyId is rejected. Invalid, expired or altered cursors return 400.

## Preserved access policy

The GET scopes all reads by authenticated company. For AGENT, the effective
assignee is always the authenticated user, including in the contact drawer;
query assignee values are ignored. ADMIN and SUPERVISOR retain company-wide
visibility and optional assignee filters. The cursor signs the effective filters,
so older cursors for broader agent queries cannot be reused. POST/PATCH ownership
and reassignment behavior is unchanged.

## Clients and consistency

The returns modal and contact tasks panel explicitly request pages of 100 and
offer manual load-more, loaded counts, errors, refresh and EOF. There is no
automatic 1000-item download or claimed global total. Append errors retain rows
and cursor for manual retry. Refresh also retains rows and cursor until a valid
first page succeeds, including while loading. Generation checks and abort prevent stale requests
from closed/reopened or switched contacts from replacing current data. Mutations
and identity deduplication prevent later pages from resurrecting completed rows
or overwriting a reschedule already applied in the UI.

Old tabs can read the new API through the retained `tasks` field. A legacy
`{ tasks }` first page remains visible in the new UI with an unknown total,
without load-more or a claim of completeness. A legacy response to a continuation
is not merged: refresh is required. Both consumers send the own-assignee filter
for AGENT, including when talking to an old server. This is not a server-side
security guarantee on rollback: older server code lacks the AGENT read restriction.

Stable datasets have complete, nonduplicated traversal, including equal dates
and statuses. This is a live list, NOT a database snapshot: inserts or moves
before the last key are visible on refresh; a task moved forward can appear
again in the API, and the clients deduplicate by id. Deleting or changing the
anchor does not invalidate its signed historical tuple. Concurrent status/filter
changes can legitimately remove or move results. Expired cursors require refresh.

## Validation and rollback

Synthetic route/controller tests cover boundaries 0/1/100/101/1000/1001,
combined filters, ordering, signed cursor abuse, companies, roles, legacy GET,
unchanged PATCH, concurrent mutations, manual retry, cancellation and saturation
of page requests. They use no real customer data or database writes. Real SQL
plans and production/browser performance are not claimed by in-memory tests.
The CI adds these suites without replacing existing jobs. Rollback is code-only;
no migration, stored cursor or new infrastructure needs reversal.
