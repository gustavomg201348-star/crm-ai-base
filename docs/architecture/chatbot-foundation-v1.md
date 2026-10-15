# Chatbot foundation V1

## Scope

Internal persistence only. No public endpoint, UI, webhook registration, campaign
execution, scheduler, worker, Meta/OpenAI request or outbound message is added.
The caller explicitly supplies a PrismaClient to `createChatbotFoundation`.
There is no import into the current application runtime.

`HANDOFF` declares the existing default human queue, never a specific agent.
Neither the definition nor suspending/closing a session changes Conversation,
agent assignment, queue, messages or other commercial entities in this stage.
Actual handoff and campaign opt-in configuration require a separate delivery.

## Persisted models

- ChatbotFlow: company ownership, active flag, published pointer, revision and
  monotonically allocated version numbers.
- ChatbotFlowVersion: JSON serialized as String in both Prisma providers;
  DRAFT -> PUBLISHED, immutable after publication. New edits create a new version.
- ChatbotSession: company, channel, conversation, contact, original published
  version, optional campaign/recipient pair, current step, revision and expiry.
- ChatbotEvent: company/channel-scoped idempotency key, canonical payload hash,
  bounded attempts, availability, lease token and claimed session revision.
- ChatbotOutbox: future commands linked to session AND event, idempotency key,
  bounded attempts and states including UNCERTAIN. No sending code exists.

Composite foreign keys prevent mixing company, channel, contact, conversation,
flow version or campaign recipient. Existing tables receive supporting composite
unique indexes that include their existing primary keys; no existing record is
rewritten or deduplicated by this migration.

## Definition contract

```json
{
  "schemaVersion": 1,
  "entryStepId": "welcome",
  "steps": [
    { "id": "welcome", "type": "TEXT", "text": "Ola!", "next": "choice" },
    {
      "id": "choice", "type": "BUTTONS", "text": "Como podemos ajudar?",
      "options": [
        { "id": "details", "title": "Informacoes", "next": "catalog" },
        { "id": "human", "title": "Falar com equipe", "next": "handoff" }
      ]
    },
    {
      "id": "catalog", "type": "LIST", "text": "Escolha uma opcao",
      "buttonText": "Ver opcoes",
      "options": [{ "id": "general", "title": "Geral", "next": "answer" }]
    },
    {
      "id": "answer", "type": "INPUT", "text": "Descreva sua necessidade",
      "variable": "request", "maxLength": 500, "next": "route"
    },
    {
      "id": "route", "type": "CONDITION", "variable": "request",
      "branches": [{ "equals": "atendente", "next": "handoff" }],
      "otherwise": "end"
    },
    { "id": "end", "type": "END" },
    { "id": "handoff", "type": "HANDOFF", "queue": "DEFAULT" }
  ]
}
```

No scripts, expressions or arbitrary extra properties are accepted. Conditions
declare literal equality only; evaluation is not implemented. All destinations
must exist and all steps must be reachable. All cycles are rejected in V1.

Limits: 64 KiB, 100 steps, 3 buttons, 10 list options, 10 condition branches,
1024 code points per message, button title 20, list title 24, description 72,
list button 20, input length 1..2000. IDs are opaque stable lowercase labels
(letter first, letters/digits/underscore/hyphen, max 64), unique within each
step's options. Long numeric runs and phone/email/document-shaped IDs are
rejected syntactically. This is not a semantic PII detector: authors must never
encode personal data in IDs. Text and event payloads may be sensitive; do not
log them. Event payloads are capped at 8 KiB.

## Internal service contract

- createDraft / createDraftVersion: validate and create a fresh version.
- publishVersion / getPublishedVersion: scoped publication/read.
- createSession / getSession: validate references, reserve or read the session.
- suspendSession / closeSession: compare expectedRevision, persist state and
  cancel pending/retry/processing commands.
- recordEvent: scoped deduplication with conflict detection.
- claimEvent / finishEvent: internal lease and retry bookkeeping only; do not
  execute steps or commands.

