# Chatbot execution engine V1: pure, activation blocked

Base: b7143397c9ec8c07e15c18a08a9f83f5a27b5e13 (Stage 2 merged).

## Audit and decision

The foundation already provides immutable published versions, a unique active
conversation slot, serializable session transactions, revision/CAS, event
fingerprints and leases, and a scoped durable ChatbotOutbox. Reuse those models
in a future approved integration; do not create another session or outbox model.

However ChatbotSession.authority is not shared with current responders.
ai-attendant.service.ts shouldAutoReply uses aiPaused, aiMode and agentId;
maybeSendAutomaticAiReply does not acquire chatbot authority before calling Meta.
Human sending and lead-assignment also do not participate in a shared arbiter.
An unassigned conversation is NOT proof that chatbot authority is available.
Creating a ChatbotSession alone would not exclude existing AI/human responders.

Campaign has no configurable campaign-to-flow/version binding. A Stage 2
historical candidate version is not execution authorization. Its processor
remains unchanged and manual; no hook invokes this planner from ingestion.

Alternatives: (1) pure planner and contracts, blocked activation (implemented);
(2) later introduce shared, durable authority/fencing checked by EVERY sender,
plus explicit campaign binding. Alternative 2 changes live behavior and needs
separate architecture approval. No partial authority workaround is implemented.

## Contract

planChatbotExecution takes explicit company/channel/conversation/contact/flow/
version/session scope, a published-version projection, an explicitly nullable simulation state,
expectedRevision, an event and an optional 1..100 total step limit.
Version definitions are revalidated by the existing JSON contract, including
acyclic graph validation. The canonical encoder is extracted from the foundation
service into chatbot-canonical.ts and shared by both, preserving valid encodings
and adding explicit rejection of cyclic/sparse structures. It sorts object
keys recursively and preserves arrays. A definition fingerprint rejects semantic
changes between steps without depending on property order, including definitions
parsed from persisted JSON. Raw stored JSON must still be parsed by the adapter.
Production immutability remains a database guarantee,
NOT something proved by caller-supplied status = PUBLISHED.

All outputs have executable=false. Commands are inert payload plans matching
the existing flow types, with deterministic scoped idempotency keys. They are
NOT inserted as PENDING ChatbotOutbox records and have no consumer or transport.
No production caller, endpoint, scheduler or automatic session starter is added.
START is only a simulation event; it is not a Meta inbound or permission to start.

TEXT emits a text plan and advances. BUTTONS/LIST emit a prompt and wait. INPUT
waits for bounded nonempty text and stores it in the simulation's variables.
CONDITION uses exact equality, then its explicit otherwise. END closes with
COMPLETED/NONE. HANDOFF closes with HUMAN_HANDOFF/HUMAN and returns DEFAULT queue,
assignTo=null, executionAllowed=false; it does not claim an actual human assignment.
No real queue mutation or specific employee selection occurs.

Option IDs take priority. An unknown supplied ID never falls back to a title.
Title-only options require exactly one exact configured title; duplicates are
AMBIGUOUS_REPLY. Text is not guessed into an option. Invalid input leaves the
waiting step intact, emits no repeated prompt, and records a technical decision.

## State, ordering and idempotency

Only state=null permits a new simulation. Undefined, false, zero, strings, arrays,
missing fields, invalid lifecycle combinations and malformed prompt state fail
closed; none implicitly starts a new simulation.

Inputs are not mutated; a new state proposal increments revision once per new
event. Duplicate IDs/fingerprints produce no commands; conflicting fingerprints
throw REPLAY_CONFLICT. Older timestamps fail closed. Equal timestamps are allowed
but never prove prompt identity. Event fingerprints include both correlation
evidence and the supplied delivery binding, detecting conflicting context replays.

## Response-to-prompt contract

EngineScope.sessionId is an explicit logical session identity supplied by the
caller, not a newly created database session. Each BUTTONS/LIST/INPUT command has
a LogicalPrompt: id, stepId, issuedRevision and kind. Its id is a hash of the full
scope (including session/version), definition fingerprint, step and issuing
revision. It is stable on retry and remains unchanged after invalid answers.
The state retains this expectedPrompt. TEXT is informational, has prompt=null
and never waits for a response; questions use INPUT/BUTTONS/LIST.

