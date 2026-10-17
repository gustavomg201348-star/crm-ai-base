# Shared conversation authority: passive foundation (4.1B)

No API, sender, webhook, campaign, worker, scheduler or production consumer imports these services.
There is no Meta/OpenAI transport, Message writer, assignment writer or chatbot activation.
Only ConversationAuthority, OutboundOperation and AuthorityEvent are written by the services.
The source of actorUserId must be a trusted authenticated adapter in a later stage; a request body is never sufficient.

## Contracts

- Scope requires nonblank, correctly typed companyId, channelId and conversationId before database access.
- Initialization is an explicit ADMIN/SUPERVISOR command: HUMAN_QUEUE, HUMAN or CLOSED. No legacy inference, automatic backfill or initial AI grant.
- HUMAN requires an existing user of the same company. AGENT may assume only an accessible conversation for themselves, not transfer another human's authority.
- AI acquisition is an explicit administrative transition; CLOSED cannot transition directly to AI. Returning HUMAN to HUMAN_QUEUE never enables AI.
- CHATBOT acquisition and outbound origin are rejected unconditionally. The deterministic execution engine is unchanged.
- Generation is a nonnegative signed 64-bit bigint, independent from session/motor revision. State/owner changes increment exactly once; no-ops and idempotent replays do not.
- Runtime uses BigInt constructors for compatibility with the existing TypeScript target. Future JSON adapters must encode generations as decimal strings.
- Administrative idempotency is company/channel/logicalKey plus a canonical fingerprint including conversation, actor, expected generation and requested change. Conflicting reuse fails.
- Public mutation methods capture input properties before validation. Scope fields are read once, validated from that snapshot and copied to database filters; the scope helper returns a frozen object. Accessors cannot replace a validated company with undefined on a subsequent read.
- Campaign intent does not acquire or change authority. ADMIN/SUPERVISOR campaign intent may reserve under HUMAN_QUEUE/HUMAN/AI, but never CLOSED.
- Existing CRM permission, aiMode and campaign eligibility checks must ALSO be preserved by future adapters; this foundation does not replace them.

## Operations

PREPARED -> RESERVED -> DISPATCHING -> SENT / FAILED / UNKNOWN, plus CANCELED before dispatch.
Preparation freezes the canonical content, destination derived from the scoped Contact and generation. Idempotency includes this immutable intent.
A unique nullable activeSlot equal to authorityId enforces one RESERVED/DISPATCHING/UNKNOWN per authority.
Reservations expire after 30 seconds by default (100ms..60s configurable for controlled tests). Reacquisition rotates the token.
Dispatch authorization is one-shot and not replayable. It rechecks authority generation, lease, actor eligibility, active channel and unchanged destination.
PostgreSQL checks leaseUntil against clock_timestamp() AT TIME ZONE 'UTC' inside the dispatch UPDATE itself, matching Prisma's UTC TIMESTAMP storage; eligibility queries cannot consume the remaining lease and still produce a permit. Deadlines use the same explicit UTC conversion regardless of server timezone.
DISPATCHING records a 60-second recovery deadline, not permission to retry. Expiration moves to UNKNOWN and retains the slot/token.
Authority changes cancel PREPARED/RESERVED atomically, but preserve DISPATCHING/UNKNOWN. Late completion only changes the ledger, never the human state or assignment.
SENT means confirmed provider acceptance, not delivered/read. FAILED is only for a definitive negative outcome; timeout/crash/ambiguous acceptance MUST use UNKNOWN.
Terminal operations cannot be retried through reserve. A genuinely new logical action needs a new key; callers must never mint keys to disguise UNKNOWN retries.

## Transactions and recovery

Transactions are Serializable with bounded retries for pre-effect unique/serialization conflicts. Lock authority before operations/events; never call external systems inside a transaction.
Every PostgreSQL service transaction awaits its callback, runs SET CONSTRAINTS ALL IMMEDIATE, and only then returns to Prisma for COMMIT. A deferred failure is therefore raised by the ordinary query path, not deferred to the affected Prisma commit decoder. All pending constraints are checked, including future/custom constraints, not only today's two audit triggers. No writes or transaction-control commands may be scheduled after the gate; consumers must not issue manual COMMIT/ROLLBACK inside the managed callback. Savepoints with proper rollback/release remain supported.
PostgreSQL row locks, unique slots, generation CAS and reservation tokens protect independent clients. PostgreSQL clock_timestamp governs leases; SQLite uses the local clock for portability tests.
The DISPATCHING commit is the authorization cut, not an atomic external delivery. A future transport can still be in flight when a human assumes control; no exactly-once external promise is made.
recover() is explicit and scoped: expired RESERVED can release safely; expired DISPATCHING becomes UNKNOWN; UNKNOWN never releases automatically.
reconcileUnknown() requires ADMIN/SUPERVISOR, a unique audit command, evidenceReference, explicit executorTerminated=true and definitive SENT/FAILED classification.
The service cannot prove external executor termination: this is an operator attestation referencing evidence, NOT a timeout inference. No consumer may auto-attest.
Reconciliation atomically records immutable audit evidence and releases the slot without changing authority generation. PostgreSQL additionally requires that audit via a deferred constraint trigger.
Ambiguous evidence means keep UNKNOWN. An expired lease alone is never proof that a stalled executor cannot resume.