These are trusted internal services, not authentication boundaries. A future
API must derive companyId from its authenticated session, authorize the user
and channel, and must not accept an arbitrary client-supplied companyId.
All public operations reject missing, null, blank or incorrectly typed scope
and required filter references before any Prisma access, including opening a
transaction. Validated parameters are snapshotted across awaits without defaults
or identifier normalization. Revision guards require nonnegative safe integers;
optional campaign references must form a valid pair when supplied. Internal
session reads and command cancellation also guard their scope.

## Concurrency, authority and recovery

Serializable transactions retry supported transient/conflict errors at most
four times. A nullable unique activeConversationId reserves one occupied slot
for ACTIVE or SUSPENDED; CLOSED/EXPIRED release it. An equivalent concurrent
create returns the existing session; different versions/campaigns conflict.

Session mutations compare revisions. Only one unexpired event lease per session
is claimed through these services. Leases last 30 seconds, use fresh random
tokens and capture the session revision. Late completion, superseded leases,
human authority, suspension and expired sessions cannot finalize an event.
Default maxAttempts is 3; retry backoff is 1000 * 2^attempts milliseconds.
No process wakes up automatically to claim events or perform retries.

Deduplication is durable under (companyId, channelId, idempotencyKey). Repeated
events must preserve the original occurredAt and payload; changed content under
the same key raises IDEMPOTENCY_CONFLICT. Events older than the session cannot
enter a new session. Matching duplicates remain readable after suspension.

Human intervention/handoff sets explicit HUMAN authority, independent of agentId.
Any historical HUMAN session blocks automatic creation for that conversation,
including after close/expiry. There is intentionally no resume/release method:
a future authorized explicit human release policy is needed before resuming.
Other suspensions also never resume implicitly. Expiration is lazy on session
read/claim/create; no cleanup cron is installed. Rejected transactions roll back
their changes; getSession is the explicit lazy-expiry read that persists expiry.

Outbox states model future delivery uncertainty. The schema does not provide
exactly-once delivery to an external provider; no command enqueue/send/reconcile
service or provider retry policy is claimed in this stage.

## Validation and database differences

The formal PostgreSQL migration follows the repository baseline. It adds CHECK
constraints and a trigger rejecting updates/deletes of published versions.
Prisma 5 cannot represent these extras in its datamodel. SQLite db push has the
same models/indexes/FKs, with version immutability and state guards enforced by
the internal services, not that PostgreSQL trigger. Direct SQL is not a supported
application write path. Keep the SQL extras when generating future migrations.

Unit tests use node:test through an already available TypeScript runner.
Scope security tests use a rejecting Prisma proxy to assert zero database access
for invalid inputs. Integration tests require
CHATBOT_FOUNDATION_TEST_DATABASE_URL explicitly set to a fresh materialized
SQLite in the OS temp directory, named qevora-chatbot-foundation-*.db,
synchronized with schema.prisma, or explicit CHATBOT_FOUNDATION_POSTGRES_TEST=1
with a loopback PostgreSQL database named qevora_chatbot_test. Other hosts/paths
are refused. Tests create synthetic fixtures only. Delete the disposable database
after the test, never a project database. Without the URL, integration is explicitly
skipped locally but fails in CI rather than silently skipping essential coverage.

The existing CI Verify job runs definition and scope tests. The existing
PostgreSQL job creates a separate qevora_chatbot_test database in its disposable
service container, applies the migration chain and runs the foundation integration
suite, including published-version trigger, CHECKs and concurrent event claims.
It does not share test data with the other integration suites or use real secrets.

Before production rollout, apply the complete baseline plus this migration to
disposable PostgreSQL and test the CHECKs, immutable-version trigger, composite
FKs and concurrent transactions. SQLite integration does not prove those
PostgreSQL-only guarantees.

## Rollout and rollback

No production database was migrated by this implementation. Review and test
the formal migration before authorizing deployment; it adds indexes/FKs to
existing tables and may acquire locks. No existing workflow is wired to it.

Before use, application rollback is simply removing this isolated package.
Database rollback requires a separately approved plan: export/backup new chatbot
records first, remove dependent chatbot objects in reverse order (including the
published-version circular FK), then the added supporting indexes and trigger
function. Do not drop existing business tables or delete commercial data. Once
used, prefer a forward repair rather than discarding session/event history.
