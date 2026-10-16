# Chatbot Meta reply correlation V1

## Scope, base and existing behavior

Base: 7b5ade7b23d1bab9c8d4881978b3cb745821b848.
Main checked: 872c103d67e9440df6c158b21672582ee6a92b9e; subsequent OpenCredit
files do not overlap this package. No local merge or rebase is performed.

The verified webhook still authenticates its channel/signature and delegates
normal contact/conversation resolution, notifications, human assignment and
existing AI decisions to processInboundMessage. None of those decisions changes.
No ChatbotSession, ChatbotEvent or ChatbotOutbox is created/advanced here.
There is no worker, cron, timer, Next.js after(), fire-and-forget or automatic
processor invocation.

## Durable ingestion, not inline correlation

Message.metaReplySnapshot stores the original versioned, validated envelope in
the SAME INSERT as the inbound Message. There is no second insert/dual write,
queue acknowledgement or campaign query on this path. A failed INSERT commits
neither message nor snapshot and the existing webhook retry behavior applies.
Snapshot size is bounded to 24 KiB. Typical fixtures are considerably smaller.
Free-text content remains only in Message.body; the snapshot does not copy it.
Message DTOs are explicit and do not expose these internal fields.

Evidence includes original company/channel/contact/conversation/provider/context
IDs, interaction type, option identity/title, original timestamp and a scoped
sender identity digest. A content digest also detects different bodies/media
under otherwise identical IDs without copying text into the snapshot. These
digests are pseudonymized personal data, not anonymous data; access, retention
and backup controls still apply. No raw sender number,
credentials or whole provider payload is copied.

An identical replay adds no write. A divergent replay preserves the original
snapshot and records the FIRST conflicting snapshot in
Message.metaReplyConflictSnapshot. Further variants cannot replace that evidence:
the message is permanently quarantined for future execution. This bounded policy
does not retain an unlimited replay log. Legacy messages without an original
snapshot are not backfilled from a later replay whose originality is unknown.

The rare conflict write has maxWait 50 ms, transaction timeout 200 ms and, on
PostgreSQL, statement_timeout 75 ms / lock_timeout 50 ms. No retry occurs inside
this ingestion operation. A failure is explicitly retryable: the webhook keeps
advancing through later messages in the batch and returns HTTP 503 afterwards,
rather than acknowledging lost conflict evidence. Normal core-inbound failures
keep their previous error behavior. No query is abandoned using Promise.race.

There is zero campaign-resolution time budget in the webhook: it never invokes
the consumer. Network/database availability of the EXISTING Message INSERT is
still required; this feature cannot acknowledge a message that was not persisted.

## Explicit processor and recovery

Only a privileged operator with the intended database environment invokes:
```powershell
npx --yes tsx@4.20.6 scripts/process-meta-replies.ts --company-id COMPANY_ID --channel-id CHANNEL_ID --limit 20
```

No database URL or secret is printed. The executable has no public HTTP endpoint.
A future authenticated internal endpoint or scheduler requires separate approval;
it must derive/authorize company/channel scope, not trust an unprivileged caller.

Pending means an inbound/customer Message with a snapshot and no correlation.
Errors leave that evidence pending, not deleted or acknowledged as processed.
The partial Message snapshot index avoids indexing every legacy message.
Each invocation is scoped and limited to 1..50 records. Results report scanned,
processed, busy, errors, nextCursor and hasMore, without customer data.

Use --after-id with the returned cursor to continue scanning; restart without a
cursor on the next pass to revisit failures/busy rows. Poison evidence is reported
with a fixed error code and needs investigation, not silent modification.
--reconcile also revisits NOT_FOUND with SOURCE_NOT_FOUND or NO_CAMPAIGN, e.g.
when an outbound/recipient was persisted late. Terminal ambiguous/conflict rows
are not automatically retried. Explicit refresh also requires full scope.

Default scan budget is 3000 ms, configurable from 100..5000 ms. This is an
admission budget: no new item starts after the deadline; an admitted transaction
may finish afterwards. Transactions have maxWait 100 ms and timeout 2000 ms.
PostgreSQL also enforces statement_timeout 250 ms and lock_timeout 100 ms.
Only one serialization/unique-conflict retry is allowed, never a timeout retry.
Server-side cancellation avoids leaving a running query behind a JS-only timeout.

PostgreSQL locks the inbound row with FOR UPDATE SKIP LOCKED in the SAME
transaction as correlation. Concurrent consumers may report busy, never execute
twice. The lock also serializes processing with replay quarantine. SQLite uses
its write serialization, unique keys and bounded transactions. No session lease,
chatbot action or outbound command is involved.

