# Conversation inbound durable event foundation

READY FOR DURABLE INBOUND CAPTURE (subject to validation/rollout).
Authenticated transport evidence is described in [durable inbound provenance](./durable-inbound-provenance.md).
PROSPECTA BRIDGE BLOCKED.
RUNTIME AUTHORITY INTEGRATION BLOCKED.
OUTBOUND LEDGER INTEGRATION BLOCKED.

## Purpose and coverage

For each new direction=inbound Message created through the production writers after
adoption, exactly one ConversationInboundEvent commits with it. This is a durable
fact, NOT a processing request, job, eligibility decision, consumer consent, human
identity proof or commercial authorization. senderType=customer does not prove that
an external sender is biologically human. There is no worker, AI/provider transport,
automatic lead linkage or new outbound behavior.

Production writer inventory:

1. Meta and existing sandbox ingestion via processInboundMessage -> persistInboundMessage.
2. POST /api/conversations/{id}/messages when direction is inbound.

Other Message creators (channel send, campaign, conversation outbound and failed-send
history) write outbound. prisma/seed.mjs is an explicitly invoked development fixture,
not a production ingress; it is unchanged and is not run by this slice. Unit writer
inventory fails when another production Message creator is added. New inbound writers
must use the shared transactional primitive. Direct SQL/fixture writers are trusted:
there is no database-wide trigger synthesizing events for arbitrary Message inserts.

## Sequence decision

A dedicated cursor table would require another model, FK and concurrent initialization.
The smaller solution adds Conversation.inboundEventSequence (signed BigInt, initial 0).
Within a Serializable transaction an atomic increment allocates 1, 2, ... for that
Conversation. A bounded WHERE prevents overflow/negative allocation. There is no
SELECT MAX(sequence)+1, global sequence, timestamp or random-ID ordering.
The parametrized UPDATE RETURNING combines scope/binding validation, row locking and
allocation in one SQLite/PostgreSQL statement, without changing updatedAt. No separate
scope read or counter reread is needed on the success path.

Message, original metaReplySnapshot when applicable, counter allocation and Event all
commit or all roll back. Distinct concurrent messages serialize through the same
Conversation row; separate Conversations have independent counters. The order is LOCAL
database allocation/commit order, not the order a person typed or Meta timestamps.
No external I/O occurs inside these transactions. Bounded retries cover only rolled-back
serialization/SQLite transaction conflicts, never a provider effect. Raw-query
serialization/deadlock SQLSTATE 40001/40P01 wrapped by Prisma P2010 also receive the
same bounded pre-effect retry; other raw errors do not. P2002 is not retried by the
transaction helper: processInboundMessage retains its existing tenant-scoped
providerMessageId recovery, returning the persisted conversation before post-effects.
The losing duplicate transaction rolls back its allocation; replay consumes no number.

## References and nullable Channel

Event fields are id, companyId, contactId, channelId?, conversationId, messageId,
sequence, createdAt and the nullable provenanceKind/provenanceVersion classifiers.
No message body, phone, CPF, name, email, media URL/bytes,
provider payload, header, token or credential is duplicated.

UNIQUE(messageId) enforces one event per Message. UNIQUE(conversationId,sequence)
prevents sequence collisions. The redundant UNIQUE(messageId,conversationId) is required
by Prisma's composite one-to-one relation. The additional Conversation(id,contactId)
unique is safe for historical data because id is already unique, and preserves the
required FK even when channelId is null. Scope/createdAt has a lookup index.

Six FKs bind Company, Company+Contact, optional Company+Channel, Conversation+Contact,
optional Conversation+Contact+Channel and Message+Conversation. All use DELETE RESTRICT
and UPDATE NO ACTION. The two mandatory Conversation/Message FKs do not disappear when
Channel is null. The writer derives channelId from the persisted Conversation; callers
cannot supply event fields or choose a fallback Channel. Inconsistent concrete channel
Company fails closed.
When a Meta snapshot is supplied, its Contact/Channel binding must also match the
Conversation reread inside the same transaction. A stale/mismatched snapshot cannot
override the Event scope and is rejected before allocation or Message insertion.

