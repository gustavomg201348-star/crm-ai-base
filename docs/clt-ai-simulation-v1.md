# CLT AI simulation V1

Default OFF: only `OPENCREDIT_CLT_AI_ENABLED=true` enables this path on an existing
OpenCredit -> Meta bridge. Ordinary Meta/COPILOT and materialization workers are
unchanged. `OPENCREDIT_CLT_AI_BANK_ID` must explicitly name one enabled CLT bank;
there is no automatic all-bank consultation or model-supplied bank/amount.
These are future operational prerequisites, not authorization to change production.

## Trust boundaries

Verified current Meta inbound -> native authority generation -> closed OpenAI
intent -> deterministic confirmation/policy -> existing human CREDIT_SIMULATION
grant -> durable workflow -> existing CommercialOperation dispatcher -> bounded
polling -> encrypted, persisted provider facts -> canonical guarded reply -> native
OutboundOperation permit -> existing Meta sender.

The classifier sees only the redacted current message. Model JSON cannot specify
actions, targets, CPF, bank or amounts. A narrow deterministic phrase whitelist
must agree with intent confidence >= 0.9 before a paid consultation is eligible.
Unrecognized requests have no financial effects. CPF check digits reuse the
existing validator. The automatic path never writes a CPF extracted from text.

V1 deliberately retains human authorization. Missing gates return
NEED_HUMAN_AUTHORIZATION and queue the conversation for a human after an informative
reply. No new grant primitive, no interpretation of customer consent by the LLM,
no Platform Admin impersonation and no createClient fallback are introduced.
The narrow simulation capability is internal, random-token bound to a persisted
workflow and validated in the dispatch transaction. Normal admin routes keep their
existing Platform Admin requirement.

## Durability and concurrency

The additive OpenCreditAiSimulation table records company/contact/conversation,
verified inbound evidence, scope, authorization revision, authority generation,
decision version, one operation reference and a hashed execution token. Composite
FKs constrain tenant/contact/evidence/operation binding. Unique keys cover both
inbound replay and reuse of the same grant on the same conversation. Financial
offers are never placed in generic logs or raw diagnostic JSON.

The existing dispatcher still has its stronger one-operation-per-grant and
unresolved-operation constraints. Its paid POST occurs once after durable dispatch
commit; UNKNOWN never authorizes replay. The optional automation capability adds
current conversation/authority/consent checks, not a replacement grant.

Polling performs at most three GETs with 1/2/4 second waits. The persisted count
and 240-second workflow deadline cap the execution; the deadline signal reaches
the HTTP transport. Authentication precedes a last read/dispatch gate. There is
no extra scheduler, batch, worker activation, lease stealing or automatic restart
recovery. A stopped process never causes the same workflow to resume a paid POST.
Pending/uncertain/interrupted operations require controlled human reconciliation.

Human takeover, closure, revocation, changed inbound/generation, invalid binding
or disabling the feature stops further permits/polls. A result already in flight
may be stored technically, but a final gate under native outbound authority blocks
automatic sending. As with existing native permits, a dispatch committed before
takeover is already admitted and cannot recall a request in flight.

## Financial authority

Only the dispatcher's existing strict POST/GET parsers supply facts. Results are
whitelisted, cents-normalized and AES-GCM encrypted with version/workflow binding,
then read back from the workflow before presentation. History, instructions,
model text and customer claims are never fact sources. At most two alternatives
are ordered by term/installment/technical ID; no option is called best or selected
at the provider. CET/expiry are null because this parser does not supply them.
Rates retain the provider's documented percentage-per-month unit.

V1 uses deterministic financial wording through enforceFinancialReplyGuardrails;
it does not allow stochastic rewriting to swap amounts, rates or terms. Subsequent
eligible customer questions may reuse the same fresh, stored facts under current
consent/authority without another consultation. Bank waiting_authorization is a
separate domain: no URL is manufactured or forwarded; a human handles that flow.

Structured telemetry contains only fixed stage/outcome codes. No IDs, bodies,
CPF, names, phones, offers, credentials, SQL or exceptions are logged.

## Migration and rollback

Migration 20261109150000_opencredit_ai_simulation only adds the workflow table,
indexes and constraints; it enables nothing and performs no backfill. Test clean
install and upgrade in disposable PostgreSQL before any production deployment.
Rollback application behavior by disabling the new feature under separate
operational authorization. Retain workflow/commercial/outbound ledgers, especially
UNKNOWN, to prevent replay. Revert application code if needed; retain the additive
table rather than deleting financial audit evidence. No production action is
authorized by this document.

V2: safe customer-consent primitive with explicit attestation model, validated CPF
collection, bank authorization-link workflow, durable background reconciliation,
bank selection strategy, and optional constrained natural-language financial prose.
Offer selection, proposal, bank accounts, signatures and margin POST remain excluded.
