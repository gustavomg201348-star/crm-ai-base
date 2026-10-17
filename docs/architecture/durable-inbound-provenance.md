# Durable authenticated inbound provenance

## Meaning and trust boundary

ConversationInboundEvent now has only two additional nullable fields:
provenanceKind String? and provenanceVersion Int?. NULL/NULL means UNPROVEN,
not invalid HMAC. The current positive assertion is
META_WEBHOOK_HMAC_SHA256_VERIFIED / 1: this item was parsed from the exact
raw body whose X-Hub-Signature-256 matched the resolved Channel's app secret.
This is an application attestation under trust in the shared HMAC key, not
non-repudiation, proof of an exclusively Meta-controlled secret, human identity,
Contact ownership, authorization or consent.

PROVENANCE != AUTHORIZATION != CONSENT != CONVERSATION AUTHORITY.

The dedicated server-only boundary parses the raw body itself and authenticates
every message before returning the batch.
The route decodes raw bytes as fatal UTF-8, preserving BOM instead of normalizing
bytes before HMAC. Selected persisted text also rejects NUL/unpaired surrogates
that PostgreSQL cannot preserve exactly. These failures precede functional writes.
Its issuer is private: a WeakMap binds
an opaque, non-serializable capability to a private copy of the authenticated item.
Object literals, spreads, structured clones and TypeScript casts are not authority.
The generic caller cannot select kind/version. Runtime validation precedes Contact,
Conversation, assignment and other functional writes; persistence validates the
capability again against actual Message/snapshot data before sequence allocation.
The generic primitive accepts scalar Message fields only, rejecting nested writes
as another bypass route and snapshotting inputs before transaction awaits.
No HMAC, raw body, secret, token, credential ciphertext, capability, duplicated
sender or duplicated content is persisted by this slice. Private capture is transient
request memory, released with the capability through WeakMap reachability.

Channel lookup accepts exactly one eligible distinct Channel, never findFirst.
Separate unique phoneNumberId/externalId indexes cannot eliminate cross-column
ambiguity; multiple matches fail closed for both inbound and delivery status.
Status receipts still do not create inbound events. A missing provider message ID
or a malformed item skipped by the legacy parser invalidates the authenticated batch.
Snapshot validation also runs before writes, reserving the existing validator's
maximum 2048-character Contact/Conversation IDs for conservative size preflight;
oversized/invalid metadata never waits until persistence to fail.
lastWebhookReceivedAt is touched only after complete message-batch authentication.
Repeated valid deliveries may touch it again; it is not evidence of item provenance.

## Atomicity, replay and history

Message, original reply snapshot, sequence and Event/provenance share one transaction.
The Event INSERT carries both positive fields or neither; failure never downgrades to
UNPROVEN. Existing same-provider-ID recovery validates Message + Event + full scope,
original snapshot/content and conflict state on BOTH initial lookup and P2002 recovery.
Identical verified replay converges without allocation or evidence rewrite. Different
raw JSON encodings are compared through the existing persisted representation
(including body trimming and sender identity normalization), not a stored raw-body hash.
Different
Company/Channel or unproven/missing Event fails closed; no historical promotion.
Divergent same-scope authenticated content preserves the original and uses the
existing conflict mechanism before refusing convergence. Conflicts remain quarantined.
Permanent provenance/replay rejection is 403/409; transient persistence errors remain
retryable through the existing error path. No original evidence is overwritten.

Internal inbound, admin simulate and development sandbox still create NULL/NULL events.
Their request bodies do not select provenance. Events/messages predating adoption
remain unproven even when provider IDs, Meta Channels or reply snapshots exist.
The existing referenced-Conversation logic may reuse a Contact despite phone mismatch:
authenticated transport does NOT claim that this Contact is the real sender.
Unread/Notification/SSE/legacy automatic AI post-effects remain non-recoverable by
this foundation; no worker or new side effect was added.

## Persistence and Message integrity