Since MATCH SIMPLE skips nullable FKs, a PostgreSQL trigger additionally checks exact
nullable Channel equality, Company/Contact/Conversation/Message scope, inbound direction
and positive allocated sequence. A Message linked to an Event cannot be changed to
outbound or moved to another Conversation. Equivalent SQLite guards are supplied in
prisma/sqlite/conversation-inbound-event-guards.sql: explicit local/test bootstrap AFTER
db push, not runtime DDL. SQLite db push alone supplies fields/FKs/uniques but cannot
install custom guards; application validation/atomicity still applies. Material SQLite
tests install these guards explicitly. PostgreSQL migration installs them normally.
The SQLite bootstrap also supplies the existing PostgreSQL baseline's partial unique
providerMessageId index, which Prisma db push does not express. It fails closed if an
old local SQLite has duplicates; do not delete/rewrite data to make it pass. SQLite
deployment requires this explicit approved bootstrap for equivalent dedupe guarantees.

channelId=null is a VALID historical fact when no concrete Channel FK existed at
capture. It is NOT consumable automatically by a future WhatsApp/Prospecta bridge.
The future consumer must require a concrete eligible Channel, correct integration,
current ConversationAuthority, AI/takeover policy and the actual provider contract.
A historical null event is not rewritten when a channel is associated later.

## Append-only, rollout and rollback

APPLICATION APPEND-ONLY: the sole production Event writer is create during atomic
new inbound persistence. No Event update/delete/upsert/createMany/cleanup exists in
production. This is NOT database immutability or protection against owner/superuser.
References prevent destructive parent deletion; they do not prevent a trusted DB owner
from deleting Event rows. The inventory test and DB privileges remain important.

Migration 20261017180000_add_conversation_inbound_event is additive DDL only, with
no DML or backfill. Existing inbound Messages intentionally have no retroactive events.
Existing Conversations begin the new counter at 0. Deploy schema before application
code; mixed old writers during rollout cannot supply the new invariant. Guarantee
begins when all production writers run the adopted code, not merely when a migration
exists. No synthetic historical events are produced.

Rollback application first under an approved rollout plan, retaining additive schema
and historical events. Do not automatically drop tables/columns or delete events to
roll back. Physical removal needs a separate retention/export plan. Parent RESTRICT
may make existing destructive administrative operations fail once events exist; audit
retention is deliberate, and no production cleanup bypass is introduced here.

## Intentionally unchanged

HMAC, channel/contact resolution, Conversation lifecycle, provider ID dedupe, reply/media
metadata and return contracts remain intact. The manual route keeps its existing outer
DB work, now in the shared transaction wrapper. Notification, SSE, unread/preview and
legacy maybeSendAutomaticAiReply remain after persistence as before. This slice does
not make those effects replayable, does not disable AUTO/HYBRID and does not consume
the new Event. Legacy runtime authority/outbound gaps remain future gates.

No OpenCreditIntegration/Lead/Event or lead.assigned changes. No CommercialOperation,
RemoteIdentity or CommercialAccess connection. No Prospecta URL/auth/payload/session,
callback, polling, client POST, validate, simulation or proposal. No Meta sender,
campaign, template or media-send behavior changes. No endpoint/UI or dependency added.

## Validation

Unit tests cover atomic allocation, duplicate/distinct races, rollback, scope, overflow,
writer inventory and no transport. Material tests run the actual primitive on independent
Prisma clients against SQLite and PostgreSQL, including real FK/scope rejection after
observed inserts. PostgreSQL gate requires CI=true, GITHUB_ACTIONS=true,
INBOUND_EVENT_POSTGRES_TEST=1, loopback port 5432/55432, disposable qevora_ci database,
schema=public and exact fictitious CI credentials. The guard executes before client
construction. SQLite requires INBOUND_EVENT_SQLITE_TEST=1 and an explicitly named
qevora-inbound-event-*.db in the OS temporary directory; remove it after tests.
All existing CI gates are retained. No production test or real provider request is used.
