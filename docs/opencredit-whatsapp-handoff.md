# OpenCredit → WhatsApp Meta → IA

## Activation boundary

This bridge is disabled by default. The additive migration creates no config,
handoff, conversation or message, and never backfills historical jobs. Missing
config is equivalent to `autoStartEnabled=false`. No production setting is
changed by this PR.

A company ADMIN can configure each integration in the existing OpenCredit
settings card. The selected channel must belong to that company and be an
ACTIVE/CONNECTED Meta WhatsApp channel with a numeric phoneNumberId, WABA and
accessible access token. There is no alternate-channel fallback. Configuration
uses an optimistic revision and revalidates the actor and channel at commit.

Template choices use the existing local template library, scoped by company and
WABA. V2 supports APPROVED/READY active static text, BODY `{{1}}`, HEADER IMAGE,
and image plus BODY `{{1}}`. Other header media, named/nonsequential/multiple
variables and unsupported/dynamic components are ineligible. Synchronization,
approval and default image association remain the existing administrative flows.
Saving config does not send anything or process history.

`initialTemplateVariableMapping` is nullable, with a closed contract: CONTACT_NAME
explicitly binds BODY `{{1}}` to the canonical Contact name; NONE explicitly opts
an image-only template into V2 without BODY variables. NULL preserves static V1.
This prevents previously ineligible image configurations from silently becoming
sendable on deployment, even if an old record already has autoStartEnabled=true.
The additive migration does no backfill and never changes autoStart, revision or
existing configuration timestamps. No literal/CPF/phone/financial field mappings
are accepted. Margin, rates, bank, proposal, installments, approval and other
financial sources need a separate future authority contract.

CONTACT_NAME uses NFKC, trim and collapsed spaces. It requires a real bounded
letter-based name, rejects digits, control/bidi characters and generic identity
placeholders. An absent/invalid name returns IDENTITY_UNAVAILABLE, without CPF,
phone or invented “cliente” fallback. Static templates do not require a name.

Template labels distinguish text/image/name requirements. Unready choices are
disabled with a closed technical reason. “Prontidão do atendimento automático”
comes from persisted config, validated credentials/channel, local template,
actual readable media, mapping, company AUTO/HYBRID policy and integration gates;
it does not claim unsaved form values are ready. It is configuration readiness,
not proof that every Contact has a valid name or that the worker is enabled.

HEADER IMAGE requires a same-company READY TEMPLATE_HEADER_IMAGE MediaAsset,
JPEG/PNG within existing limits, the configured defaultHeaderMediaAssetId and
recoverable existing storage. Preflight reads bytes through readTemplateMedia
and reuses existing image validation. No association validator that might mutate
MediaAsset status is called. Choices are bounded to 200, with at most four
concurrent media reads; no parallel storage or template library is introduced.

## Runtime

Only a job newly completed by the normal materialization worker may trigger the
automatic bridge. The existing global worker flag, rollout budget, batch and
interval still apply. No additional scanner, scheduler or provider enrichment is
introduced. A bootstrap failure never retries or rewrites domain materialization.

The completed job, integration/company/providerScope, Contact, internal channel
and source Conversation are revalidated. The source OPEN_CREDIT conversation
remains unchanged and cannot use Meta transport. The canonical Contact phone
must pass the existing normalizer and agree with normalizedPhone when present.
CPF is never interpreted as a phone.

`findOrCreateConversationForChannel` creates/reuses a separate operational Meta
conversation for the same Contact and configured channel. PostgreSQL takes only
a transaction-scoped advisory lock for that company/contact/channel combination;
there is no table lock. Existing active-conversation uniqueness, Serializable
transactions and retry of pure database work protect concurrent instances.

The Meta conversation starts as BOT with no agent when automation policy allows
AUTO/HYBRID. An existing human assignment, paused automation or SOLD conversation
blocks bootstrap. No assignment is stolen. The template actor is retained for
audit but is not assigned to the conversation by the automated send.