## Verifiable campaign and phone chain

Campaign processing atomically persists Message.providerMessageId and matching
CampaignRecipient.providerMessageId/conversationId after a send. Only a unique
outbound plus a unique recipient with exact company/channel/contact/conversation
agreement confirms a campaign. Neither timestamps nor recent campaigns select
an origin. Missing/ambiguous context has an explicit non-confirmed outcome.

The sender digest MUST match CampaignRecipient.phone: that is the actual
destination used by sending, not today's Contact.phone. Missing destination or
a real mismatch becomes CONFLICT, even if all contact IDs match. Official phone
normalization tolerates masks/DDI but invents no ninth-digit equivalence. A
changed contact phone cannot substitute for missing historical send evidence.

Template quick replies preserve payload only when supplied; interactive buttons
and lists preserve actual IDs. Title-only options retain null optionId and an
explicit limitation, never a fabricated slug/technical identity.

No campaign-to-flow configuration exists yet. Only an unambiguous historical
session binding to the exact recipient supplies a candidate version. A candidate
is NOT authorization to execute/resume; Stage 3 must validate explicit flow
configuration and current human authority. CURRENT/AI rules are unrelated.

## Integrity and local SQLite setup

ChatbotEvent requires a session, hence the separate passive correlation model.
Composite FKs keep scope coherent; provider/inbound unique keys deduplicate.
confirmedAt records the first confirmed chain. PostgreSQL triggers freeze ALL
confirmed columns except status, reason and updatedAt; confirmation evidence
stays frozen after quarantine. CONFIRMED can only remain itself or become
CONFLICT/REPLAY_CONFLICT. CONFLICT cannot be reset to CONFIRMED.
NOT_FOUND reconciliation can acquire its first verified chain/confirmedAt.

Message snapshots are immutable after INSERT, including null legacy snapshots.
Only the first conflict snapshot can be appended; it cannot be cleared/replaced.
A database trigger quarantines an existing receipt in the same transaction.
Deletion of an original business record may cascade passive receipts, preserving
existing deletion/retention paths; this is not an append-only legal audit archive.

The unpublished PostgreSQL migration includes these guards. Prisma db push does
not install triggers: local SQLite setup must explicitly call
installReplySqliteIntegrity(db, isolatedFileUrl) after db push. It is never called
by the webhook/consumer and refuses a non-file URL. The mirrored column list is
checked against Prisma's model by tests to catch drift. All integration fixtures
install and test the SQLite guards; PostgreSQL uses the formal migration.

## Rollout, rollback and validation

Apply the complete formal migration chain before deploying the generated client
and snapshot writer. No production migration is executed in this delivery.
A missing snapshot column fails ingestion instead of silently losing evidence.
Database deployment remains a separately authorized operation.

Rollback plan: stop explicit consumers, deploy the previous application/client,
preserve/export snapshots and receipts, then (only with separate authorization)
drop the new triggers/functions, passive table, supporting indexes and the two
Message metadata columns. Never delete Message/body or commercial entities.
No backfill, cleanup of real duplicates or production data repair is included.

Tests cover atomic persistence/failure, replay conflict, original and historical
phone disagreement, late persistence, scope isolation, concurrency, direct ORM/SQL
immutability and a server-cancelled 20-second query. CI Verify runs actual
ambiguous-source/recipient cases via deterministic unit fixtures; the PostgreSQL
job ALSO executes real legacy-corruption fixtures inside a transaction that
temporarily removes duplicate-ID indexes and always rolls back, restoring both
indexes. There are no silent skips for missing CI database configuration.

## Measured local audit

The original inline timeout took 20920 ms over four attempts. The corrected
explicit processor cancelled a PostgreSQL pg_sleep(20) statement in about
272 ms, with one attempt, leaving the original snapshot pending for retry.
The webhook never invoked that consumer.

On the final local production build, 12 signed synthetic HTTP calls measured
P50 43.8 ms / P95 57.5 ms. A conflicting replay under a row lock returned 503
in 225 ms including processing the later batch message; that later message was
persisted. Re-delivery returned 200 without another message/notification.
No correlation existed before manual processing; the explicit batch processed
15 records and a second invocation scanned zero. A body-only divergent replay
also preserved its original body and was quarantined.

A separate 40-pair PostgreSQL INSERT benchmark measured baseline P95 5.85 ms
versus atomic-snapshot P95 8.67 ms. These small, local samples demonstrate the
removed blocking path, not a production load-test or SLA guarantee. Test company
fixtures were removed; no production, real Meta send or OpenAI call occurred.
