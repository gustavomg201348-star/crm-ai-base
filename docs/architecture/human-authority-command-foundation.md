# Passive human authority command foundation

This slice is preparatory. No production route, inbound writer, assignment helper,
NBA flow, campaign or sender imports the new server-only adapter. Runtime behavior
is unchanged. ConversationAuthority will eventually be canonical ownership and
Conversation.agentId its compatibility projection; that activation is still blocked.

## One transaction, one transition implementation

The existing public authority service delegates to transaction-scoped callbacks.
They do not open/commit transactions. The human facade owns one authorityStorage
transaction covering Conversation lock, lazy adoption, authority CAS/event,
projection, assignment history and the existing pending-operation cancellations.
Public initialize remains ADMIN/SUPERVISOR-only. The internal self-claim adoption
exception derives only HUMAN_QUEUE or HUMAN(actor) from a valid legacy row; it
cannot initialize another owner, CLOSED, AI or CHATBOT for an AGENT.

The actor must be a same-company ADMIN/SUPERVISOR/AGENT. CLAIM_SELF is available
to those roles, only from queue or the actor's existing human ownership. Other
ownership is OWNERSHIP_CONFLICT. ASSIGN, TRANSFER and RETURN_TO_QUEUE require
ADMIN/SUPERVISOR; targets must be same-company ADMIN/SUPERVISOR/AGENT. TRANSFER
requires HUMAN. Returning an already queued conversation and assigning the same
owner are audited no-ops without a generation increment or duplicate history.
AGENT NBA return is deliberately not enabled.

The caller supplies intent, not state/owner/channel. The closed input contract
rejects additional fields. Channel comes from Conversation and must belong to the
same company and be Meta/WhatsApp, consistent with the existing foundation.
Null channel, archived contact and inconsistent scope fail closed; no inference,
channel creation or repair occurs. Status ACTIVE is not a new adoption requirement;
actual dispatch has its own eligibility checks.

The parser captures every caller-controlled field once, including the nested
expectation discriminant and generation, into new frozen plain snapshots before
dependent validation or any await. Unstable getters cannot change the accepted
ABSENT/EXISTING intent or generation after its first read.

## Adoption and projection

ABSENT explicitly expects no Authority. EXISTING requires an exact bigint
expectedGeneration; missing generation never means "use latest". A retry keeps
the original expectation. Lazy adoption reads locked current facts only:

| Legacy fact | Derived state / owner |
| --- | --- |
| RESOLVED | CLOSED / null |
| OPEN, PENDING, SOLD or BOT with valid agent | HUMAN / agent |
| Those statuses without agent | HUMAN_QUEUE / null |

Unknown statuses are rejected. BOT is not CHATBOT; AUTO/HYBRID and aiPaused do not
choose ownership. An internal administrative adoption primitive can materialize
RESOLVED -> CLOSED and clear the compatibility projection atomically. The execute
facade does not close/reopen: commands against CLOSED/RESOLVED fail and any tentative
adoption rolls back. This primitive is tested directly, not connected to runtime.

Only `agentId === null` means no legacy owner. Every non-null reference must be
nonempty, unpadded, bounded, and resolve to a same-company ADMIN/SUPERVISOR/AGENT
before adoption writes. Invalid legacy owners raise `INVALID_LEGACY_OWNER`, even
for RESOLVED: corruption is never hidden by clearing the projection or choosing a
queue. In contrast, `AUTHORITY_PROJECTION_DRIFT` means an Authority already exists
and its owner differs from the projection. Real database tests persist empty,
whitespace, foreign and unsupported-role owners and prove zero mutation attempts;
the missing-user test injects the impossible read because existing FKs prevent
persisting that corruption. Neither case repairs data.

Adoption plus a queue claim commits generation 0 INITIALIZE and generation 1
TRANSITION together, not two separate commits. Existing authority/projection drift
raises AUTHORITY_PROJECTION_DRIFT, including on replay; it is never silently fixed.
History is mandatory DB persistence in the same transaction for actual assignment
changes, including clearing a resolved legacy projection in the internal primitive.
It remains distinct from canonical AuthorityEvent and best-effort shadow metrics.

