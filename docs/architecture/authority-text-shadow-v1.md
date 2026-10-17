# Text authority shadow (4.2B)

Base: cc720456f9609ab70737240f2d54c2c4823985d9 (main after PR #120).
Only the channel and conversation text POST routes are instrumented, after existing authentication,
permission, channel and reply checks and immediately before the unchanged Meta call.
No authority schema, migration, emitter transport, campaign or AI behavior is changed.

## Configuration and rollback

QEVORA_TEXT_AUTHORITY_MODE is OFF by default. Only the exact value SHADOW enables observation;
unknown values, including ENFORCE, are OFF. There is no enforcement mode.
Set the variable only in an explicitly approved environment; nothing enables production automatically.
To disable, remove the variable or set OFF and restart/redeploy instances through the normal approved
operational process. Environment configuration changes are not a live cross-process kill switch.
Already scheduled reads can finish, but never acquire authority or dispatch anything.

SHADOW requires QEVORA_TEXT_AUTHORITY_DATABASE_URL, an explicit server-side datasource.
It may target the same database, but never falls back to DATABASE_URL or the db.ts client.
Missing/invalid configuration reports CONFIG_UNAVAILABLE without constructing a client.
Do not commit connection strings or enable this configuration in production without approval.
The private client is constructed lazily on the first eligible SHADOW read; OFF constructs none.

## Contract and comparison

The authenticated server provides company/channel/conversation, actor, current assignment and source.
No body/header can set the shadow company, owner, permission or authority generation.
The context has an optional stable intent identifier; both existing routes pass null because they do
not have a durable authenticated intent ID. No fictitious Meta ID or content-derived key is invented.
The selected authority snapshot includes its scope, owner, state and bigint generation.
Expected generation can only come from a future trusted adapter; these routes have no such token.
Therefore COMPATIBLE means a structurally valid HUMAN snapshot owned by the actor, compatible with
assignment. It is not proof of freshness, actor permissions, valid lease, free slot, Meta window or a
dispatch permit. Administrative sending for a different assigned owner is reported as divergent,
not blocked or silently converted to takeover. CHATBOT is never activated.

The pure evaluator returns COMPATIBLE, AUTHORITY_ABSENT, OWNER_MISMATCH, SCOPE_MISMATCH,
GENERATION_MISMATCH, STATE_INELIGIBLE or EVALUATION_ERROR with fixed reasons. Foreign scope and
invalid authority data do not contribute a state label. Unscoped/invalid contexts never query.
An avulso without a resolved conversation reports CONVERSATION_UNAVAILABLE without querying or
creating Contact, Conversation or ConversationAuthority for observation.

## Non-interference and bounded overhead

OFF performs no authority lookup or metric. SHADOW queues a detached read, never awaited by either
route. Request-object WeakSet deduplication limits this observer to one attempt per request; it does
not deduplicate HTTP replays or deliveries across processes. Separate HTTP attempts are observations
of separate legacy attempts. No durable deduplication claim is made without a stable intent contract.
The observer retains at most four pending observations; the private reader admits only one actual
read per JavaScript runtime and sheds additional attempts with CAPACITY, without a waiting queue.
Its independent Prisma pool has connection_limit=1, pool_timeout=1 and connect_timeout=1 (seconds).
It never occupies an Atendimento pool connection or constructs clients per request. A 100ms timer
emits TIME_BUDGET once; that timer is not query cancellation. Slots remain occupied until completion.

PostgreSQL reads use a read-only transaction with transaction-local statement_timeout=100ms and
lock_timeout=75ms. These server limits actually cancel blocked statements. Prisma transaction
maxWait and timeout are both 1000ms; this is not a 100ms wall-clock guarantee including connection
establishment/network failure. SQLite uses its own client/pool, socket_timeout=1 and transaction
limits; no PostgreSQL-style server cancellation is claimed for SQLite.
closeTextAuthorityShadow waits for outstanding work and disconnects only the private client. Tests
call it explicitly; a best-effort beforeExit hook handles normal process drain. No signal handler
intercepts application shutdown. Forced termination may lose telemetry; the OS closes sockets.
No replacement client is created to bypass a stuck operation.

Separate pools still share PostgreSQL max_connections, CPU, I/O and locks. Budget one extra
connection per runtime/worker/replica before rollout; globalThis is not shared across isolates.
No absolute database isolation is claimed.
Event-loop/stdout overhead cannot be literally zero: measure before production enablement.
A terminated process can lose a detached metric; this is best-effort telemetry,
not a queue, worker, retry, scheduler or reliable audit ledger. Queries/logging are never retried.
Reader errors, late outcomes, evaluation errors and logging/configuration failures cannot alter the
legacy response or trigger Meta again. Existing legacy failure classification remains unchanged.

## Metrics and privacy

One best-effort JSON stdout event authority_text_shadow contains only source (two fixed values),
result, fixed reason, allowlisted authority state or null, and bounded integer durationMs.
No company/conversation/channel/user/intent identifiers, generation values, payload, phone, CPF,
message, reply, media, credentials, raw exception or stack is logged. Invalid contexts are discarded
before emission. No external metrics service is required. Fixed labels avoid per-customer cardinality.
The private Prisma client uses log: [] and errorFormat: minimal, independently of db.ts. Raw Prisma
errors/causes never leave the reader; only fixed ShadowReadFailure reasons are exposed. Native
logging for all legacy modules is unchanged.

## Acceptance and validation

Unit tests cover pure decisions, OFF, errors, timeout/capacity, sanitization and per-request deduplication.
The actual two route bodies are transpiled in memory with explicit fake dependencies: OFF/SHADOW
must yield identical responses and legacy writes, exactly one fake Meta call on successful sends,
identical failures, no observation for unauthorized requests or the conversation inbound branch.
No real network call is made. SQLite integration reuses the disposable fixtures already populated by
the authority suite, calls the production scoped reader and verifies no ledger or commercial mutation.
Missing/mis-scoped test configuration fails, never silently skips. CI retains every existing step.
A permanent PostgreSQL test uses a one-connection legacy pool, an exclusive authority-table lock,
both actual route bodies, fake Meta and real Message inserts: OFF and SHADOW must return 200 with
identical bodies and one persisted Message while the shadow read is pending. It verifies server
cancellation, saturation in three processes (1000 shed reads each), interruption of the private
backend and reader recovery/restart. No real WhatsApp request is made.
An isolated child process corrupts a disposable SQLite value with a synthetic sensitive sentinel,
captures stdout/stderr and requires only a sanitized metric, never native Prisma output. Reader
tests hold a query indefinitely, shed 1000 attempts, verify bounded construction, shutdown/restart,
missing configuration and sanitized exceptions. No schema or migration is added.

Before rollout, compare latency/error distributions with OFF under representative concurrency.
No request waits for a slow or unavailable shadow database; one stuck private read sheds further work.
All scope, route behavior, sanitization and no-extra-send regressions must pass before publication.

Next categories, under separate authorization: media/templates, automatic AI, campaigns, retry and
assignment synchronization. They must share a durable intent/completion protocol before enforcement.
This change neither instruments those categories independently nor changes retry policy: retries that
already pass through a text route are observed there like any other HTTP attempt.

## Publication validation and timing caveat

The PostgreSQL shadow adversary now requires SHADOW_TEST_DATABASE_URL pointing only to the
local disposable qevora_shadow_test template migrated by CI. Each invocation clones that template
into a randomly named database, creates its own synthetic authority and drops the database after
disconnecting its clients. It does not depend on authority-suite fixtures or share their table locks.
The CI account needs CREATE DATABASE permission only in the disposable PostgreSQL service.
Connection inspection filters both the current database and the private reader application_name;
it asserts cancellation and absence of open private transactions. Saturation children have distinct
controlled application names. No production reader, pool, timeout or sending behavior is changed.
This fixes demonstrated test interference, not the historically inconclusive native SIGSEGV.

Isolation revalidation on Linux x64, Node 20.20.2, Prisma 5.22.0 and tsx 4.20.6 against
disposable PostgreSQL 18.6: 10 isolated runs, 3 sequential authority/shadow pairs, 3 concurrent
authority/shadow pairs and 3 concurrent shadow/shadow pairs all passed (28 process executions).
All CI test/validation commands passed, including both providers, complete disposable migration
chains, OpenCredit, build and verify. Dependencies were already installed; no remote CI was run.
One local harness attempt failed because GitHub runner.temp was not expanded and the PostgreSQL
flag leaked into SQLite; this failure was retained, the external harness alone was corrected and
execution resumed. No assertion, timeout, production code or retry policy was changed.
Post-run inspection found no cloned databases and no open private-reader transactions.
No native crash was reproduced; the historical SIGSEGV remains unexplained and needs explicit
risk review before publication. These results do not establish production safety of that failure.

Integrated main reference: 7d16ba1cf19136311b871523946c1b967b5a8df5. Both new OpenCredit
steps (strict raw JSON and trusted provider scope resolver) remain in CI.
The independent audit observed one SHADOW_READ_UNAVAILABLE failure whose original underlying
error was not captured; its cause remains inconclusive. During publication validation, a separate
cold-container run failed before PostgreSQL completed crash recovery (database system is starting
up). That setup failure does not establish the cause of the historical isolated failure.
After explicit database readiness, five independent executions of the permanent PostgreSQL test
passed. No automatic query retry, fallback pool, relaxed assertion or test retry was introduced.
Short deadlines can legitimately discard best-effort observations during environmental stalls;
they must never change the legacy send. Remote CI must pass before recommending a merge.

Publication is currently blocked: a subsequent full PostgreSQL regression run terminated the
permanent shadow test process with SIGSEGV. A temporary instrumented copy reproduced the native
termination in one of eight independent runs; the other seven passed. Ten simple TypeScript
Prisma SELECT controls and ten CommonJS controls without shadow imports passed. These controls
do not establish the cause of the crash or prove that the implementation caused it.
No retry, assertion relaxation, production dependency change or speculative functional patch was
added. Commit, push and PR creation were withheld pending diagnosis of this separate failure.