The Atendimento cards distinguish `OpenCredit · origem` from WhatsApp. The Meta
conversation uses the existing activity ordering and becomes the operational
entry after the template; the internal provenance conversation remains visible.

## Durable first-send protection

OpenCreditWhatsappHandoff records a PREPARED intent and immutable template/config
binding before network I/O. Uniqueness covers job, source conversation, Meta
conversation and company/contact: even different leads/integrations cannot send
multiple initial templates to that same local Contact through this bridge.

The V2 fingerprint binds components, WABA/language, mapping, resolved variables,
selected MediaAsset metadata/version and a digest of actual image bytes. No
plaintext name or image value is logged. Identical static V1 fingerprints remain
compatible. Name, mapping, asset replacement or content/config changes cannot
silently reuse an incompatible PREPARED intent.

The existing ConversationAuthority/OutboundOperation services initialize only
an unowned HUMAN_QUEUE authority if absent. Existing ownership is respected.
The stable operation key, generation checks, native reservation and non-replayable
`authorizeDispatch` permit are reused. The ordinary message-send actor rate
limit remains active. Config, gates, channel, Contact, template fingerprint and
automation policy are checked again before dispatch.

The existing template sender commits DISPATCHING before its first provider call,
including media upload. Bytes and identity are validated before the permit;
resolveAndUploadLocalTemplateHeaderImageMedia uploads those exact validated
bytes using the existing uploadMetaMedia. After upload, a second guard revalidates
config, identity, media, channel, binding and authority before messages I/O.
No second permit is issued. Media upload is not a sent template. Its timeout or
ambiguous ACK conservatively consumes this intent as UNKNOWN, with no message
and no automatic upload/resend; failed upload can never become SENT.
It sends only the configured template, never free text. Its existing history
writer is reused and SENT requires a provider message ID and a matching sent
outbound template Message. No provider call runs inside a retrying transaction.

Any uncertain result after attempting the permit becomes UNKNOWN, including
timeout, missing provider ACK, process interruption and history-write failure.
DISPATCHING/UNKNOWN/SENT are never automatically resent. A restart cannot obtain
a second permit. A crash before permit can leave PREPARED/RESERVED work, which
may safely retry only under the existing reservation/generation rules.

UNKNOWN or a stuck DISPATCHING intent requires explicit human reconciliation
using provider evidence and the native authority service, after confirming the
old executor cannot run. This PR exposes no reset/resend action and deliberately
does not clear durable intent to retry an ambiguous send. Revoking autoStart
blocks future permits but cannot recall a provider request already dispatched.

## Authenticated administration

`GET/PATCH /api/integrations/opencredit/[id]/whatsapp` use the company ADMIN
session. GET lists safe references only. PATCH requires same origin, strict
bounded JSON, exact config keys, revision and the existing actor policy.

`POST /api/integrations/opencredit/[id]/whatsapp/bootstrap` is an explicit
ADMIN-only same-origin command for one already COMPLETED job. It accepts only
`jobId`; company derives from the session and integration from the path. It
cannot claim/process a job, choose a channel, select a Contact or override
config. It obeys the same autoStart gate and durable single-send intent.
No UI invokes this command automatically.

## Inbound and human handoff

There is no bootstrap IA message. A real signed Meta inbound follows the
existing webhook → processInboundMessage → durable inbound persistence →
maybeSendAutomaticAiReply path, resolving the same Contact/channel conversation.
The existing reply policy remains AUTO or unowned HYBRID, with paused/OFF/COPILOT
blocked. Bridge conversations additionally require SENT bootstrap and unowned
AI/HUMAN_QUEUE authority before generation and immediately before sending.