No new table, enum, FK or speculative worker index. Existing six Event FKs and
scope trigger remain. A null-safe CHECK accepts only NULL/NULL or the explicit
kind/version pair with concrete Channel. A verified Event requires inbound Message,
nonblank provider ID and snapshot. Proof is immutable after INSERT, including
NULL-to-verified promotion. A verified Event's entire binding/sequence/time is frozen.

For verified Message only, guards freeze:

| Fields | Reason |
| --- | --- |
| id, conversationId, direction, providerMessageId | identity and structural binding |
| body, type | authenticated content and its interpretation |
| mediaId, mediaUrl, fileName, mimeType | attachment identity/presentation; no current production media URL updater |
| replyToProviderMessageId | provider-supplied reply context |
| replyToMessageId | resolved local context; cannot be rebound later, including via parent SET NULL |
| metaReplySnapshot | original scoped metadata, sender hash and content digest |
| senderType, createdAt | captured attribution and local identity/time; not human proof |
| templateName, templateLanguage, templateVariables | cannot introduce different content interpretation |
| replyPreviewType, replyPreviewBody, replyPreviewFileName | captured local reference preview |

status and readAt remain mutable. metaReplyConflictSnapshot retains its existing
one-time/non-rewrite semantics. Production Message updates were inventoried:
read route changes readAt; delivery changes status/readAt and may append failure text
to body; replay writes the conflict snapshot. Delivery failure annotation now excludes
verified inbound Messages while still updating their operational status/readAt.
Outbound/unproven failure annotation remains unchanged. No message-edit API was added.

These guards protect normal writes, not an owner/superuser able to disable constraints
or remove evidence. Event remains APPLICATION APPEND-ONLY, not owner-proof storage.
The database does not execute HMAC or authenticate the process issuing an INSERT.

## Rollout, rollback and SQLite

Migration 20261018100000_add_authenticated_inbound_provenance is additive DDL only:
two nullable columns, CHECK and narrow guards, zero DML/backfill/destructive removal.
Existing values stay NULL/NULL. Apply schema before new code. During mixed versions,
old writers can still produce unproven events; verified capture is guaranteed only
after all Meta writers adopt the new boundary. Never backfill those rollout gaps.
Application rollback retains schema and evidence. Old code must not be allowed to
rewrite protected content; incompatible old writes fail rather than erase proof.
No automatic schema removal/history deletion is a rollback strategy.

ALTER TABLE acquires locks; CHECK validation scans existing Event rows, and trigger
installation also needs locks. The previous inbound foundation's Conversation CHECK
validation/index creation also has scan/index-build/locking cost. Neither migration
is a claim of zero downtime. Review sizes, lock budget and rollout window separately.

Prisma schema != SQLite db push != SQLite with bootstrap != PostgreSQL migration.
SQLite db push supplies columns/FKs/uniques, not the custom CHECK/triggers or baseline
partial indexes. Install prisma/sqlite/conversation-inbound-event-guards.sql explicitly
after approved local setup; do not run DDL in a request. The material suite installs
these guards and existing reply-integrity guards. No equivalence is claimed without
bootstrap. PostgreSQL installs CHECK/triggers through the normal migration chain.

## Future consumers remain blocked

Candidate selection must require the recognized kind/version, concrete eligible Channel,
matching Company/Channel/Conversation/Message, provider ID and original integrity,
no conflict/quarantine, correct integration binding, current ConversationAuthority,
AI/chatbot policy, pause/takeover gates, ordering/idempotency and applicable consent
and authorization. Future providers require explicit new contracts/kinds, not inference.
No Prospecta transport, OpenCredit operation, chatbot activation, authority/outbound
runtime integration, consent grant, UI, credit operation or new outbound is included.

Tests distinguish unit/static boundary checks, actual HTTP handlers with synthetic
auth and blocked external fetch, and PostgreSQL/SQLite material persistence. Temporary
databases only; neither unit mocks nor regex guards substitute for material constraints.