## Replay, locks and retries

Logical keys are supplied by the intent, nonempty, unpadded and at most 256
characters. A deterministic bounded namespace separates human command receipts
from foundation/adoption events. Their fingerprint includes command kind, company,
conversation, actor, target and the exact ABSENT/EXISTING expectation. Same key and
different intent conflicts; same intent replays the immutable original event,
without changing a newer projection. Authorization and drift checks still apply.
Returned event generations remain internal bigint values, not a browser DTO.

PostgreSQL locks Conversation before Authority. SQLite has no equivalent row lock:
it relies on Serializable transactions, writer serialization and the existing
bounded retry policy. Tests exercise two clients on both databases. PostgreSQL
guards/deferred audit checks are stronger than SQLite's FK/unique and explicit
append-only/delete guards; no DB-protection equivalence is claimed.

The existing retry bounds, timeouts and PostgreSQL SET CONSTRAINTS ALL IMMEDIATE
pre-commit gate remain unchanged. Transaction callbacks contain no Meta/OpenAI,
fetch, notifications, SSE or webhook effects. A lost generation is a conflict, not
permission to refresh the expectation and replay a stale command.

## Outbound and activation blockers

Real ownership changes cancel PREPARED/RESERVED and clear their reservation/slot.
DISPATCHING, UNKNOWN, SENT, FAILED and CANCELED remain untouched. No Meta sender,
outbound enforcement, dispatch permit integration or external consumer is enabled.

Configuration != ownership. generation is not a policy revision. aiMode, aiPaused,
Company.aiMode, AUTO/HYBRID, auto-draft and maybeSendAutomaticAiReply are unchanged.
Late AI dispatch and pause/resume invalidation remain unresolved. Runtime activation
requires a dispatch gate/policy revision design and coverage of every ownership
writer, plus a mixed-version/drain/rollback plan.

No round-robin, AI, Prospecta or chatbot runtime is integrated. Automatic actor
identity remains a separate future slice: USER/SYSTEM must be represented truthfully
(for example actorKind plus consistent nullable actorUserId/systemActorKey checks),
never by impersonating the selected attendant or manufacturing a User. No schema,
migration, dependency or production configuration change is part of this slice.

## Validation and rollback

CI runs human command tests against both disposable authority databases, preserving
all existing gates. Tests cover validation, permissions, mapping, lazy adoption,
two-client races, replay/conflicts, drift, transaction failure injection, tenant/
channel scope and each outbound status. Standalone Node tests stub only Next's
server-only marker during import, restoring the loader immediately.

Since there are no runtime callers or data migration, reverting this preparatory
commit restores the previous wrappers without a production data rollback. This is
not a rollback plan for future runtime activation. No production DB operation is
authorized or performed by this foundation.

## Known unrelated baseline (explicitly accepted for local commit)

The broader unit regression is not 100% green. These same six failures were
reproduced from an archive of the exact base
`b7c74f23e628b96025f9b434d6f7b21683e04bd0` and on this branch (26/32 passing
in the four affected legacy test files). None imports or exercises the human
authority slice; their sources, assertions, budgets and implementations are unchanged:

- contact-import.service: `resolve contato legado sem normalizedPhone usando equivalencia canonica do CRM`;
- contact-import.service: `detecta conflito quando CPF aponta para A e telefone legado aponta para B`;
- contact-import.service: `nao escolhe silenciosamente candidato alternativo ambiguo`;
- contacts: `lookup alternativo ambiguo nao escolhe silenciosamente`;
- meta-template-media-association: `timeout bloqueia associacao sem marcar permanentemente como BROKEN`;
- phone-normalization.service: `nao gera candidato para numero nao brasileiro ou invalido`.

The user authorized a local commit with those baseline failures documented only
if all slice-specific/material gates pass and no new regression is introduced.
This is not a waiver for a failing authority, provenance, shadow or other required gate.