The real `assignConversationToUser` / `unassignConversation` services synchronize
an existing authority and Conversation.agentId in one Serializable transaction,
using the native authority row lock and transaction core. They validate tenant,
channel, Contact, actor and target, advance generation only on an actual change,
and cancel incompatible PREPARED/RESERVED operations. An inconsistent existing
projection fails closed. Conversations without authority retain their legacy
assignment behavior and do not acquire one through assignment.

Before generating a bridge AI reply, the current verified inbound event receives
a stable native AI OutboundOperation bound to the current generation. An unowned
HUMAN_QUEUE may explicitly transition to AI through the existing core and the
configured administrator; an existing human is never overridden. The generated
reply uses the existing IA pipeline. Immediately before Meta I/O, native reserve
and authorizeDispatch revalidate generation, authority, destination and channel;
a database-only callback checks current policy and inbound under that same lock.
A human handoff that wins before this final authorization cancels the operation:
even a previously generated response cannot obtain a dispatch permit.

Known pre-dispatch denials cancel only PREPARED/owned RESERVED operations and
release their slot. Issued DISPATCHING permits and uncertain results cannot be
reset by this cleanup; provider/history ambiguity remains UNKNOWN. Authorization
is the serialization boundary: a handoff after a permit has already committed
cannot recall a request already dispatched. No transaction spans provider I/O.

In HYBRID, real agent assignment blocks the next automatic reply; returning to
the queue allows a new inbound to resume under current policy. A canceled reply
to an old inbound is never resurrected by returning the conversation to queue.
After a genuine inbound and successful automatic response,
only this bridge's still-unowned active conversation is shown as BOT. No global
conversation status semantics are changed.

## Privacy, testing and rollback

The new runtime log is only `opencredit_whatsapp_bootstrap` plus a closed outcome
code. The template sender suppresses its recipient/provider-diagnostic logs for
this automation. No body, phone, CPF, secret, access token or arbitrary exception
is logged by the bridge. Existing message history and native encrypted/durable
records retain their established access controls; new config/handoff store
technical references only.

Tests use disposable loopback PostgreSQL and synthetic identities with all HTTP
replaced by a rejecting allowlist/fake Meta/OpenAI responses. The signed webhook,
template sender, materializer, lifecycle, authority, outbound operation and IA
services run for real against this isolated database. No production endpoint or
credential is used.

Rollback: disable autoStart in company settings to prevent future sends; stop the
worker under a separate operational authorization if needed. Keep handoff and
operation records, especially UNKNOWN, to preserve duplicate-send protection.
Revert application code if required; leave the additive empty/retained tables.
Do not delete intents, reset operations or backfill history as a rollback step.
This document does not authorize activation or any production operation.


## Manual single-lead canary (ADMIN)

Atendimento exposes **Iniciar WhatsApp** only on an OpenCredit source conversation
for a company ADMIN. Confirmation affects only that conversation and does not
activate AutoStart. The normal source composer/template transport remains blocked.

POST /api/conversations/[conversationId]/opencredit/bootstrap accepts only an empty
JSON object. Session company and current DB ADMIN are required, with same-origin
and the administrative 10/min limiter. The backend resolves exactly one COMPLETED
materialization with matching source/contact/channel; missing, foreign, non-source
or ambiguous bindings fail closed. No browser job/contact/integration/channel,
phone, template or provider binding is accepted.

The closed ADMIN_CANARY trigger ignores only the AutoStart switch; config revision,
mapping/media fingerprint, destination, company AI mode, integration gates, current
ADMIN and authority/generation remain checked before provider dispatch. The default
AUTO_MATERIALIZATION path still requires AutoStart ON at all config checks. Neither
trigger edits configuration. Both share the same contact-level handoff and native
one-use permit: concurrent clicks/restarts do not resend SENT, DISPATCHING or UNKNOWN.
Transport ambiguity locks the local button and requires investigation, never retry.

Rollback: revert this application patch to remove the manual action/route. Keep
handoff/outbound ledgers intact; disabling AutoStart alone does not disable the new
explicit manual trigger. This patch authorizes no actual canary or production send.