Three distinct identities are never conflated:
- Logical prompt id: computed locally, never advertised as a Meta context.id.
- Actual outbound providerMessageId: supplied in PromptDelivery only AFTER an
  adapter proves the scoped session/prompt-to-sent-message mapping.
- Received contextProviderMessageId and inboundProviderMessageId: original
  provider evidence supplied in EngineEvent.reply, together with the prompt id
  resolved by the adapter, never inferred from timestamp, title or option id.

A continuation needs both EngineEvent.reply and input.promptDelivery. The engine
checks that both prompt ids match expectedPrompt.id, all scope/session fields
agree, and received contextProviderMessageId equals the mapped actual outbound
providerMessageId. Missing evidence throws PROMPT_CORRELATION_REQUIRED; old
prompts or mismatches throw PROMPT_CORRELATION_MISMATCH, before consuming the
event or changing state. Repeated yes IDs in consecutive questions cannot bypass
this check, including same-timestamp responses. Identical replay is recognized
before comparison with the next prompt and produces no additional commands.

EnginePlan.confirmation=CONSISTENT_PROJECTION reports only these internal checks,
NOT authenticated Meta provenance. There is no input confirmed=true shortcut.
An untrusted caller could fabricate projections: this module is NOT an API or
authorization boundary. The future adapter must load the actual immutable
mapping and authentic inbound snapshot under scope, reject quarantine/conflicts,
verify their provenance, and atomically persist event/state/outbox with authority.
This module cannot prove that any provider message was sent. No mapping is stored
or fabricated by it. Context-free free text/title-only responses cannot advance
merely because a prompt is waiting. If Meta lacks sufficient context, the future
adapter must keep the response pending/rejected until another approved binding
strategy exists; it must never fill missing IDs with the logical prompt hash.

At most 100 receipts and 100 visited steps are accepted. Receipt exhaustion
blocks rather than forgetting IDs. A fresh state is NOT a durable dedupe ledger.
The state is a trusted simulation projection, never an untrusted client API body.
Variables may contain customer data: do not log or expose state projections.
Audit decisions contain only step IDs and technical codes, not customer text.

Pure expectedRevision validation is not database CAS. Concurrent calls may
produce the same proposed result, but cannot commit anything. No cross-process
concurrency guarantee is claimed for those proposals. Durable concurrency remains
in the existing foundation and must wrap state/event/outbox changes in one
transaction if activation is separately authorized. No live state writer exists
in this delivery, hence duplicate session starts cannot occur through this code.

## Activation and authority

assessChatbotActivation always returns allowed=false, even with complete projected
evidence. It reports missing confirmed/same-scope correlation, explicit binding,
valid inbound, human/AI conflicts and unknown/closed Meta window. Its booleans are
diagnostic projections, not security credentials or a replacement for DB checks.
SHARED_AUTHORITY_NOT_INTEGRATED and ACTIVATION_NOT_IMPLEMENTED are unconditional.

Before enabling writes: resolve real correlation/campaign/recipient and published
version under tenant/channel scope, verify immutable snapshot/no replay quarantine,
require explicit persisted flow binding, claim shared durable authority, and fence
EVERY sending path. Persist event completion + state revision + outbox together.
Recheck authority/window before sending, including human intervention while an
external request is in flight. A validated 24-hour window is necessary, never
enough by itself. HANDOFF must revoke chatbot authority and cancel pending commands
atomically before safely integrating with the existing unassigned human queue.

## Validation and limits

Unit tests cover all seven nodes, invalid/ambiguous input, scope, invalid versions,
replays, ordering, step/event bounds, terminal states, deterministic concurrent
proposals and blocked activation for human/AI/window/binding/correlation conflicts.
Additional adversarial cases cover repeated yes across consecutive BUTTONS,
missing/mismatched delivery evidence for BUTTONS/LIST/INPUT, session isolation,
canonical nested/parsed JSON, changed semantics/array ordering and invalid state.
CI explicitly includes chatbot-execution-engine.test.ts in its existing contract
test step, without removing any prior test or changing jobs. A disposable copy
is used to prove a deliberate failure in this file propagates a nonzero exit
from the same test selection; restoring the copy must restore passing status.
PostgreSQL regressions of the existing foundation/correlation validate their
constraints and transactions, not a nonexistent execution writer. They cannot
certify a future authority implementation. No schema or migration is changed.