## Persistence, isolation and rollout

Both Prisma schemas add the same three models, reverse relation fields and a User(companyId,id) unique key for composite actor/owner FKs.
Composite FKs bind authority to company/contact, company/channel and the exact conversation/contact/channel tuple. Binding cannot be moved across scope.
The PostgreSQL migration is additive: no existing data rewrites, backfills or behavior triggers on existing CRM tables. Its extra CHECKs/triggers protect state shape, generation, immutable intent and append-only audit.
PostgreSQL forbids physical DELETE and TRUNCATE of the authority/operation ledger, including terminal operations. Parent relations are RESTRICT; deleting a company/contact/channel/conversation cannot cascade through this ledger. Retention/export requires a separately approved administrative procedure, not an ORM delete or a retry with a new logical key.
AuthorityEvent records old/new state, generation and human owner, plus actor/reason. Owner IDs are immutable historical snapshots, not mutable display names. There is no session owner in this passive foundation; CHATBOT is blocked, so no fictitious owner-session ID is recorded. A future session-authority adapter must extend this contract explicitly.
PostgreSQL checks the transition matrix immediately and requires an exact INITIALIZE/TRANSITION audit snapshot. AuthorityEvent.auditTransactionId is overwritten on every INSERT by a BEFORE trigger with pg_current_xact_id()::text, the epoch-aware top-level transaction ID. Caller-supplied values cannot choose that stamp; append-only guards prevent changing it later. Unlike xmin (a tuple's inserting subtransaction), this ID is stable across savepoints. Rolled-back evidence disappears and cannot satisfy the guard; a committed event from another transaction cannot authorize a new mutation. UNKNOWN reconciliation requires the same fresh stamp as well. Deferred checks permit the existing lock -> update -> event order, then the storage gate forces validation before COMMIT. policyVersion is immutable in this stage.
An ordinary ORM mutation without the corresponding event rolls back. This is database integrity, not authentication: a database writer able to fabricate both the mutation and audit data is still trusted. Future APIs must obtain actor/scope from authenticated adapters. A database owner/superuser able to disable triggers or drop tables is outside this protection boundary.
SQLite db push provides matching fields, FKs and uniqueness, but does not install PostgreSQL guards or SQLite triggers. After db push in an explicitly authorized isolated SQLite, execute each statement in prisma/sqlite/conversation-authority-guards.sql (separated by the '-- statement' marker) using the same connection/database. The test suite performs this explicit bootstrap and tests DELETE protection and append-only events. No application startup installs guards implicitly. Reapply the bootstrap if db push rebuilds a guarded table.
SQLite with this bootstrap protects physical ledger deletion; it does NOT provide the PostgreSQL deferred transition/audit or immutable-intent guarantees. Direct SQL updates remain trusted on SQLite. Services enforce the runtime transition rules on both providers; use PostgreSQL for production integrity and concurrency acceptance.
SQLite stores an empty auditTransactionId by default; it is not a PostgreSQL transaction proof and must never be treated as one. Both Prisma schemas expose the same scalar field. PostgreSQL's INSERT trigger and CHECK provide the stronger provider-specific guarantee without a new table or authority state.
Production migration execution is outside this task. Validate on a fresh disposable PostgreSQL first; never use db push in production.
Rollback before any consumer: revert application references (there are none) and leave additive tables inert. Do not drop audit/UNKNOWN data to roll back; schema removal requires a separately approved retention/export plan.
Later rollout needs shared flags, admission tracking and draining legacy instances. This foundation has no feature flag capable of enabling chatbot or transport.

## Commit decoder and savepoint blockers: investigation and decision

The pre-fix defects were reproduced independently before editing, on Prisma Client 5.22.0 / engine 605197351a3c8bdd595af2d2a9bc3025bca48ea2 and PostgreSQL 17.10. An unaudited UPDATE rolled back at COMMIT, yet the interactive transaction promise resolved. A real service delegate inserting its audit under SAVEPOINT returned a phantom event/generation while the persisted generation and reserved operation stayed unchanged.

Instrumentation existed only in TEMP. The native commitTransaction response contained is_panic=false, message and backtrace, but no error_code. The installed library.js transaction decoder recognizes an engine error only when error_code is present; _transactionWithCallback then returned its cached callback result. This is not a PostgreSQL commit success and no separate node-postgres driver is installed: the local client uses the native Rust query engine. No dependency/runtime or private Prisma API is patched by this feature.

Experiments compared deferred P0001, 23514 and 40001 errors. Changing only to 23514 still produced false success, so that alternative was rejected. A deferred 40001 produced P2034 at COMMIT and was rejected correctly. Explicit SET CONSTRAINTS ALL IMMEDIATE propagated P2010 before COMMIT in all three cases. Terminating only the synthetic transaction's backend before COMMIT produced P1017 and no persisted mutation. The existing bounded conflict retries are retained; constraint violations are not reclassified as retryable.

Alternatives considered:
- Upgrade Prisma/replace the driver: not selected; broader dependency/runtime change with no experimentally validated version in this package.
- Remove deferred audit checks or trust client metadata: rejected; weakens database integrity.
- Require audit before every UPDATE with immediate triggers: rejected; changes initialization/FK and service ordering substantially.
- Read result rows after COMMIT as the sole proof: rejected; mutable operations can change concurrently, and row existence alone cannot prove a reservation/dispatch update committed.
- Flush deferred constraints through a normal query plus stamp the top-level transaction in the existing audit row: selected; small storage/metadata change, no new entity or emitter integration.

The fix does not repair raw Prisma interactive transactions elsewhere in the application. Authority consumers must use this storage protocol; direct ORM writes retain database rollback protections, but callers bypassing the gate cannot trust Prisma 5.22's acknowledgement of an unmapped deferred commit error. Network loss can still make a caller uncertain about an already accepted commit; no external exactly-once guarantee or blind resend is introduced.

The legacy OpenCredit RESTRICT helper also accepts Prisma P2003 only when meta.field_name exactly matches an expected constraint (including Prisma's optional ' (index)' suffix). PostgreSQL 17 reports the same effective FK rejection as P2003/23503, while PostgreSQL 18 can report PrismaClientUnknownRequestError/23001. Existing unknown-error checks and record-preservation assertions remain unchanged. This portability mismatch was reproduced against main without authority; no production behavior or migration was changed for it.

Preexisting local test-loader limitation: on Windows with Node 20.20.2, Prisma 5.22.0 and tsx 4.20.6, four OpenCredit suites have 17 failures caused by duplicate CJS/ESM evaluation of error classes (instanceof fails). The same 17 failures were reproduced on main without authority; the same 412 tests pass on Node 24.14.1. These four suites (bank-capabilities, connection, list-banks and proposal-status) are not currently selected by CI. This is not evidence of a Linux CI failure. No production error mapping or assertions are changed to mask the loader issue; unifying that test harness is separate work. Required CI suites must still pass under Node 20.

Integration reference: main 7ee4dc126ac81a7f70909f52cc1f0988753c2b4b. Both schemas retain all OpenCredit models and reverse relations. CI retains the eleven additional OpenCredit steps and adds isolated authority SQLite/PostgreSQL execution. The additive authority migration follows the same-timestamp OpenCredit access-audit migration by full directory-name ordering; validate the complete combined chain on a fresh disposable PostgreSQL, never production.

Post-integration local validation used Node 20.20.2 and a dedicated PostgreSQL 18 container: all 15 migrations applied, all existing PostgreSQL CI steps passed, and authority passed 34 tests after correcting a stale workflow copy in the disposable harness (no assertion change). SQLite authority passed 25 tests on a fresh TEMP database. All eleven unit-test commands selected by Verify passed; sixteen separate helper portability/negative probes passed. Remote GitHub Actions remains an independent publication gate.

## Reproducible tests

Run with a freshly generated provider-specific Prisma Client and a dedicated disposable database:

`npx tsx --test src/lib/conversation-authority.test.ts`

SQLite requires AUTHORITY_TEST_DATABASE_URL=file:<absolute TEMP>/qevora-authority-<unique>.db.
PostgreSQL requires AUTHORITY_POSTGRES_TEST=1 and AUTHORITY_TEST_DATABASE_URL pointing to localhost/127.0.0.1 database qevora_authority_test, never a shared or remote database.
Missing integration configuration fails rather than silently skipping. Each run uses synthetic fixtures; destroy the entire disposable database after tests rather than deleting append-only audit records.
Tests use independent Prisma clients, real database transactions, takeover/dispatch races, injected audit failure/rollback, scope negatives, replay, leases, UNKNOWN recovery and SQL constraints.
Permanent adversarial regressions include unstable scope accessors on every public operation, owner history A -> B -> C, DELETE/deleteMany across all operation states, parent cascade attempts, UNKNOWN slot retention/conflicting replay, and PostgreSQL direct matrix/audit bypass attempts. PostgreSQL tests also reject audit reuse from an older transaction and unaudited initialization.
Blocker regressions compare returned events/generations with persisted rows, exercise real savepoint audit delegates and rollback-to-savepoint, forge/reuse transaction stamps, inject a late deferred database constraint, reject unaudited UNKNOWN release, and terminate only a disposable backend. A raw-Prisma diagnostic records the old behavior without requiring a future driver version to preserve its bug; the protected service must reject regardless.
CI explicitly runs this suite against a fresh TEMP SQLite and a separate qevora_authority_test PostgreSQL database, with configuration guards that fail instead of skipping. Existing OpenCredit, chatbot, migration and limiter jobs remain unchanged.
No real sender is implemented or called. A test-only fake Meta callback models acceptance followed by process death and checks that UNKNOWN recovery cannot authorize another send. Actual transport integration remains out of scope.