No public activation surface, UI, campaigns, webhooks, Meta/OpenAI calls or real
handoff. Production impact is zero until separately wired. Rollback consists of
removing these unused planner/tests/docs files; no data rollback is needed.

## Final inbound identity and terminal-state contract

Receipts now contain `id`, `inboundProviderMessageId` and `fingerprint`.
START uses a null provider ID; a consumed reply records its original inbound
provider ID. The enclosing state scope includes company, channel and session:
there is no global provider-ID registry. Scope/version validation precedes
receipt lookup.

A collision on either the registered local ID or original inbound ID must
match both the provider ID and canonical content/context fingerprint.
Different local IDs for the same inbound packet are duplicates without any
receipt, revision, command or state change. Conflicting identity reuse throws
`REPLAY_CONFLICT`. Timestamps alone never establish identity or prompt
correlation. A duplicate preserves the original receipt, not the alias ID.
Consequently, adapters must keep local event identities stable; discarded alias
IDs are not reserved by an additional unbounded alias ledger.

The fingerprint preserves original event time, content, reply evidence and
delivery projection. Adapters must replay those original projections rather
than reconstructing them from the currently awaited prompt. Duplicate lookup
precedes current-prompt validation so a recorded reply can be replayed after
advancement or closure; new replies still require the existing prompt contract.
None of this authenticates transport evidence or provides transactional locking.

Receipts are a pure simulation contract, not a new persisted foundation model.
Older projections lacking the provider-ID field are rejected, not silently
upgraded. A future persistence adapter must reconstruct verified inbound IDs
from durable source records, maintain scoped uniqueness and atomic revision
checks, and quarantine incomplete projections. No foundation schema or stored
flow fingerprint is changed by this receipt extension.

All state semantics are checked before a duplicate can return: COMPLETED
requires CLOSED/NONE at an END node; HUMAN_HANDOFF requires CLOSED/HUMAN at a
HANDOFF node. Both require no waiting prompt. Supplied ACTIVE states must be
waiting at a question with a valid expected prompt; only null starts execution.
Supplied states require a positive revision/execution count, receipts and event
time. Valid terminal duplicates remain inert; new terminal events are rejected.
External closures, suspension and expiration are not represented by this pure
contract and are rejected. A future adapter must explicitly model them rather
than treating every CLOSED session as an END or fabricating a terminal step.

## Revision invariant and numeric safety

This pure contract has no receipt pruning: revision equals receipts.length.
The null initial state is constructed with revision 0 and no receipts. START
and every newly consumed reply append exactly one receipt and increment once,
including INVALID_REPLY and AMBIGUOUS_REPLY. Internal TEXT/CONDITION/END/HANDOFF
transitions do not append receipts or increment revision. A duplicate returns
the unchanged pair; a conflicting replay or other rejected event returns no
plan, and input state is never mutated. Thus induction over successful calls
preserves equality, including closed states.

Runtime revision must be a nonnegative safe integer; a supplied state must
also satisfy equality before receipt lookup, regardless of expectedRevision.
Inconsistency throws INVALID_STATE_REVISION. Supplied states still require a
positive revision; only explicit null starts at zero. The 100-receipt bound
therefore limits valid revisions to 100, far below Number.MAX_SAFE_INTEGER.
New events at that bound throw EVENT_LIMIT; valid duplicates still return.
MAX_SAFE_INTEGER projections cannot satisfy this bound and are rejected before
consumption. Independently, the next revision is checked for numeric safety
before appending any receipt or assigning it; unsafe increments throw
REVISION_OVERFLOW. This defensive guard is unreachable for currently valid
bounded states, not an alternative to validating their invariant.

This invariant belongs to the pure planner, not a claim that a persisted
foundation session revision counts exactly the same operations. A future
adapter must explicitly translate both contracts rather than copying counters.
