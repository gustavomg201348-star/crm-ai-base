# OpenCredit API authentication (not webhook authentication)

## Read-only pre-simulation client validation (current)

Official source rechecked on 2026-10-27: [partner OpenAPI](https://core.api.opencredit.tech/api/partner-openapi.json),
version 2.8.0, operation `IntegrationApiController_validateClient`:
`GET /api/tenants/{tenantId}/integration/clients/validate` with server-resolved
`cpf`, fixed `stage=simulate` and `product=clt`. The current formal query marks
only CPF required; stage, simulationId, bankId and product are optional. This
supersedes the earlier 2026-10-16 required-parameter discrepancy recorded below.
The 200 response remains an example, NOT a complete formal schema.

`POST /api/admin/integrations/opencredit/client-validation/context` accepts only
`{companyId, contactId}`. Session, Platform Admin, same-origin, strict bounded JSON
(2 KiB, one-second deadline), no query/Authorization header and actor/target rate
limits precede the service. Actor permissions are rechecked against persisted User.
Tenant/scope come exclusively from trusted server configuration. CPF comes from
the Contact using the existing canonicalizer, with uniqueness including archived
Contacts and matching global RemoteIdentity owner. CommercialAccess and identity
must be enabled. The current active CLIENT_PROFILE_UPSERT authorization must bind
the same identity and its current GRANTED revision/evidence (verified provenance v1).
This is a conservative technical-read gate, NOT new consent or permission for a
paid credit inquiry, simulation or proposal. No Message body is read/interpreted.

The snapshot is resolved in a short read transaction. No transaction is held over
HTTP. Access/identity/authorization and CPF are rechecked before returning a successful
read, discarding stale results after revocation, regrant or target changes.
The additive API-client `getOnce` method reuses existing in-memory auth/refresh
BEFORE one GET, retaining the ten-second transport deadline and redirect rejection.
It never retries GET or refreshes after its 401. Existing `request`, createClient,
webhook, banks, capabilities and write/replay behavior are unchanged. The existing
strict response reader supplies a 64 KiB body cap, fatal UTF-8, duplicate-key rejection
and a twenty-second body deadline. These are local limits, not provider guarantees.

The local parser accepts optional real booleans found/valid and optional pending
arrays (maximum 50 entries). Present invalid types/null, malformed structures or
contradictory positive flags fail closed. Missing flags remain absent, not false.
Unknown properties are discarded. Only a closed field vocabulary plus optional
client/bank scope reaches the UI; unknown field names become OTHER. All labels are
local constants. Provider label, regex, resolveWith, paths, values and raw text are
never copied, rendered, followed or executed. Even VALID is only technical validation,
never credit eligibility or authorization to simulate; missing facts mean INCOMPLETE.

Sanitized diagnostics exist only in the administrative response: known GET HTTP
status, safe request/correlation IDs, readable/parsed flags, nullable found/valid,
nullable pendingPresent (unknown until data can be inspected) and closed category. No raw body, CPF, contact details, credentials,
tokens or secret headers are logged/persisted/returned. Auth failures have no invented
GET HTTP status. No durable diagnostic table or CommercialOperation writer is added.

The new panel performs no request on mount. Its sole button explicitly requests
the read and shows fixed pending labels; it never adds a simulation action. Scope
changes/unmount abort and invalidate stale responses; duplicate clicks are blocked.
Normal technical rate-limit counters are writes, not commercial mutations. There
are no schema/migration/env/dependency changes. Tests use fake DB/HTTP/browser ports;
no production, provider call, paid query or commercial mutation is needed to validate
this slice. PostgreSQL material execution is not required for this read-only patch;
existing persistence gates remain unchanged. Rollback is a code revert only.

## Human CommercialAccess admin boundary (current)

Only authenticated Platform Admin commands may mutate commercial access through
`POST /api/admin/integrations/opencredit/commercial-access/grant` and `/revoke`.
Both accept exactly `{companyId}`. No UI or context endpoint is introduced by this
slice; a future UI must require explicit human confirmation and must never mutate
on mount. These endpoints are explicit commands, not automatic onboarding.

Order: session -> Platform Admin -> same-origin -> no query/Authorization header ->
JSON Content-Type -> 512 actual bytes / one-second total body deadline / fatal UTF-8 /
strict JSON (including duplicate-key rejection) -> closed Company input -> shared
rate limits -> trusted configured providerScope -> existing transactional service.
Actor is exclusively session-derived. Scope is exclusively resolved from server
tenant/partner configuration; neither is accepted from the browser or returned.
Budgets shared across grant/revoke: 10/minute per actor and 5/minute per target
Company. Limiter failures fail closed; only safe integer Retry-After is forwarded.

The existing service remains the authority for fresh persisted Platform Admin,
Company existence, Serializable concurrency/retries, idempotent grant/revoke and
atomic Access + Event. No domain rule, transaction, direct Prisma mutation or new
retry is implemented in the HTTP handler. Grant absent creates enabled Access with
GRANTED; grant enabled and revoke disabled are no-ops; revoke absent creates nothing.
The response is only `{ok:true,changed,enabled}`, with Cache-Control: no-store.
Internal access/event IDs, raw errors, provider configuration and credentials never
escape. Closed module-stable domain error mapping uses 403/400/409/503; HTTP session,
origin, input and limiter failures use fixed 401/403/400/429/503 codes.

CommercialAccess is NOT consumer authorization, consent, legal basis, RemoteIdentity
ownership or permission to call a financial operation. No identity, authorization,
operation, createClient/provider HTTP, AI/chatbot/worker/webhook/campaign consumer,
schema/migration, dependency or Railway change is introduced. Static guards allow
only this exact handler to import the service and only these two routes to compose
the handler. Strict JSON and resolver guards add only this exact approved consumer.

Unit/guard and disposable PostgreSQL HTTP+service gates preserve all earlier gates.
Material fixtures are synthetic, live fetch is blocked, real Event FK failures prove
rollback, concurrent commands prove coherent no-ops/history, and unrelated domain
table counts remain unchanged. No production grant is executed by development tests.
Rollback (not executed): remove the two routes/handler and restore their narrow guard
allowlists/CI steps. Existing access state/audit history is retained; no DB rollback
or provider action is required. Deployment/merge requires independent review.

Local validation of this slice: 168/168 new HTTP/guard tests; 3,878/3,878 across
all 38 OpenCredit unit files (including the new tests); 68/68 chatbot/media regression
tests; disposable PostgreSQL 18 material 34/34 (11 new boundary + 23 existing service).
Both Prisma schemas, typecheck, lint, verify, Next.js 15.5.28 build (45 static pages)
and diff-check passed. The existing 20 migrations were applied only to the disposable
local database. The Windows checkout was normalized to LF for existing literal-source
assertions, without changing those assertions or committing unrelated line endings.
These local results are not a claim about remote CI or a production grant.

## Read-only createClient reconciliation review (current authoritative state)

```text
CREATE CLIENT HUMAN UI ACTIVATION: IMPLEMENTED
CREATE CLIENT RECONCILIATION REVIEW: IMPLEMENTED
ACTIVE PROVIDER RECONCILIATION: BLOCKED
FAILED TRANSITION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
LIVE CREATE CLIENT TEST: NOT EXERCISED
```

The review uses only persisted local facts. IN_FLIGHT proves a local reservation
commit, NOT receipt or processing by OpenCredit: a crash before transport and an
unconfirmed settlement after transport are both possible. UNKNOWN is an ambiguous
remote attempt, NOT proof of failure. Neither review authorizes replay or a manual
SUCCEEDED/FAILED transition. Future provider readback requires an officially
confirmed contract; this slice makes no provider call or legal/LGPD conclusion.

`POST /api/admin/integrations/opencredit/create-client/reconciliation/context`
accepts exactly companyId/contactId. The separate server-only reader revalidates
persisted User/Platform Admin, Company and tenant-scoped Contact in a Serializable
read transaction. It intentionally ignores later archive/disable/revoke eligibility.
The operation is read through the compound unique for Company, trusted
providerScope, RemoteIdentity and CLIENT_PROFILE_UPSERT. At most one such operation
can exist after the single-intent migration. Only IN_FLIGHT
revision 1 and UNKNOWN revision 2 receive review; other known states return null.

The complete ledger is read in persisted createdAt ASC, id ASC order (bounded
four-row read detects any extra event). Exact chains are PREPARED rev0 followed by
RESERVED_FOR_DISPATCH rev1, plus MARKED_UNKNOWN rev2 for UNKNOWN only. States,
revisions, valid Dates, monotonic timeline, unique closed ASCII event IDs and
reservation authorization binding are checked. All other Events must have null
binding. Corrupt/missing/extra/incompatible chains fail as CORRUPT_LEDGER, never
hidden as absence and never repaired. Legacy reservations with null binding cannot
be attested by this contract and fail closed; no history is invented or migrated.

The closed public response exposes only operationId/state/revision, closed reason,
canonical ISO preparedAt/dispatchCommittedAt/settledAt and authorizationBound fact
named dispatchAuthorizationBound=true. No Event/binding IDs, profile/PII, provider
payload or credentials. Domain writes are ZERO; only the shared HTTP limiter can
write RateLimitBucket. Independent actor 60/60s and target 30/60s categories prevent
resolver/domain access on denial/unavailability. Session/admin, same-origin,
query/Authorization rejection, closed JSON, 2048 real bytes, total 1000ms deadline,
fatal UTF-8 and strict JSON protections match the existing read boundary; no-store
applies to every response. Module-stable descriptor-safe errors remain closed.

The child review panel mounts only for IN_FLIGHT/UNKNOWN inside the existing
createClient panel. Local timestamps and clear unconfirmed-result copy are shown;
operationId is not displayed. Only Atualizar revisão is offered, calling this local
read endpoint. No UUID, storage, provider, transition or retry action. Target-key
remount, abort and epoch checks prevent stale cross-contact updates; 401/403 hides
details. Existing createClient send/state rules and server single-intent protection
remain unchanged. Parent IN_FLIGHT copy now explicitly avoids a receipt claim.

All CI gates are preserved, with new unit/guard and sequential disposable PostgreSQL
review gates. Material tests use real local reservations/local UNKNOWN observation
without any provider transport, and compare domain snapshots before/after reads.
The reconciliation reader itself requires no new storage. This PR also includes
the single-intent unique in both schemas and its fail-closed migration, documented
below. No env/dependency/Railway changes, new settlement writers or active
reconciliation. Reader rollback removes this reader/route/child panel and narrow
guards/gates; retain the associated uniqueness protection. Any schema/data rollback
would require a separate approved plan.

## createClient read context and human UI

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN/UI FLOW: IMPLEMENTED
CREATE CLIENT ONE-SHOT DISPATCH CORE: IMPLEMENTED
CREATE CLIENT HUMAN ADMIN COMMAND: IMPLEMENTED
CREATE CLIENT READ CONTEXT: IMPLEMENTED
CREATE CLIENT HUMAN UI ACTIVATION: IMPLEMENTED
AUTOMATIC CREATE CLIENT: FORBIDDEN
AUTOMATIC REPLAY: FORBIDDEN
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
LIVE CREATE CLIENT TEST: NOT EXERCISED
```

`POST /api/admin/integrations/opencredit/create-client/context` accepts exactly
`{ companyId, contactId }`. It is a Node.js/force-dynamic thin admin route. Order:
session -> Platform Admin -> same-origin -> zero query/Authorization header ->
JSON Content-Type -> real 2048-byte body / total 1000ms deadline / fatal UTF-8 ->
strict JSON parser and exact ASCII IDs -> shared limits -> trusted server scope ->
read-only service. Every response is no-store; no raw body/error/provider logging.
Context rate limits are separate from dispatch: actor 60/60s, target 30/60s. Limiter
failure/denial returns closed 503/429, with only canonical safe decimal Retry-After,
and prevents scope resolution/domain access.

The service revalidates persisted User/Platform Admin, Company and scoped Contact
inside a Serializable read transaction. It intentionally does NOT require an
active Contact/CommercialAccess/RemoteIdentity/ConsumerAuthorization: stale or
revoked eligibility must not hide a previously sent/ambiguous operation. It resolves
RemoteIdentity by companyId + providerScope + contactId, then the single operation
through the compound unique (companyId, providerScope, remoteIdentityId,
operationKind=CLIENT_PROFILE_UPSERT), without ordering Operations. Only id/intentKey/state/
revision are selected. Missing identity/operation returns null; structurally invalid
persisted data fails closed as CORRUPT_OPERATION, never absence.

The response is exactly `{ ok: true, operation: null }` or an operation containing
only operationId, commandId (persisted intentKey), one of the five ledger states,
and nonnegative safe revision. No identity/scope/actor, PII/profile, authorization
IDs, Events, timestamps or provider data are exposed. The domain service performs
ZERO writes; only the existing shared limiter may write RateLimitBucket at the
HTTP boundary. Material tests compare full domain snapshots before and after reads,
including archived/disabled/revoked fixtures and corruption/negative paths.

The createClient panel is nested in the existing human authorization panel; the
shared desktop/mobile mounting in page.tsx is unchanged. Frontend ADMIN visibility
is only an optimization; backend Platform Admin and domain authorization remain
authoritative. 401/403 hides the panel. Context reads happen on mount/target change
and explicit refresh; they never generate a UUID or trigger dispatch.

The single persisted operation survives reload. PREPARED always reuses the exact server commandId
and may continue only through another explicit human confirmation with active
authorization. IN_FLIGHT/UNKNOWN forbid resend; SUCCEEDED blocks a new intention;
FAILED requires manual review. No update/resync/new-registration action is offered
after terminal or pending state. A future deliberate update/sync intention is a
separate, out-of-scope flow.

For an absent operation, sessionStorage preserves ONLY a pending UUID under
`opencredit:create-client-command:<companyId>:<contactId>`. Reads validate UUID v4
again. Server context is authority: PREPARED synchronizes the local UUID, and all
other persisted states block new commands. No operation + valid pending UUID reuses
it; no operation + no pending UUID may generate crypto.randomUUID only after the
two visible confirmations and an explicit click. The createClient panel no longer
depends on a native browser confirmation dialog. Malformed pending values are never reused;
storage exceptions block dispatch. Persistence happens before the dispatch fetch. No UUID/pending
is cleared on 409/503, network/abort or malformed response.

The dispatch body contains companyId/contactId/commandId and the optional, closed
phonePolicy documented below. A working ref
and busy state stop double clicks; backend unique/CAS protection remains authority.
The backend also enforces a single CLIENT_PROFILE_UPSERT intention per Company +
providerScope + RemoteIdentity, independently of commandId and in every state.
After same-intent lookup (whose idempotent behavior is unchanged), fresh identity
resolution and a scoped identity/kind predicate read occur before creation in the
same Serializable transaction. Existing P2034 retries re-read the predicate; a
different command receives INTENT_CONFLICT. This closes cross-tab/administrator
races even when both read operation:null. Only the same PREPARED commandId may
continue via explicit human action. The UI is additional defense, not this guarantee.
A future deliberate update/sync requires a separate flow, outside this slice.
No provider idempotency guarantee is implied; remote one-shot remains mandatory.
Historical duplicates prevent the single-intent migration and deployment; neither
reader chooses a winner. No duplicate is automatically deleted, updated or cleaned
up. Such data requires a separate approved plan before rollout. Same-command lookup
stays idempotent; future update/sync requires an explicit new lifecycle.
After valid response, conflict, provider failure or network exception the
panel reloads server context, never performs automatic dispatch/retry. Failed reload
disables new action and asks for state confirmation, not replay. SETTLEMENT_FAILED
may mean the POST occurred; an IN_FLIGHT snapshot is retained without resend.

The createClient command requires two visible checkboxes: review of the customer
registration and acknowledgement that external creation/update must not be repeated
after a pending or ambiguous result. Both reset on phone-policy changes, context
reload (including operational-state changes), Company/Contact-keyed remount and
authorization changes. The UI button and local send callback require both, valid context, active
authorization and an allowed state; busy/working still prevent duplicate actions.

Local preparation (storage read, UUID resolution/validation, body serialization,
storage write) is caught separately before the dispatch fetch. A non-aborted failure
shows the fixed LOCAL_COMMAND_PREPARATION_FAILED human-readable message, clears
both confirmations and releases busy, without dispatch or automatic context reload.
No exception message, stack or storage content is displayed. Abort/stale epochs
remain silent and cannot start the dispatch fetch. Once transport starts, existing
ambiguous-result/reconciliation behavior and saved commandId protection remain
unchanged: no automatic resend, replacement command or replay.

This UI-only correction changes no server guard, endpoint, dispatcher, diagnostic,
provider client, schema or migration. Tests execute the actual TSX callbacks using
fake hooks/storage/crypto/fetch and cover pre-fetch failures and cancellation.
No PostgreSQL material rerun is needed for this correction because persistence,
transactions and all server-side files are unchanged. Existing material CI gates
remain intact. No real provider or production operation is used for validation.

Target-key remount, AbortController and sequence epochs prevent stale context or
dispatch responses from updating/reloading another contact. Browser abort is NOT
proof that the server POST was cancelled. The pending UUID is retained for future
state recovery. Client parsing and error messages are closed, getter-safe and
browser-only; no server internals or duplicated commercial eligibility logic.

All provider tests are fake; no live production E2E was performed. This slice makes
the existing real administrative dispatch available through an explicit human UI
after future authorized rollout, not a passive feature. No formal provider
idempotency guarantee or legal/LGPD conclusion is claimed. The read-context/human-UI
feature requires no storage of its own; this PR includes the associated single-intent
schema unique and migration. No env/dependency/Railway changes, new provider endpoints,
simulation/proposal/banking, AI/chatbot/worker/cron dispatch, automatic preparation/retry,
FAILED writer or active reconciliation. Reader/UI rollback removes the child panel
and context route/service and restores narrow guards/CI gates, not the single-intent
database protection. Any schema/data rollback requires a separate approved plan.

## Human createClient admin command (prior slice)

Historical status for this slice; the read-context/human-UI section above supersedes
its UI-activation and preparation-multiplicity status. Dispatcher and HTTP contracts
remain unchanged.

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN/UI FLOW: IMPLEMENTED
CREATE CLIENT ONE-SHOT DISPATCH CORE: IMPLEMENTED
CREATE CLIENT HUMAN ADMIN COMMAND: IMPLEMENTED
CREATE CLIENT HUMAN UI ACTIVATION: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
LIVE CREATE CLIENT DISPATCH: NOT EXERCISED
```

`POST /api/admin/integrations/opencredit/create-client/dispatch` is the only human
command consumer of the dispatcher core. It is a Node.js, force-dynamic thin route,
with no UI/button, AI/chatbot, webhook, worker, cron, bulk or automatic caller.
Implementation does not itself execute a live provider request; if deployed and
explicitly invoked by an authorized human, this endpoint can make the one-shot
business POST. Legal/operational rollout review remains separate.

The exact JSON body is `{ companyId, contactId, commandId }`, with no extra keys.
Company/contact IDs follow the existing ASCII administrative ID contract (1–128
characters, no normalization). commandId is a canonical lowercase UUID v4, no trim
or terminal newline. It is passed **unchanged as intentKey**, identifying the local
human intention by companyId + server providerScope + intentKey. It is **not a
provider idempotency key** and is never sent to the provider. A different commandId
cannot create another CLIENT_PROFILE_UPSERT for an identity with an existing intention,
nor replay an ambiguous prior operation; explicit future update/sync is out of scope.

Order: session -> Platform Admin -> same-origin -> no query/Authorization header,
JSON Content-Type (optional UTF-8 charset) -> strict bounded body -> rate limits ->
server providerScope -> prepare -> closed state decision -> optional dispatcher.
The body reader counts actual bytes (maximum 2048), ignores untrusted Content-Length,
uses one total 1000ms deadline even for empty chunks, fatal UTF-8 and the existing
strict JSON parser. BOM, duplicate decoded keys, trailing data, strange prototypes,
accessors, missing/extra fields and browser provider/profile/revision inputs fail
closed. Actor comes only from the session; domain services independently revalidate
persisted authority and company scope.

Shared rate limits are independent: actor [session.companyId, session.id] 10/60s,
target [companyId, contactId] 3/60s, command [companyId, commandId] 3/60s. Failure
returns 503 RATE_LIMIT_UNAVAILABLE; denial returns 429 RATE_LIMITED. Retry-After is
copied only if canonical nonnegative decimal and a safe integer; it is NOT advice
to retry a business operation. No provider resolution/domain mutation follows denial.

Only PREPARED invokes the dispatcher, with the exact prepared operationId/revision.
Prepare creates the local PREPARED intention before dispatcher authentication. If
authentication fails before reservation, PREPARED remains, with zero reservation
and zero business POST. A future explicit human invocation of the same commandId
may try again while it is still PREPARED; this is not post-commit replay.
Existing IN_FLIGHT, SUCCEEDED and UNKNOWN return a closed snapshot with dispatched=false,
without invoking the dispatcher. FAILED/unrecognized state returns 409
OPENCREDIT_COMMERCIAL_OPERATION_OPERATION_STATE_INVALID, never replay. A dispatcher
SUCCEEDED/UNKNOWN result returns dispatched=true. The only success fields are
`ok`, `operationId`, `state`, `revision`, `dispatched`; no `created`, PII, profile,
provider status/body, authorization identifiers, tenant/scope, tokens or raw errors.
All responses use Cache-Control: no-store.

Domain and dispatcher errors use closed module-instance-stable readers: global
Error plus exact own data name/code/message, no getters or original exception.
Domain NOT_AUTHORIZED is 403; invalid input/scope/revision codes are 400; domain
state/freshness/identity/authorization/concurrency conflicts are 409; STORAGE_ERROR
and INVALID_OBSERVATION are 503. Dispatcher INVALID_INPUT is 400; CONFIGURATION,
AUTHENTICATION, PRE_DISPATCH_UNAVAILABLE and SETTLEMENT_FAILED are 503. Unknown errors
are 503 OPENCREDIT_CREATE_CLIENT_DISPATCH_UNAVAILABLE. Provider scope resolution
failure is 503 OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION. SETTLEMENT_FAILED may mean
the POST occurred: never suggest retry, reset state or perform automatic replay.

Material tests use real local disposable PostgreSQL and exclusively fake provider
transport (global live fetch blocked). Sequential duplicates preserve operationId
and make zero second POST; concurrent duplicates prove one operation, one PREPARED,
one reservation and exactly one fake POST (losing CAS may be 409). Separate tests
cover ambiguity, auth failure, revocation before/after reservation and settlement
failure followed by an IN_FLIGHT snapshot with no replay. Distinct commandIds are
tested only as local preparations, without multiple automatic dispatches. CI runs
the new material suite sequentially after existing PostgreSQL gates.

No changes to core dispatch ordering, auth/401, serializer, CAS, authorization,
outcome/settlement, schema, migration, env, dependencies or Railway. Rollback before
rollout: remove the thin command route/handler and restore the narrow consumer
guards/CI steps; no database rollback is required. Future dispatch UI stays BLOCKED.

## One-shot createClient dispatcher core (prior slice)

Historical status at the dispatcher-core slice. The human command section above
supersedes runtime-consumer/activation status; older sections describe their own slices:

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
AUTHENTICATED INBOUND EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE FOUNDATION: IMPLEMENTED
COMMERCIAL OPERATION AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN COMMAND API: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN CONTEXT API: IMPLEMENTED
HUMAN AUTHORIZATION REVIEW UI: IMPLEMENTED
CREATE CLIENT ONE-SHOT DISPATCHER CORE: IMPLEMENTED
RUNTIME CREATE CLIENT COMMAND: BLOCKED
LIVE CREATE CLIENT DISPATCH: NOT EXERCISED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

`dispatchOpenCreditCreateClient` is server-only and has **no runtime caller**.
There is no dispatch endpoint, button, worker, cron, webhook, AI or chatbot caller.
It never prepares an operation or grants authorization automatically. It accepts
only actor/companyId/operationId/expectedRevision, using closed own data properties.
The existing service revalidates the current persisted actor in each transaction.

Literal flow:

```text
trusted configured tenantId + providerScope snapshot
-> authenticate (login/refresh as needed, before reservation)
-> reserve PREPARED -> IN_FLIGHT and commit
-> ONE POST
-> strict HTTP JSON response boundary
-> createClient contract parser
-> conservative outcome policy
-> SUCCEEDED/UNKNOWN settlement using reservation.revision
```

`resolveConfiguredOpenCreditProviderContext()` validates tenantId and partnerId
once and derives the same stable scope from that exact snapshot. It returns only
tenantId/providerScope, not credentials or partnerId. The existing scope-only
functions delegate and preserve their previous derivation. No browser/request
supplies tenant, scope, profile, CPF, authorization IDs, URL, headers or token.

`postJsonAfterCommit(path, commit)` validates its path before authenticating, builds
the internal bearer and fixed JSON headers before the callback, then awaits that
callback exactly once. Its callback receives no token. Only after callback success
does it attempt one fixed-method POST. The client does not serialize/read the body,
refresh, login or replay after commit. A business 401 returns its Response and
expires only the matching cached access token for a future operation. Existing
`request()` GET/HEAD behavior is unchanged. No 4xx/5xx triggers one-shot retry.
The new primitive additionally rejects percent-encoded/ambiguous paths and
backslashes/control characters; configured tenant IDs are already restricted ASCII,
so no encoded auth alias or traversal is needed or accepted by this one-shot path.

Inside the existing Serializable reservation transaction the order is freshness,
current ACTIVE authorization/current GRANTED binding, closed deterministic profile
serialization, PREPARED CAS, RESERVED_FOR_DISPATCH Event, commit. Serialization
failure aborts before CAS/Event. `profile` remains compatible; added `profileJson`
contains only the 19 contract fields in fixed order. It is transient memory only,
never persisted, logged, placed in an Event or exposed to a browser. No HTTP,
authentication or API client runs inside the transaction.

The business path is exactly
`/api/tenants/${encodeURIComponent(tenantId)}/integration/clients`, with no query.
The body is exactly the committed reservation's pre-serialized `profileJson`.
No intentKey, provider idempotency key or authorization IDs are sent to OpenCredit.
There is **no published provider idempotency guarantee** being claimed.

| Observation | Settlement |
| --- | --- |
| Parsed HTTP 201, success=true, created=true | SUCCEEDED / CREATED |
| Parsed HTTP 201, success=true, created=false | SUCCEEDED / UPDATED |
| Parsed HTTP 201, false/false or false/true | UNKNOWN |
| Any non-201, including 401/403/429/5xx | UNKNOWN |
| INVALID_CONTENT_TYPE / TOO_LARGE / INVALID_UTF8 / INVALID_JSON / STREAM_ERROR / INVALID_RESPONSE | UNREADABLE_RESPONSE -> UNKNOWN |
| Valid JSON rejected by operation contract | UNREADABLE_RESPONSE / INVALID_CONTRACT -> UNKNOWN |
| Response body read deadline | NO_RESPONSE / TIMEOUT -> UNKNOWN |
| Transport timeout/network after committed reservation | NO_RESPONSE / TIMEOUT or NETWORK -> UNKNOWN |

Response.ok is not a business decision. The two additional technical unreadable
reasons do not introduce any new positive classification. **Zero paths emit FAILED.**
Configuration/auth/login/refresh/network/timeout failures before reservation leave
the operation PREPARED, with no business POST or UNKNOWN settlement. Reservation
domain errors remain closed domain errors. All dispatcher errors use fixed codes
and messages without raw provider errors, causes, credentials or payloads.

Once committed IN_FLIGHT, crashes/transport ambiguity are potentially sent, never
permission to retry. If local settlement fails, the dispatcher throws fixed
`OPENCREDIT_CREATE_CLIENT_DISPATCH_SETTLEMENT_FAILED`, does not report success,
does not revert to PREPARED and never repeats the POST. IN_FLIGHT may remain and
requires future review/reconciliation; no reconciliation is implemented here.
Revocation after reservation does not invalidate the authorized commit-to-dispatch
fact: settlement never rereads Authorization/freshness. Concurrent commands for the
same PREPARED revision compete through the database/CAS, not an in-memory lock.

Results are only operationId/state/revision, plus created for SUCCEEDED. No profile,
CPF, raw observation, response, headers, URL, scope, tenant/partner or authorization
IDs escape. Tests exclusively use fake/in-memory transport and disposable local
PostgreSQL. No live createClient was exercised, no production/Railway was accessed,
and this slice does not declare legal/LGPD review complete. Runtime activation,
operational recovery policy and legal review remain separate gates.

## Human authorization review UI

Current slice: an authenticated Platform Admin can review technical inbound evidence
in the current Atendimento conversation and explicitly command the existing grant /
revoke endpoints. This is an operational human attestation, NOT an automatic LGPD
consent declaration or legal-basis determination. Legal/policy review remains external.

`POST /api/admin/integrations/opencredit/consumer-authorization/context` is a
read-only administrative snapshot. POST deliberately keeps identifiers out of query
strings. Body is EXACTLY `{companyId, contactId, conversationId}`. The boundary uses
session -> requirePlatformAdmin -> sameOrigin -> reject query/Authorization header ->
application/json -> 2048 actual bytes / 1000ms total deadline / fatal UTF-8 / existing
strict JSON parser -> exact IDs -> shared rate limit -> trusted scope -> read service.
Actor is server session only; providerScope is configured OPENCREDIT_TENANT_ID +
OPENCREDIT_PARTNER_ID through resolveConfiguredOpenCreditProviderScope(). Neither is
accepted from the browser or returned. Purpose remains internal CLIENT_PROFILE_UPSERT.
Grant/revoke boundaries and domain semantics are unchanged.

Context rate limits are actor 60/minute (session Company/id) and target 30/minute
(Company/contact), using the existing HMAC limiter. Every response is no-store;
only safe nonnegative integer Retry-After is preserved. The domain read performs
ZERO functional writes; shared RateLimitBucket infrastructure writes remain allowed.

The server-only read service uses a bounded Serializable read transaction and
rereads current User id/Company/ADMIN role/email plus isPlatformAdmin. It validates
Company, scoped Contact and Conversation/contact/Company bindings. Archived contacts
remain readable so existing authorization can still be reviewed and revoked; read
does not demand current CPF/access/identity freshness. Grant ALWAYS revalidates those
facts and evidence inside its own transaction at the moment of the command.

Authorization lookup is scoped Company/providerScope/contact/CLIENT_PROFILE_UPSERT.
Persisted structure is validated; corruption yields STORAGE_ERROR. Current evidence
is resolved independently of the recent-candidate window. If it belongs to another
valid conversation of this same Contact, evidenceMessageId is null for this view.
No association is inferred. Response is EXACTLY:

```text
{ ok: true,
  authorization: { exists, active, revision, evidenceInboundEventId, evidenceMessageId },
  evidenceCandidates: [{ inboundEventId, messageId }] }
```

Absent authorization uses false/false/null/null/null. No authorizationId, body,
CPF/phone/email, providerMessageId, providerScope, tenant/partner, identity/access,
actor, timestamps, legal basis or raw rows are returned. Errors are fixed: auth 401,
platform/origin/domain actor 403, malformed request 400, missing targets 404, limiter
429 or 503, configuration/storage/unknown 503. No arbitrary exception/Prisma data leaks.

The service reads the 100 most recent inbound events by local sequence DESC and
returns at most 50 eligible pairs in that order. These are LOCAL UI limits, not
OpenCredit rules or an assertion of provider chronological ordering. Technical
eligibility matches the existing grant evidence facts: authenticated Meta HMAC v1,
concrete channel, coherent Company/contact/conversation/channel/message relations,
inbound text with nonblank body/provider message id. Body is used transiently only
for the nonblank structural check; no semantic regex, keyword or AI analysis occurs.

The compact panel is mounted once in the shared details-content function next to
Ficha rapida, reused by desktop and mobile. Page props contain only session Company,
role-ADMIN attempt flag, current Contact/Conversation and reduced existing messages.
Frontend ADMIN is ONLY a loading optimization: the server remains authoritative;
401/403 hides the panel and SUPERVISOR/AGENT do not request context. Normal
ConversationRow, conversationInclude and mapConversation expose NO inboundEventId.
Message text comes exclusively from the already loaded conversation, joined by
messageId; unavailable messages are not invented or selectable. The context endpoint
is the exclusive source of candidate inboundEventId; there is no manual ID input.

Grant requires selecting ONE candidate, reading its full text, checking the explicit
operational attestation and clicking Registrar autorizacao. Selection, checkbox,
inbound arrival, effects and timers NEVER grant. ACTIVE authorization blocks new
grant and shows its current evidence when locally available; revoke is required
before choosing a different active evidence. Revoke requires an explicit confirmed
click. Its exact body is Company/contact; grant's exact body adds only the selected
candidate inboundEventId. No actor/scope/purpose/state/consent is sent.

Both mutation responses are defensively validated and followed by a fresh context
read, never optimistic state inferred from the mutation body. Closed human messages
replace raw errors; semantic conflicts refresh the context. AbortController and epoch
checks protect context AND mutations. A key of Company/contact/conversation forces
synchronous remount/reset on target changes; unmount aborts and invalidates old
requests. Aborting a browser request does NOT promise rollback of a server command;
future reads remain authoritative. No automatic retry of mutation is introduced.

Context is a potentially stale UI snapshot, NOT dispatch permission and NOT a
replacement for the grant service. No CommercialOperation is created/reserved or
settled by this flow; no OpenCredit HTTP/login/createClient, API client connection,
dispatcher, AI/chatbot, automatic grant, FAILED/replay/reconciliation, schema,
migration, environment, dependency or Railway change is introduced.
Rollback plan (not executed): remove the context route, panel/composition and read
service; restore the prior narrow consumer guards. Existing grant/revoke API and
persisted evidence/state remain intact; no database rollback is required.

Current status (supersedes the historical slice status blocks below):

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
AUTHENTICATED INBOUND EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE FOUNDATION: IMPLEMENTED
COMMERCIAL OPERATION AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN COMMAND API: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN CONTEXT API: IMPLEMENTED
HUMAN AUTHORIZATION REVIEW UI: IMPLEMENTED
CREATE CLIENT DISPATCH: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## Human authorization admin command boundary

Two server-side commands now expose the existing authorization service:

- `POST /api/admin/integrations/opencredit/consumer-authorization/grant`
  accepts exactly `{companyId, contactId, inboundEventId}`.
- `POST /api/admin/integrations/opencredit/consumer-authorization/revoke`
  accepts exactly `{companyId, contactId}`; evidence is not required for revocation.

Both require an authenticated cookie/session, current Platform Admin and same-origin
request. The exact session object supplies actor; the browser cannot supply actor,
scope, purpose, state, revision, identity, consent, legal basis or evidence contents.
Scope comes exclusively from `resolveConfiguredOpenCreditProviderScope()` using
server configuration OPENCREDIT_TENANT_ID + OPENCREDIT_PARTNER_ID. Purpose remains
closed inside the domain as CLIENT_PROFILE_UPSERT. No configuration is changed here.

Order: session → Platform Admin → same-origin → no query/Authorization header →
application/json (optionally charset=utf-8) → bounded body/strict JSON/exact IDs →
shared rate limiter → trusted scope resolver → existing grant/revoke service.
Body limit is 2048 actual bytes, with one 1000ms total read deadline and fatal UTF-8
decoding. Empty/malformed/duplicate-decoded-key/extra-field requests fail closed.
IDs are exact ASCII local identifiers, at most 128 characters, without normalization.

The existing HMAC-based limiter applies both 20 actor requests/minute and 10 target
requests/minute, separated by the fixed grant/revoke action. The actor key includes
session Company/id; target includes requested Company/contact. Limited/unavailable
responses are sanitized (429/503); only a safe integer Retry-After may be preserved.
Scope configuration failure is a fixed 503 without tenant/partner details.

The handler does not query domain tables, create Events, execute CAS or duplicate
freshness logic. The service still rereads actor and validates Company/contact,
access, identity and authenticated inbound evidence transactionally on grant.
Revoke retains its existing independence from later evidence/freshness changes.
The human selects/reviews inboundEventId outside this slice; neither the route nor
ingestion interprets text, and receiving inbound never automatically grants access.
This is an operational human attestation, NOT automatic LGPD consent or a resolved
legal basis. External legal/policy review remains necessary.

All responses use Cache-Control: no-store. Success is exactly
`{ok:true, changed, authorizationId, active, revision}` (including no-op/null results).
Errors use closed codes/statuses: authentication 401; admin/origin/domain actor 403;
invalid request/domain input 400; prerequisites/conflicts 409; storage/configuration/
unknown failures 503. Raw errors, Prisma metadata, evidence, message body, CPF,
provider message id, identifiers of other entities and credentials are never returned
or logged. Grant/revoke routes are thin composition only; narrow static guards permit
no webhook, AI/chatbot, worker, cron, campaign or other automatic mutation consumers.

No UI, OpenCredit HTTP/login/createClient, dispatcher or CommercialOperation
prepare/reserve/settlement is invoked by either command. No schema, migration,
environment, dependency or Railway change belongs to this slice. Existing material
PostgreSQL tests validate the unchanged domain; HTTP tests need no database.
Rollback plan (not executed): remove these two routes/composition and restore the
strict no-admin-consumer guards; existing domain data/schema need no migration.

Current status (the older sections below describe their original passive slices):

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
AUTHENTICATED INBOUND EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE FOUNDATION: IMPLEMENTED
COMMERCIAL OPERATION AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN COMMAND API: IMPLEMENTED
HUMAN AUTHORIZATION UI: BLOCKED
CREATE CLIENT DISPATCH: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## Reservation authorization enforcement

The passive local reservation boundary now requires persisted operational human
authorization. This does NOT establish LGPD consent, legal basis, contractual
acceptance or provider permission; external legal/policy review remains necessary.
The human admin command boundary above is now implemented; there is no real dispatcher.

The literal flow inside the same Serializable transaction is:

```text
current Platform Admin + Company
→ PREPARED operation + matching expectedRevision
→ linked RemoteIdentity + existing Contact/access/CPF/profile freshness
→ ACTIVE ConsumerAuthorization for company/scope/contact/CLIENT_PROFILE_UPSERT
→ matching current GRANTED AuthorizationEvent
→ atomic PREPARED -> IN_FLIGHT CAS
→ RESERVED_FOR_DISPATCH bound to that exact AuthorizationEvent
→ successful transaction commit
```

PREPARE remains an unauthorised local intention and does NOT require consumer
authorization. Reserve checks the exact current slot, matching remoteIdentityId,
closed purpose, boolean active, safe nonnegative revision and valid evidence id.
Missing/inactive/mismatched authorization fails closed without releasing a profile.
Its unique (authorizationId, revision) must yield an Event with valid id, exact
parent/company/scope/revision/evidence, action GRANTED and nextActive=true.
No Message/body is read, no HMAC is rechecked and no semantic interpretation occurs.
The operation service reads the two Prisma models directly; it does not import
the separate grant/revoke mutation service.

New sanitized codes are CONSUMER_AUTHORIZATION_MISSING,
CONSUMER_AUTHORIZATION_INACTIVE, CONSUMER_AUTHORIZATION_MISMATCH and
CONSUMER_AUTHORIZATION_EVENT_INVALID, under the existing service error prefix.
Existing transaction bounds/retries, intentKey, prepare and settlement rules
remain unchanged.

The successful IN_FLIGHT commit is the **LOCAL COMMIT-TO-DISPATCH POINT**.
Authorization must be active in the winning reservation transaction. Treat a
committed IN_FLIGHT as potentially sent even if the process crashes before HTTP.
There is no HTTP in this transaction (or anywhere in this slice).

A later revoke leaves the operation IN_FLIGHT and preserves the historical
GRANTED binding; it is not retroactive and cannot roll back the reservation.
It blocks new reservations. Settlement SUCCEEDED/UNKNOWN does not reread
Authorization, evidence, Contact or identity. UNKNOWN -> SUCCEEDED remains
blocked, FAILED has no writer, and automatic replay remains FORBIDDEN.
No transaction may be held open during future HTTP.

Concurrent reserve/revoke is interpreted by Serializable transaction order,
not an assumed wall-clock order: reserve-first can commit one bound IN_FLIGHT
before revocation; revoke-first makes reserve reject INACTIVE and remain PREPARED.
CAS still requires exactly one winner and operation Event creation is atomic.
Event FK/commit failure rolls back the reservation and cannot release a profile.
After GRANTED rev0 -> REVOKED rev1 -> GRANTED rev2, a new reservation binds rev2,
never rev0.

Reservation returns the existing operationId/state/revision/profile plus only:

```text
dispatchAuthorization: {
  authorizationId,
  authorizationRevision,
  authorizationEventId
}
```

This is a fresh closed audit object, not replay permission. No body, provider
message id, raw evidence row or additional CPF is returned.

The additive migration
`20261019200000_add_opencredit_dispatch_authorization_binding` adds AuthorizationEvent
uniques (authorizationId, revision) and (id, companyId, providerScope), plus nullable
OperationEvent.dispatchAuthorizationEventId, its index and scoped RESTRICT/NO ACTION
FK. A defensive CHECK permits a nonnull binding only for RESERVED_FOR_DISPATCH.
It deliberately does NOT require nonnull binding on historical reservation rows.
No DML/backfill, inferred authorization or historical rewrite is introduced.
Duplicate preexisting authorization revisions would make the unique migration
fail closed; this slice never repairs or deletes such data automatically.

Every NEW reservation through the service records a binding. Historical IN_FLIGHT
operations without it must not be automatically resent; they require separate
future reconciliation. A future dispatcher must accept only new-flow reservations.
Neither dispatcher nor reconciliation is implemented here.

Validation covers unit corruption/fail-closed cases, PostgreSQL migration/FK/unique/
CHECK enforcement, current rev2 binding, concurrent reserves, reserve/revoke,
post-revoke settlement, real Event FK rollback and nullable legacy compatibility.
Only disposable local/guarded CI PostgreSQL is permitted. Existing material/static
storage tests now account for exactly the new nullable field/index/FK, preserving
the old constraints. Existing service/authorization CI gates are reused; explicit
profile-contract and mocked API-client gates fill the two previously absent gates.

Rollback plan (not executed): revert application enforcement before considering
removal of the optional binding FK/index/CHECK/column and new uniques, with audit
retention/dependency review. Do not delete evidence or backfill historical rows.
No production/Railway operation, environment/dependency change, runtime caller,
endpoint, UI, AI/chatbot, automatic grant, provider request or dispatch is added.

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
AUTHENTICATED INBOUND EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE FOUNDATION: IMPLEMENTED
COMMERCIAL OPERATION AUTHORIZATION ENFORCEMENT: IMPLEMENTED
HUMAN AUTHORIZATION ADMIN COMMAND API: IMPLEMENTED
HUMAN AUTHORIZATION UI: BLOCKED
CREATE CLIENT DISPATCH: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## Consumer authorization evidence foundation (original passive slice)

This passive foundation adds an operational human attestation, NOT automatic
LGPD consent, legal basis, contractual acceptance or provider authorization.
The granting Platform Admin attests that they reviewed the referenced authenticated
inbound text and that it authorizes the specific operational purpose
`CLIENT_PROFILE_UPSERT`. Legal adequacy and external policy/legal review remain
pending; this mechanism does not resolve them.

The injected-DB, server-only service has only grant-from-inbound-evidence and
revoke commands, without any endpoint, UI, worker, webhook/AI caller or automatic
grant. Receiving an inbound message never creates an authorization. The commercial
operation service is unchanged and does NOT consume this authorization yet.
The next reservation/dispatch boundary must require ACTIVE authorization.
No HTTP, OpenCredit login, createClient, replay or provider operation is enabled.

Evidence must be an existing `ConversationInboundEvent` with exactly
`META_WEBHOOK_HMAC_SHA256_VERIFIED`, version 1, a concrete Channel and a coherent
Company/Contact/Conversation/Message binding. Message must be inbound text with
nonblank body and providerMessageId. Existing HMAC provenance and immutability
triggers are reused, not duplicated. Software checks only authenticity, scope
and nonblank text; it does not interpret “sim”, “aceito”, “autorizo” or any meaning.
Body is read transiently for this structural check, never copied, hashed, logged,
returned or snapshotted into either new table. CPF is not stored there either.

`OpenCreditConsumerAuthorization` stores id, companyId, contactId,
remoteIdentityId, providerScope, fixed purpose, evidenceInboundEventId, active,
revision, changedByUserId, createdAt and updatedAt. Its unique current slot is
(companyId, providerScope, contactId, purpose). Composite FKs bind evidence to
(id, companyId, contactId), identity to (id, companyId, providerScope), and Contact
to its Company. The service additionally verifies identity.contactId and current
CPF ownership/snapshot, including archived duplicates when detecting ambiguity.
New `ConversationInboundEvent(id, companyId, contactId)` uniqueness supports
the evidence FK without relaxing any existing constraint.

`OpenCreditConsumerAuthorizationEvent` stores id, authorizationId, companyId,
providerScope, actorUserId, action, previousActive, nextActive, revision,
evidenceInboundEventId and createdAt. A composite FK binds it to the authorization;
User and evidence FKs are RESTRICT/NO ACTION. Only GRANTED and REVOKED are accepted.
Each transition preserves its own evidence reference. The service never updates
or deletes Events. This is application append-only audit, not a claim of a new
database-wide immutable audit trigger.

| Existing state | Command | Result |
| --- | --- | --- |
| Absent | GRANT | Active, revision 0, GRANTED(null → true) |
| Active, same evidence | GRANT | No-op, no Event/timestamp/revision change |
| Active, different evidence | GRANT | AUTHORIZATION_CONFLICT |
| Inactive | GRANT | Full freshness checks, CAS to active, revision +1, GRANTED |
| Active | REVOKE | CAS to inactive, revision +1, REVOKED; evidence preserved |
| Inactive / absent | REVOKE | No-op; absent returns null id/revision |

Grant revalidates the effective current Platform Admin, Company, Contact,
canonical/formatted CPF ambiguity, enabled CommercialAccess, enabled RemoteIdentity,
global CPF ownership and authenticated evidence in the same Serializable
transaction. Revoke revalidates actor/Company only; archived Contact, changed CPF,
revoked access or disabled identity must not prevent revocation.
State mutation and Event creation are atomic. CAS includes id/companyId/
providerScope/active/revision and requires count=1. P2034 retries are bounded at
three transactions (maxWait 2000, timeout 5000). P2002 is retryable only for
creation of the expected current-slot unique; the winner is then reread.
Errors expose only fixed codes, never raw database errors/metadata or content.

The additive migration
`20261019150000_add_opencredit_consumer_authorization_evidence` creates only the
two tables, unique/indexes, defensive purpose/revision/action/transition CHECKs
and FKs. It contains no DML/backfill or historical authorization inference.
Existing databases begin with ZERO authorizations. SQLite schema mirrors the
models/relations; these PostgreSQL CHECKs are migration-specific.

Validation includes unit/static guards, guarded disposable PostgreSQL migrations,
real HMAC evidence ingestion, scoped FKs/CHECKs, concurrent first grants, grant/
revoke races, strict no-ops, and rollback on real Event FK failure. Test-only
transaction proxies are not production failpoints. An extra dedicated test-only
database guard rejects nonlocal/non-disposable contexts before client construction.
All previous CI gates remain; new unit/material gates and project verify are added.

Rollback plan (NOT executed): first revert application use of this passive service;
review retention and dependencies before removing Event then Authorization tables
and their indexes/FKs, and only then the new inbound unique. Never delete retained
evidence or modify old provenance triggers. No production migration is run here.

Status at completion of the original evidence foundation (historical; enforcement above supersedes it):

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
AUTHENTICATED INBOUND EVIDENCE: IMPLEMENTED
CONSUMER AUTHORIZATION EVIDENCE FOUNDATION: IMPLEMENTED
COMMERCIAL OPERATION AUTHORIZATION ENFORCEMENT: BLOCKED
CREATE CLIENT DISPATCH: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## Original authentication slice audit

Audited against the official [partner documentation](https://core.api.opencredit.tech/api/partner-docs)
and its [OpenAPI](https://core.api.opencredit.tech/api/partner-openapi.json), contract 2.8.0,
on 2026-10-14. Existing inbound ingestion/HMAC and configuration are independent.
No changes to lead.assigned, receive modes, schema, migrations or UI are needed.

## Server-only client

`src/lib/opencredit-api-client.ts` exports a lazy reusable client and injectable factory.
Supply OPENCREDIT_API_EMAIL and OPENCREDIT_API_PASSWORD through the deployment's
secret manager; never put actual values in Git, logs, browser state or URLs.
Importing the client makes no requests. The administrative authentication, connection,
access diagnostic and catalogue operations described below use it; no commercial
workflow is connected.

The module uses the public `import "server-only"` marker, as documented in
[Next.js environment poisoning protection](https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning).
Next handles this import internally and rejects accidental Client Component
imports at build time. Installing the package is optional in a Next application;
no package or compiler configuration changes are made here. The existing
`typeof window` runtime check is preserved.

Standalone Node unit tests do not run through the Next compiler. The test
bootstrap stubs only the public marker during import, then immediately restores
the Node loader. Authentication/refresh/retry and the runtime check are not
mocked. Tests do not reference Next implementation paths. Run normally:

```powershell
npx.cmd --yes tsx@4.20.6 src/lib/opencredit-api-client.test.ts
```

Tests verify the public marker is present and the runtime guard still rejects a
browser environment. They do not create a
temporary Client Component fixture or alter the application to provoke a failed build.

The environment account is a **partner account**, not a company-specific binding.
Future callers must authorize the CRM company and explicitly validate its partner /
provider tenant association before using it. Never expose this as a generic proxy
to arbitrary tenants. The client does not choose a tenant or infer it from leads.

Login sends JSON email/password to POST /api/auth/login. Refresh sends JSON
refreshToken to POST /api/auth/refresh. Both read data.accessToken,
data.refreshToken and data.expiresIn (seconds); access tokens last up to 8 hours,
refresh tokens up to 30 days. Renewed pairs replace the old pair.

Tokens stay in a private per-client memory closure, never DB/files/cookies. They
are discarded after ten minutes idle, on disposal, credential change or a second
401. Process restart requires login again. No cross-process cache is introduced;
replicas authenticate independently. Garbage collection is not cryptographic
memory erasure. In-flight operations can temporarily retain credentials/tokens.
Login/refresh concurrency within one client is single-flight, including stale 401s.

Refresh precedes another password login. Only refresh 401/403 warrants automatic
login fallback; 400/429/5xx, network, timeout or malformed response stop with a
fixed sanitized error. Provider error payloads and raw exceptions are not logged
or propagated. Redirects are refused, origin is fixed and caller bearer headers
are overwritten. Authentication reads are bounded to 16 KiB and ten seconds.

`request('/api/...', init)` attaches the bearer privately. On 401 it renews the
pair, then retries GET/HEAD at most once. POST/PATCH/DELETE are **never replayed**:
the original 401 is returned after renewal. Future business callers must decide
whether retry is safe using provider idempotency; this layer does not trigger
credit operations or simulate/propose anything. Successful business response
body consumption remains the caller's responsibility; fetch timeout covers
headers, while auth timeout also covers body consumption.

## Webhook registration: documentation only

The OpenAPI `webhooks.lead.assigned` section describes delivery to a URL registered
with Prospecta and optional provider HMAC secret. The published `paths` contain
**no authenticated endpoint to register/update that URL or secret**. Do not invent
one, scrape internal admin APIs, or use credit/feedback routes for registration.

Planned onboarding: an authorized ADMIN creates the disabled CRM integration;
securely supplies its URL and one-time HMAC secret to the Prospecta onboarding
contact; obtains confirmation that the exact raw-body HMAC header is configured;
only then explicitly enables the intended CRM binding. QEVORA requires HMAC even
though the provider documentation describes it as optional. Partner login tokens
are not webhook HMAC secrets and never replace signature validation.

No registration, credentials configuration or real API request was performed.
Rollback: remove the connection endpoint and then the client/tests/document when
no caller remains; no database rollback is needed.

## Explicit platform-admin connection test

POST `/api/admin/integrations/opencredit/test-connection` requires a current QEVORA
session and the existing `requirePlatformAdmin` policy. It does not authorize all
Company admins to use the partner account. Body must contain zero bytes (even `{}`
is rejected); an empty transport stream is accepted, and a stalled request body
is cancelled/rejected after one second. Queries and inbound Authorization headers
are rejected. Origin must
match the request protocol plus Host (or URL host when absent). Next's listener
URL can use an internal host behind a proxy; X-Forwarded-Host is not trusted for
this comparison. Sec-Fetch-Site, if present, must be same-origin.
No UI or automatic invocation is added. All responses use Cache-Control: no-store.

After authorization/request validation, the existing shared limiter enforces
three attempts per minute with both companyId and userId in the rule identity.
The only permitted database writes are existing RateLimitBucket infrastructure;
session freshness performs its usual User read. No functional records are changed.

For test-connection, three settings must exist before external requests:
OPENCREDIT_API_EMAIL, OPENCREDIT_API_PASSWORD and OPENCREDIT_TENANT_ID. The tenant ID accepts
1–128 ASCII letters/digits/underscore/hyphen, starting with a letter/digit. Values
are runtime-only, never hardcoded, accepted from requests or stored in the database.
OPENCREDIT_PARTNER_ID is neither read nor required by this connection test; it is
not removed globally and remains required by diagnose-access. Confirm account,
tenant and any route-specific partner relationship through provider onboarding.
This endpoint is not a Company-to-partner commercial authorization registry.

The service constructs exactly GET `/api/tenants/{tenantId}/banks?product=clt`,
without partnerId. It never selects another path or initiates commercial
POST/PATCH/DELETE. Required login/refresh POSTs remain solely in the existing client.
Provider 401 recovery and the single GET retry are unchanged; no service retry exists.

The original provider documentation indicated partnerId for the banks query. In a
production diagnostic reported by the operator with role API_CLIENT, authentication
succeeded and the configured tenant matched the decoded/unverified token tenant.
The observed responses were:

- `/banks?product=clt&partnerId=...`: HTTP 404;
- `/banks?product=clt`: HTTP 200;
- `/banks?partnerId=...`: HTTP 404.

The connection test therefore omits partnerId as compatibility observed for this
banks route and this API_CLIENT credential. This is not a claim that partnerId is
globally invalid or unnecessary for other accounts/routes. No global partner
support or configuration is removed. The three diagnose-access probes remain
unchanged, including the variants that send partnerId. No production request was
repeated as part of this change.

A 20-second total deadline includes client authentication/request and body reading.
The JSON body is bounded to 64 KiB of actual bytes and data.items is validated
(at most 1000 items with valid bankId and nonblank bankName). Only `{ok:true,
bankCount:number}` is returned; extra fields, bearer, headers and raw error bodies
are never forwarded or logged. Empty items is valid, not a synthetic fallback.

HTTP errors: QEVORA authentication 401, platform/origin rejection 403, unexpected
request 400, limiter 429 (or unavailable 503), configuration 503, provider rejection /
invalid response 502, provider 429/5xx or network/deadline 503. No failure returns 200.
On timeout, the service aborts the request and cancels a body reader when available.
Already in-flight shared auth can still complete: this is not a promise of provider
cancellation. Late responses are cancelled/discarded, not returned as success.

Validation uses injected transport, fictitious configuration and an isolated limiter
store. No real login, provider request, Railway configuration or webhook activation
is performed. Rollback this slice by removing the unused administrative endpoint
and its service/tests; no database/schema rollback is required.

## Isolated administrative credential test

`POST /api/admin/integrations/opencredit/test-authentication` requires only
OPENCREDIT_API_EMAIL and OPENCREDIT_API_PASSWORD. It does not read tenant/partner
configuration or call banks or commercial endpoints. No UI/automatic call is added.
It uses the existing session freshness, platform-admin permission, same-origin and
truly empty-body checks. Query parameters and incoming Authorization are rejected.
The shared limiter uses its own opencredit-test-authentication category, allowing
three attempts per minute per companyId + userId. Only RateLimitBucket infrastructure
writes are permitted; there are no functional writes.

The client's server-only `verifyCredentials(): Promise<void>` always sends one fresh
POST to the fixed official /api/auth/login using current server credentials, even
with cached tokens. It never refreshes or retries. Existing bounded auth parsing,
10-second timeout, redirect rejection, credentials omit and no-store are reused.
The returned token pair is discarded, never published or persisted. The method does
not replace the request() token cache or change request() login/refresh/retry policy.
A provider login could affect existing provider-side sessions; this depends on the
provider and has not been tested live. The test is administrative and rate-limited.

Success is exactly `{ok:true}`. Errors contain only a sanitized code, plus an integer
providerStatus (100–599) if an actual HTTP rejection was received. Login 400/401/403
and other non-2xx rejections return FAILED/502; 429/5xx return PROVIDER_UNAVAILABLE/503.
Local configuration/network/timeout errors return 503 and malformed successful auth
payloads return INVALID_RESPONSE/502, without providerStatus. Every response is
Cache-Control: no-store. No body, token, credential, URL or provider header is exposed
or logged. A successful test validates only login, not tenant/partner authorization.

Automated validation uses fake transports only. This slice does not activate any
integration, webhook, bank call or business workflow. Rollback removes this endpoint
and verifyCredentials; no schema/migration/data rollback is necessary.

## Administrative read-only access diagnostic

`POST /api/admin/integrations/opencredit/diagnose-access` separates password acceptance
from the banks route/tenant/partner response. It is not a commercial capability or
a proxy. It requires session freshness and platform-admin authorization, same origin,
a truly empty body (not `{}`), no query and no inbound Authorization. Responses are
no-store. The shared limiter category opencredit-diagnose-access permits two runs per
minute per companyId + userId. Only existing RateLimitBucket infrastructure writes
are permitted; no domain writes, schema changes or migrations are introduced.

Both configured IDs are validated before creating a private per-execution client.
Email/password are read only on the server. The dedicated diagnoseAccess operation
reuses the existing bounded login parser and transport, sends exactly one fresh
login and never uses refresh or retries. It neither reads nor changes request()'s
cache, pending auth, fingerprint or idle timer. The client is disposed in finally.
The same fresh bearer stays inside the client for all three sequential GETs:

1. configured: banks?product=clt&partnerId={configuredPartner}
2. missingPartnerId: banks?product=clt
3. missingProduct: banks?partnerId={configuredPartner}

All three paths use only the configured tenant under the fixed official origin.
Browser input and decoded claims never choose a URL, tenant, partner, method or query.
No alternate tenant is tried. Each external call retains the ten-second timeout
(up to roughly forty seconds of provider I/O per complete run). Bodies from probes,
including 2xx bodies, are cancelled/discarded without reading or parsing. A probe's
401 is reported directly, not refreshed or replayed. Network/timeout probes report
only `{error:"NETWORK"}` or `{error:"TIMEOUT"}`, without an invented status, and the
remaining fixed probes may proceed. No request is repeated.

A completed diagnostic returns HTTP 200 even if banks rejects all three GETs.
Its exact successful response shape is:

```text
{
  ok: true,
  authentication: { ok: true },
  token: { format: "opaque" } OR {
    format: "jwt", decodedOnly: true,
    role: { present: boolean, value?: string[] },
    tenant: { present: boolean, value?: string },
    partner: { present: boolean, value?: string }
  },
  tenantMatchesConfigured: boolean | null,
  partnerMatchesConfigured: boolean | null,
  probes: {
    configured: Probe,
    missingPartnerId: Probe,
    missingProduct: Probe
  }
}
Probe = { status: number, requestId?: string, correlationId?: string,
          traceId?: string, traceparent?: string }
     OR { error: "NETWORK" | "TIMEOUT" }
```

Decoded/unverified claims are diagnostic ONLY, not signature verification or QEVORA
authorization. Only role/roles, tenantId/tenant_id and partnerId/partner_id are read.
Role uses a conservative printable ASCII subset, up to ten values/64 characters each.
IDs are bounded to 128 ASCII letters/digits/underscore/hyphen; safe integer IDs become
strings. Invalid or conflicting aliases expose only presence. Malformed JWT-shaped
payloads are treated as opaque. No subject, email, name, CPF, jti, timestamps, complete
payload/header/signature or arbitrary claims are returned. No configured ID is echoed
as a substitute for an absent claim. Comparisons are exact/case-sensitive and null
when a safe claim is unavailable; they never confer permissions.

Only x-request-id, x-correlation-id, x-trace-id and traceparent may be copied into
the named output fields, with a conservative ASCII whitelist and 256-character cap.
Known credentials and token values are also suppressed in allowed claims/headers.
Cookies, Location, Authorization, other headers, raw bodies and raw errors are never
logged/returned. Claims/request IDs are still untrusted provider-controlled strings;
display them as text, never HTML. A status such as 400/404 alone does not prove why
access was rejected.

Login failures reuse the test-authentication sanitized error codes/status mappings;
no probes run after failed login. Invalid/missing configuration returns sanitized
CONFIGURATION/503 before probes. A live login might affect provider-side sessions;
this provider behavior remains unverified. Automated tests use fakes only and do not
contact production, Railway or OpenCredit. No webhook or ACTIVE/PAUSED/DISABLED change.
Rollback removes the dedicated diagnostic route/service/summary/client method; no
database rollback is required.

## Administrative available CLT banks

The operator reported a production test-connection result of `{ok:true,bankCount:8}`.
Eight is an observation, never a hardcoded count or guarantee of future availability.
No live request was repeated while implementing this slice.

`POST /api/admin/integrations/opencredit/list-banks` is an administrative read-only
listing, not a commercial endpoint. It uses exactly
`GET /api/tenants/{configuredTenant}/banks?product=clt` via the existing server-only
client, without partnerId. Required server configuration is only OPENCREDIT_API_EMAIL,
OPENCREDIT_API_PASSWORD and OPENCREDIT_TENANT_ID. Partner configuration remains intact
for diagnose-access and any future routes that require it.

The route uses current session freshness, requirePlatformAdmin, the existing
same-origin and zero-byte body checks, rejects query parameters and inbound
Authorization, and returns Cache-Control: no-store for all POST responses.
The existing shared limiter uses category opencredit-list-banks with three runs
per minute per companyId + userId. There is no UI or automatic invocation.
Only existing RateLimitBucket infrastructure writes are permitted; no functional
records are created or changed.

The fixed banks reader is shared with test-connection: same twenty-second total
deadline, 64 KiB declared/actual response size cap, JSON parsing and complete
data.items validation. At most 1000 objects are allowed, with bankId matching
1–128 ASCII letters/digits/underscore/hyphen (first character a letter/digit) and
a nonblank bankName up to 200 characters. Any invalid item rejects the whole list.
The server reconstructs every item as exactly `{bankId,bankName}`, retaining provider
order and original case/text. No metadata, configuration, credentials, pricing,
permissions, arbitrary headers or raw provider bodies are forwarded or logged.

Success is exactly `{ok:true,count:banks.length,banks:[{bankId,bankName},...]}`.
An empty array returns `{ok:true,count:0,banks:[]}`; no fallback catalogue is invented.
The new listing rejects every exact duplicate bankId as INVALID_RESPONSE, even
when the names match. Different names for one ID are never silently accepted.
IDs are case-sensitive and no sorting/deduplication/normalization is performed.
This additional duplicate rule applies only to list-banks: test-connection retains
its existing count-only behavior and exact response `{ok:true,bankCount:number}`.

Sanitized provider failures retain the existing status mapping under
OPENCREDIT_LIST_BANKS_*: authentication 502, invalid payload 502, other rejection
502, provider 429/5xx or network/timeout/configuration 503. A real known HTTP error
may include only a validated numeric providerStatus. No raw error or stack is exposed.
The client login, private token cache, refresh, single GET/HEAD retry and
non-idempotent no-replay rules are unchanged.

Bank names and IDs remain untrusted provider text: display as text, never HTML.
The list is NOT authorization for any financial operation or CRM Company to use the
shared partner account. Later steps must independently authorize company scope and
validate the rules for their exact provider routes. This slice does not create a
client, lead, simulation, proposal, reservation, submission or contract; it does not
query CPF, change webhook/receive modes, or add any schema/migration/Railway changes.
All automated tests use fake providers. Rollback removes the list route/service and
restores the prior count implementation/helper layout; no database rollback is needed.

## Administrative conservative bank capabilities

`POST /api/admin/integrations/opencredit/bank-capabilities` is read-only for domain
data and uses only the already approved banks request:
`GET /api/tenants/{configuredTenant}/banks?product=clt`, without partnerId or CPF.
Login/refresh remain exclusively in the unchanged existing client; no second client
or token cache, new provider route, UI or automatic invocation is added.

### Contract provenance: local QEVORA policy, not a formal provider schema

The official OpenAPI 3.1.0 / contract 2.8.0 checked on 2026-10-15 publishes banks
only at responses.200.content.application/json.schema.example.data.items.
There are no formal properties/required/nullability declarations for these fields.
The seven names below occur flat on each example bank item with boolean examples.
Their optionality and strict validation here are an explicitly approved conservative
LOCAL QEVORA contract, NOT inferred provider required/properties rules:

- simulacaoAtiva
- digitacaoAtiva
- suportaParcela
- suportaLiquido
- aceitaChavePixReal
- somentePix
- exigeContatoEmpregador

Only own present properties are considered. Absence means omit the public property;
it is never false and never grants permission. A present value must be a real boolean:
both true and false survive unchanged. Null, strings (including "true"/"false"),
numbers, arrays, objects and explicit undefined are invalid. Any invalid known flag
rejects the entire capabilities response; no partial list, coercion or default.
An item with none of the seven flags returns capabilities: {}.
The nested public capabilities object is reconstructed; provider fields are flat,
so a provider-supplied nested capabilities object is not treated as an alternative.

Success is exactly `{ok:true,count:N,banks:[{bankId,bankName,capabilities:{...}}]}`,
where capabilities contains only those seven own, present, valid flags and count is
computed from the full validated array. Order/case/text are preserved. Exact duplicate
bankId is INVALID_RESPONSE, even with identical names. All unknown fields are dropped.

### Deliberately excluded provider-example fields

- documentosExigidos: only [] is exemplified; element schema/enum/limits are unknown.
- margemMaximaPercentual, valorParcelaMinima, valorLiberadoMinimo,
  valorLiberadoMaximo, valorPrincipalMinimo: financial/percentage semantics, monetary
  units and formal types/nullability are not sufficiently specified; no interpretation.
- product, enabled: outside the approved seven-field whitelist; no extra authorization
  is inferred from them.
- suportaValorSolicitado, suportaPagamentoPix: outside the whitelist; do not substitute
  them for the explicitly chosen suportaLiquido / aceitaChavePixReal capabilities.

Credentials, tokens, tenant/partner, arbitrary metadata/configuration, URLs, headers,
requestPayload, bankRaw, commissions and every other unknown field remain excluded.
Provider text must be displayed as text, not HTML.

### Compatibility and controls

The shared identity validator and bounded transport remain common to all banks
readers (max 1000 banks, 64 KiB, ID/name validation, twenty-second total deadline).
Strict capability validation is opt-in only for the new endpoint: list-banks keeps
exactly `{ok:true,count:N,banks:[{bankId,bankName}]}` and test-connection keeps exactly
`{ok:true,bankCount:N}`, including their previous behavior for ignored extra fields
and duplicates. The basic callers do not start failing on malformed capability extras.
No auth/cache/refresh/retry, test-authentication, diagnose-access or webhook change.

Current session freshness, requirePlatformAdmin, sameOrigin, emptyBody, rejected
queries/inbound Authorization and Cache-Control: no-store follow the approved pattern.
Rate limit uses the existing shared infrastructure with category
opencredit-bank-capabilities, three executions per minute per companyId + userId;
unavailable limiter fails closed. Only OPENCREDIT_API_EMAIL, OPENCREDIT_API_PASSWORD
and OPENCREDIT_TENANT_ID are required; partner configuration remains for diagnose-access.
Errors use sanitized OPENCREDIT_BANK_CAPABILITIES_* codes and only a genuine known,
validated numeric providerStatus may accompany provider HTTP failures.

A bank appearing in the list is NOT permission to simulate or submit. Explicit
simulacaoAtiva/digitacaoAtiva false must be respected; absent flags do not authorize.
Even true is only provider metadata, not QEVORA company authorization or customer
consent. No eligibility or financial decision is made here. No CPF/client/margin,
simulation/selection/reset, bank account, proposal/status/feedback/contact operation
is introduced. No functional records, schema, migration or Railway settings change.
Tests use fake transports only, never live credentials or operational endpoints.
Rollback removes the capabilities route/service and restores the previous parser
layout; no database rollback is needed.

## Administrative proposal status catalogue

`POST /api/admin/integrations/opencredit/proposal-status-catalog` accepts exactly
`{"bankId":"v8"}` as application/json (optional UTF-8 charset). No query,
inbound Authorization, additional or duplicate JSON properties are accepted.
Escaped identifiers are intentionally not accepted. The caller must be a current
platform administrator, same-origin; shared rate limiting is three executions/minute
per companyId + userId, category opencredit-proposal-status-catalog, fail-closed.
All application responses use Cache-Control: no-store.

Only the existing server-only client executes the new functional request:
`GET /api/tenants/{serverTenant}/integration/proposal-status?bankId={encodedBankId}`.
Technical login/refresh and GET retry remain owned by that unchanged client.
No partnerId is sent; OPENCREDIT_PARTNER_ID remains available to diagnose-access.
No CPF, individual proposal, client registration, simulation, selection, reset,
bank account, feedback, contact, or credit operation is introduced.

### Published contract versus local policy

Rechecked the official partner-openapi.json on 2026-10-15:
IntegrationApiController_listProposalStatus declares JWT, required path tenantId,
required query bankId, and HTTP 200/400/401. Description permits omitting bankId,
but this implementation ALWAYS sends it. Response 200 has only schema.example:
data.categories[] has code/terminal/description; data.items[] has bankId/bankName/
statuses[], with status/category/terminal/hasSignUrl. There are no formal response
properties, required, nullable or enums. Description calls the six categories fixed;
the six observed codes EM_ANDAMENTO/PENDENTE/APROVADA/REPROVADA/CANCELADA/ERRO
are NOT implemented as an exhaustive enum.

The following is a **local conservative contract**, not an assertion of provider
required/nullability rules. data.categories and data.items must be arrays. Category
code and each status's status/category are required locally so the result is useful.
Codes accept uppercase ASCII letters, digits and underscores, starting with a letter,
up to 64 characters, including future codes. Status labels are nonblank text up to
160 characters, no controls or HTTP/WWW URLs; display them as text, NEVER HTML.
Category must reference a returned category. Duplicate codes/labels, mismatching
bank IDs, and contradictory terminal values reject the entire result.
terminal and hasSignUrl are optional locally: absent stays absent, true/false are
preserved; present null/string/number/array/object/undefined are INVALID_RESPONSE.
No missing flag is inferred false or permission. Unknown fields, descriptions,
bankName, requestId, raw provider payload, metadata, headers, tokens and URLs are
discarded. This strict local policy may need revision if the provider contract evolves.

The bankId should come from list-banks, but that browser claim is not trusted:
server validates ASCII ID format (1..128, letters/digits/underscore/hyphen, first
alphanumeric), uses only the configured server tenant, and delegates wallet
authorization to the provider. There is deliberately no permanent hardcoded bank
allowlist and no second /banks call or new cache. Unknown/out-of-wallet bank is
documented to return items:[]; public statuses:[] does not authorize operating it.
At most one bank item is accepted and its bankId must exactly match the request.
This endpoint is platform-only; no arbitrary Company can use the shared account.

### Public response, limits and errors

Example: `{ "ok": true, "bankId": "v8", "categories": [{ "code": "APROVADA",
"terminal": true }], "statuses": [{ "status": "Paga", "category": "APROVADA",
"terminal": true, "hasSignUrl": false }] }`.
No match returns the requested bankId, validated categories, and statuses:[].
Missing booleans are omitted. No synthetic default statuses or bank names.

Body: 256 actual bytes, one-second deadline (streaming included). Provider: 32 KiB
declared/actual byte cap, twenty-second total deadline including authentication and
body, max 32 categories, one bank item and 100 statuses. The 32 KiB budget covers
the bounded small catalogue without inheriting the 64 KiB multi-bank reader cap;
oversize fails closed, not truncated. It is a local operational bound, not a published
provider guarantee. Timeouts cancel streams without waiting indefinitely for cancel.

Errors use OPENCREDIT_PROPOSAL_STATUS_CATALOG_CONFIGURATION/AUTHENTICATION/
INVALID_RESPONSE/PROVIDER_UNAVAILABLE/PROVIDER_FAILED/TIMEOUT/NETWORK. Known
provider HTTP failures alone may include numeric providerStatus (100..599).
401/403 map to internal 502 AUTHENTICATION, 429/5xx to 503 PROVIDER_UNAVAILABLE,
other non-2xx to 502 PROVIDER_FAILED. Invalid response 502; local config/network/
timeout 503, without invented providerStatus. No raw message, body, headers or stack.

status category/terminal/hasSignUrl are metadata intended for future polling
interpretation, not current polling, signature navigation or business authorization.
Unknown labels must never be assumed terminal. No polling workflow is activated.
Zero functional writes; only existing RateLimitBucket infrastructure is permitted.
No client auth, refresh/retry/cache, old endpoint, schema, migration or webhook changes.
Tests exclusively use mock transports. Rollback: revert this route/service/test/docs;
no database rollback is needed.

## Status interpretation

`opencredit-status-interpreter.ts` is a pure shared-safe module, without imports,
HTTP, environment access, persistence, credentials or provider client. It is NOT yet
connected to proposal-status-catalog or any other runtime flow.

Production observations supplied for the eight current banks (Paypro, Prospecta
Fintech, V8 Digital, C6 Bank, Facta, Happy, Novosaque and VCTEX) had the same six
categories, while individual status labels vary by bank. QEVORA never uses those
labels or bank IDs for generic interpretation. These are observations, NOT a formal
exhaustive OpenAPI enum.

category alone maps meaning: EM_ANDAMENTO -> IN_PROGRESS, PENDENTE -> ACTION_REQUIRED,
APROVADA -> SUCCESS, REPROVADA -> REJECTED, CANCELADA -> CANCELED, ERRO ->
TECHNICAL_ATTENTION. Future/unknown categories map UNKNOWN, without throwing or
assuming a technical error. No trimming, case conversion or text inference occurs.
The validated terminal boolean is preserved independently; shouldPoll = !terminal.
APROVADA with terminal=false therefore remains SUCCESS with shouldPoll=true;
EM_ANDAMENTO with terminal=true remains IN_PROGRESS with shouldPoll=false.
requiresSignature = (hasSignUrl === true); missing/false never infer a signature,
including for PENDENTE. These flags describe potential future handling only:
the function does not poll, open links or execute an action.

Input is strictly typed with required category:string and terminal:boolean, and
optional hasSignUrl:boolean. It does not revalidate the provider contract. The existing
catalogue parser permits terminal to be absent; future callers must explicitly handle
that absence BEFORE invoking this interpreter, without silently inferring a boolean
from category. No adapter, fallback or endpoint change is introduced in this slice.

SUCCESS is not authorization to grant credit. REJECTED is not a QEVORA decision.
All meanings interpret supplier metadata only: QEVORA calculates no approval,
eligibility, margin, risk or financial decision here. No CPF or personal data is used.

## Client profile local contract

`opencredit-client-profile-contract.ts` uses the public server-only marker but is
otherwise pure: no provider client, HTTP, environment, database, filesystem or
persistence. There is no endpoint, adapter, automatic registration or runtime caller.
This slice creates only a technical DTO builder and sanitized success parser.

Official operation audited: POST /api/tenants/{tenantId}/integration/clients,
IntegrationApiController_createClient, contract 2.8.0 / OpenAPI 3.1.0. The formal
request object requires only cpf. Its nineteen string properties are:
cpf, nome, data_nascimento, celular, nome_mae, email, rg, orgao_emissor, uf_emissor,
data_expedicao, genero, estado_civil, endereco_cep, endereco_rua, endereco_numero,
endereco_complemento, endereco_bairro, endereco_cidade and endereco_uf.

The builder accepts unknown, reconstructs a fresh object, and never changes values.
Optional absence is allowed and omitted. Own undefined, null, non-string, empty or
whitespace-only strings, and C0/C1 controls are rejected: remote clearing/nullification
semantics are unpublished. Whitespace surrounding an otherwise valid generic string
is preserved, not trimmed. Extra keys fail closed, including tenant/partner/company,
Authorization, URL/path/method/headers, __proto__ and constructor. Only plain or
null-prototype objects with own enumerable data properties are accepted; getters,
symbols, hidden properties and inherited input are not a JSON DTO boundary.
Duplicate serialized JSON keys must be rejected by a FUTURE raw request boundary
before JSON.parse loses them; this object-only builder cannot detect already-collapsed
duplicates, and does not accept serialized JSON. No boundary is introduced here.

**LOCAL QEVORA SAFETY LIMIT — NOT PROVIDER CONTRACT:** cpf maximum 32 UTF-16 code
units; every other string maximum 1024. Existing webhook identity checks use a smaller
CPF bound and normalize values; they are deliberately NOT reused here. These generous
local caps prevent absurd per-field input without inventing commercial constraints.
The module does not enforce total request bytes; that belongs to the future service
boundary. The provider publishes no minLength/maxLength/pattern for these fields.

CPF accepts a safe bounded string, masked or not, with no checksum, regex, correction
or normalization. It does not prove CPF validity, ownership or permission. All test
identity values are synthetic; repeated-zero CPF fixtures are deliberately invalid.
data_nascimento uses the textual DD/MM/AAAA rule as a structural NN/NN/NNNN check only:
no calendar/age/timezone validation or ISO conversion. Even a structurally matching
impossible date is not classified here. data_expedicao has only a provider example,
so ANY safe bounded string is accepted; no date format is invented for it.
genero has the formal M/F enum, exact case. estado_civil accepts string 1/2/3/4:
**LOCAL QEVORA ALLOWLIST BASED ON PROVIDER DESCRIPTION, NOT A FORMAL OPENAPI ENUM.**
No numeric coercion. Phone/email/CEP/UF/address fields have no invented regex, DDI,
RFC email rules or UF enum; masks/case/leading zeros remain unchanged and house number
remains a string. This local contract intentionally does not predict provider acceptance.

The provider describes creation for a new CPF and updating sent fields for an existing
CPF. CPF-only is formally permitted. This does NOT establish idempotency, safe retry,
automatic enrichment, absence of side effects or Company isolation. **NO AUTOMATIC
REPLAY.** No request or retry is implemented by this module.

HTTP 201 is documented with only schema.example, not formal response properties,
required or nullability. The parser's LOCAL conservative policy requires own data
object and real boolean data.success/data.created, preserving all four true/false
combinations, including success=false/created=true. It infers nothing. Only a fresh
{success,created} is returned. Unknown response fields are ignored without reading
their values: no requestId, CPF, client, creditProfile, barriers, metadata, message,
error, headers, token, URL or raw provider object escapes through this contract.
Invalid input and invalid success payload raise separate fixed local contract errors;
no submitted values, raw error/cause, HTTP status or provider error mapping is retained.

This module does NOT authorize a Company or CPF. Before any real call, blockers remain:
authorized Company, Contact belonging to that Company, CPF resolved from that Contact,
commercial OpenCredit enablement separate from webhook modes, remote identity/CPF
ownership policy for the shared account, and applicable consent/operational authorization.
The provider contract does not specify a complete consent model. None of these bindings
or consent mechanisms is implemented here. No schema/migration/Railway change.

## Commercial authorization and remote identity policy

`opencredit-commercial-identity-policy.ts` is server-only and pure. Its only runtime
import is the public server-only marker. No network, provider client, env, DB, logger,
filesystem, persistence, mapping registry or caller integration is introduced.

Webhook ACTIVE/PAUSED/DISABLED controls inbound receiving, NOT commercial outbound.
The policy's CommercialAccess and RemoteIdentity are separate typed read-only
snapshots, distinct from the persistence foundation described below. They carry no role, credential, token, partnerId, tenantId,
raw Contact/User or consent flag. Session/RBAC authorization belongs to a future
service; it is not decided by this policy.

OpenCreditProviderScope is nominally typed and represents the logical namespace in
which equal CPFs can reach the same remote profile. LOCAL syntax: 1..64 ASCII
characters, lowercase letter first, lowercase letters/digits with single internal
hyphens; no outer whitespace, dots, slash/backslash, URL or email. An eleven-digit
run is also rejected so a CPF cannot be embedded as a scope identifier. No trimming
or case conversion occurs. Syntax cannot prove that an arbitrary string is not a
secret or that a namespace is authorized: the future service must supply only a
trusted server-resolved logical scope, never a browser choice or credential-derived
fingerprint. Rotating a key does not define a new namespace. Operational onboarding
confirmation and the trusted resolver are documented below; no global partnerId
uniqueness, tenant/account equivalence or dynamic scope allowlist is invented here.

Ownership CPF accepts EXACTLY eleven ASCII digits or the conventional
NNN.NNN.NNN-NN mask. Only after format validation are the known dots/hyphen removed.
Partial masks, whitespace, controls, prefixes/suffixes, +55, letters and garbage
containing eleven digits fail. The module intentionally does not import contacts.ts:
normalizeContactCpf alone removes all non-digits and is insufficient as a validator.
**CANONICAL CPF IS AN IDENTITY KEY, NOT VALIDATION OF OWNERSHIP OR VALIDITY.**
There is no checksum; fixtures are fictitious mathematically invalid repeated digits.
Within the pure policy this key exists only in memory. The separate client-profile DTO builder continues
preserving the technical value without this normalization. The pure policy makes no
storage decision; the initial storage choice is documented in the foundation below.

evaluateOpenCreditIdentityUse receives caller-resolved company/contact IDs, CPF,
archival state, matchingContactCount, trusted scope, commercial access and explicit
existing identity (snapshot or null). Caller IDs have a LOCAL safe ASCII 1..128 bound,
first alphanumeric then letters/digits/underscore/hyphen. matchingContactCount must be
a safe integer in 0..1,000,000 (LOCAL bound); only exactly 1 proceeds. A future lookup
may supply a saturated count of 2 once ambiguity is known, but must actually check
canonical-equivalent legacy contacts, not merely assume the chosen Contact is unique.

Decision order is deterministic:

1. Reject malformed root, invalid provider scope or invalid caller IDs.
2. Require commercial access, a real enabled boolean, enabled=true, matching scope
   AND matching Company. Another Company's enabled record never grants permission.
3. Require a real archival boolean and a non-archived Contact.
4. Require CPF, canonicalize using the strict identity formats, then validate count
   and require exactly one matching Contact. Null/undefined/empty CPF is missing;
   whitespace and other nonempty malformed values are invalid.
5. Only explicit existingIdentity:null produces CLAIM. Omitted/undefined/unresolved
   identity facts are INVALID_FACTS, never an invitation to claim.
6. For an existing snapshot, require matching scope, Company, Contact and canonical
   CPF, then a real enabled boolean with enabled=true; only then REUSE. Snapshot CPF
   must already be canonical, not normalized or repaired by this function.

Allowed output is only {allowed:true,action:CLAIM|REUSE,normalizedCpf,providerScope}.
Denials contain only {allowed:false,reason}, never identifiers, CPF or the other
Company. Fixed reasons distinguish missing/disabled access, commercial scope/Company
mismatch, archived/missing-CPF/invalid-CPF/ambiguous Contact, identity scope/Company/
Contact/CPF mismatch, disabled identity, invalid scope and malformed facts. Normal
denials do not throw. Standalone scope/CPF helpers throw fixed local parsing errors
without input/cause; unexpected caller errors become INVALID_FACTS.

An exact disabled identity remains IDENTITY_DISABLED, not CLAIM. A changed CPF is
IDENTITY_CPF_MISMATCH, never silent reassignment, freeing of the old key or creation
of a replacement. Existing mismatches take precedence over the identity enabled flag.
Input and snapshots are never mutated; each decision is a fresh deterministic object.

CLAIM is only a candidate recommendation from facts, NOT an atomic reservation.
REUSE is not remote authentication or permission to make a financial request.
The pure policy itself performs no persistence or atomic reservation and implements
no DB constraints. The persistence foundation below now supplies
unique(providerScope,normalizedCpf) and the other uniqueness/FK constraints.
The internal transactional claim/re-read service is documented below. Freshness at
future operation dispatch, revocation/dispatch races and operation replay/idempotency
remain future responsibilities.

CommercialAccess != consent; RemoteIdentity != consent; receiving a lead != universal
consent. Applicable operation authorization/evidence remains a separate boundary.
No actual commercial operation, endpoint, provider call, polling, UI or Railway
configuration is introduced by the policy. This slice does contain schema/migration
changes, exclusively in the persistence foundation documented below. Future execution
must resolve all remaining gates before using the DTO.

## Commercial identity persistence foundation

Versioned models OpenCreditCommercialAccess and OpenCreditRemoteIdentity now provide
storage foundations only. The transactional access service documented below now uses
CommercialAccess; the identity service below now uses RemoteIdentity. Neither has
a runtime caller. No endpoint, UI, runtime mapper, dispatch service, scope provisioning
or OpenCredit call is added.
The pure identity policy and existing webhook remain functionally unchanged.

Both SQLite/PostgreSQL schemas declare equivalent models, inverse relations, uniques
and actions. SQLite cannot name foreign keys in Prisma, so both follow the existing
unnamed @relation convention; PostgreSQL migration uses Prisma's fixed FK names.
The existing SQLite-only User.email index map remains untouched. No native enum,
manual CHECK, trigger, immutable-column mechanism or normalization is introduced:
format and future identity immutability enforcement belong to the policy/service.

CommercialAccess has one row per (companyId,providerScope), defaults enabled=false
and records changedByUserId. RemoteIdentity defaults enabled=false and records
companyId, contactId, providerScope, normalizedCpf and createdByUserId. providerScope
is required with NO default; no real scope is created. Timestamps are recorded but
changedBy/createdBy alone are not a complete historical grant/revocation audit trail.

Unconditional unique(providerScope,normalizedCpf) prevents two Companies claiming
the same identity namespace, including disabled rows. Unique(companyId,providerScope,
contactId) prevents rebinding one Contact with a different CPF in that scope.
Both differ from Contact's existing nonunique CPF index; no Contact data is changed.
The composite Contact FK uses (companyId,contactId). The composite CommercialAccess
FK uses (companyId,providerScope): another Company's access row cannot satisfy it.
User actor FKs intentionally reference only User.id; a platform actor from another
Company is valid structurally, NOT evidence of authorization. Future administrative
services still require platform authorization. Every new FK uses ON DELETE RESTRICT
and ON UPDATE NO ACTION; no cascade erases ownership when a parent is deleted.

normalizedCpf is a plaintext local eleven-digit snapshot AND personal data.
Plaintext is NOT cryptographic protection. This deliberate initial choice supports
deterministic equality/unique constraints while preserving identity when Contact.cpf
changes. Existing secret encryption uses AES-GCM with random IVs; it is NOT reused
as a CPF fingerprint. No HMAC, hash derivation, new key/env or encryption mechanism
is introduced. Additional protection can still be evaluated BEFORE real bindings
are created. Never log the value, put it in errors/public URLs/idempotency keys or
dynamic constraint names, or copy it to unrelated tables.

Migration 20261016190000_add_opencredit_commercial_identity creates only the two
tables and their indexes/uniques/FKs. No INSERT, UPDATE, seed, backfill, default scope
or modification of existing Contact/webhook/lead/event records. New tables start
empty. This versioned migration is NOT permission to run it manually in production.

The dedicated material PostgreSQL test is invoked by the existing PostgreSQL CI job.
Before client construction its gate requires CI=true, GITHUB_ACTIONS=true and
OPENCREDIT_COMMERCIAL_IDENTITY_POSTGRES_TEST=1, PostgreSQL loopback only, database
qevora_ci, fictitious qevora_ci/qevora_ci_password credentials and only schema=public.
Ports allowed are 5432 (CI) or 55432 (dedicated local disposable container).
Local reproduction explicitly sets these gates; this is not a claim of a GitHub run.
Tests never touch production. Each invocation creates random Company IDs and cleans
only its own rows in reverse FK order; no global TRUNCATE/delete or raw Prisma logs.
Only mathematically invalid synthetic repeated-digit CPFs are used.

Material tests inspect pg_catalog/information_schema definitions, types/defaults/PKs,
uniques and six FKs; they exercise cross-company CPF collisions, independent scopes,
Contact/access composite references, platform actors, RESTRICT, rollback and snapshot
preservation. The concurrency test starts two real transactions behind a barrier:
one insert commits, one loses specifically on the scope+CPF unique. P2002/P2003 must
match expected model/target/constraint; Prisma 5's native RESTRICT UnknownRequestError
is accepted only for the expected static FK and a PostgreSQL constraint violation.
Unexpected failures are sanitized before reaching node:test.

No real identity or operational integration was created by development/tests.
The current integration's namespace is operationally confirmed as documented below;
this is not a formal OpenAPI guarantee.
Consent/evidence remains separate. Storage constraints do not authorize any operation,
provide operation idempotency or solve revocation/dispatch races. The internal claim
service below is reservation-only; no dispatch service exists. Rollback before real
data: revert this code and use an approved
database rollback plan for the two empty tables; never automatically drop ownership
tables once real bindings exist.

## Commercial access audit foundation

OpenCreditCommercialAccessEvent provides durable history of administrative
CommercialAccess transitions. It is not a webhook log, remote identity event or
consent/evidence of authorization. It contains no CPF, provider payload, free-text
message, credential or token. The foundation itself introduced no functional writer;
the separate transactional service below now provides the first legitimate event
insert writer. No endpoint, UI, server action, OpenCredit call, real access grant
or real scope is introduced.

Actions are GRANTED and REVOKED. action remains String; neither a native enum
nor a manual CHECK enforces it. The service below validates action/state coherence:
GRANTED null -> true represents an absent access before its first grant;
GRANTED false -> true grants an existing access; REVOKED true -> false revokes it.
previousEnabled is deliberately nullable; nextEnabled records the resulting state.
No-op requests must not create transition events. State changes and event
inserts must commit in the same transaction; the separate service below implements
that local atomicity without exposing a caller.

The parent unique(id,companyId,providerScope), OCCommercial_id_company_scope_key,
is deliberately redundant with the existing id PK: it supports the strong composite
Event(commercialAccessId,companyId,providerScope) -> Access(id,companyId,providerScope)
FK, preventing a history row from mixing another access, Company or scope.
There is no redundant direct Event -> Company relation. actorUserId references only
User.id, so a Platform Admin belonging to a different Company is structurally valid.
That FK proves existence, NOT permission. The inverse relations are Access.events
and User.openCreditCommercialAccessEvents. Both new FKs use ON DELETE RESTRICT and
ON UPDATE NO ACTION; history prevents physical deletion of referenced access/actor.
FK names follow Prisma's generated PostgreSQL names, including its length truncation,
so SQLite/PostgreSQL can keep the same logical model without SQLite FK name maps.
Indexes cover (commercialAccessId,createdAt,id) and actorUserId; no speculative index
or ordering guarantee based only on timestamps is added.

**APPLICATION APPEND-ONLY CONTRACT, NOT PostgreSQL ACL ENFORCEMENT.**
Events have no updatedAt. Production must not update, delete or upsert history;
transactional services insert events. The static TypeScript test rejects those mutators,
computed literal access and obvious delegate/method extraction aliases; direct
create remains allowed. This is a conservative syntactic guard, not proof against
arbitrary dynamic code, raw SQL or a privileged database user.
RESTRICT preserves parent links, not event immutability. PostgreSQL owner/superuser
can still alter/delete history with database privileges. This slice is not tamper-proof
and introduces no role, role separation, GRANT/REVOKE, trigger or DATABASE_URL change.
ACL auditing is deliberately deferred: the current CI role is superuser and cannot
prove production runtime privilege enforcement. SQLite has equivalent logical
structure but supplies no PostgreSQL privilege guarantee either.

Migration 20261016200000_add_opencredit_commercial_access_audit only adds the parent
unique, event table, indexes and FKs. No backfill, seed or existing-data DML.
The material test requires CI=true, GITHUB_ACTIONS=true,
OPENCREDIT_COMMERCIAL_ACCESS_AUDIT_POSTGRES_TEST=1 and the same strict disposable
loopback database/user/schema/ports as the identity foundation tests. It inspects real
columns/defaults/indexes/FKs and exercises cross-company/scope rejection, a platform
actor, RESTRICT, NO ACTION and rollback using synthetic fixtures without CPF.
Fixtures may remain only in that disposable database until it is destroyed;
there is no event deletion API or cleanup bypass. CI invokes both new tests.
No local result should be described as a completed GitHub run.

Rollback before operational use: revert this slice with a separately approved
database plan for the empty event table and redundant parent key. Once real history
exists, do not automatically drop/delete it. State-plus-event atomicity is implemented
by the service below; claim/reuse, freshness, revocation/dispatch coordination and
commercial operation evidence remain absent.

## Commercial access transactional service

grantOpenCreditCommercialAccess(db,input) and revokeOpenCreditCommercialAccess(db,input)
are internal server-only functions with an explicitly supplied transaction-capable
database client. No default DB, endpoint, UI, route, server action or runtime caller
is added. The service uses the existing isPlatformAdmin rule, not Company ADMIN status.
Company Admin cannot self-grant/revoke; Supervisor and Agent cannot mutate access.
An authenticated SessionUser is required from the future trusted server caller.
This service does not authenticate an arbitrary object supplied by a browser.

Every transaction rereads the actor by id, selecting only id/companyId/name/email/role.
The id, Company, role and normalized email must still agree with the session;
isPlatformAdmin is evaluated again on current database facts. Missing/stale actors
fail closed with NOT_AUTHORIZED. Company is reread inside the same transaction;
missing targets produce COMPANY_NOT_FOUND before any Access mutation.

providerScope is a branded input AND is revalidated with the existing strict parser.
Syntax is not trust: the future caller must use a trusted server-side resolver,
never browser scope or email/password/token-derived namespaces. The resolver below
implements that primitive using operationally confirmed tenantId + partnerId, but
now has only the human authorization admin consumer documented above. This access
service itself remains passive. No real access/scope is configured or granted by development.

Grant absent creates enabled=true plus GRANTED null -> true. Grant disabled updates
enabled/changedByUserId plus GRANTED false -> true. Revoke enabled updates those
fields plus REVOKED true -> false. The service, not the caller, derives the action,
previous/next state and actor. Extra top-level input fields are rejected.
Grant enabled and revoke disabled are no-ops: no state update, timestamp touch,
changedBy change or event. Revoke absent returns changed=false, enabled=false and
accessId=null without creating a disabled row. changedBy represents the last real
transition, not the last idempotent request. Results contain only changed/enabled/accessId.

Access mutation and Event INSERT share one short Serializable transaction; Event
history is never updated/deleted/upserted. A failure rolls back both. Only P2034
or P2002 matching Access(companyId,providerScope)/OCCommercial_company_scope_key
retries the entire local transaction, at most three attempts total; actor/Company/access
are reread each time. Unknown unique targets do not retry. Exhaustion maps to
CONCURRENT_CONFLICT; unexpected storage failures map to STORAGE_ERROR without raw
Prisma exceptions, identifiers, SQL, scope, actor details or cause. There is no sleep,
HTTP, OpenCredit request or external retry. Transaction limits are maxWait=2000ms
and timeout=5000ms per attempt. Concurrent grant/revoke outcomes follow a valid
serialization, not wall-clock request ordering.

The dedicated disposable PostgreSQL test requires CI=true, GITHUB_ACTIONS=true,
OPENCREDIT_COMMERCIAL_ACCESS_SERVICE_POSTGRES_TEST=1 and the established strict
loopback/database/user/schema/port gates. Tests use only synthetic Companies, actors
and synthetic-* scopes; no Contact or remote identity is used. Real concurrent
transactions test first grants, disabled grants, revokes and a grant/revoke race.
A test-only TransactionClient proxy causes a real final Event FK failure after
observing the Access transition, proving rollback for both creation and update.
There is no production failpoint, cleanup bypass, event deletion or new env setting
for production. Synthetic fixtures remain only until the disposable database is destroyed.

CommercialAccess is NOT consent and does NOT authorize proposal/simulation/client POST.
It is only local administrative permission to let a Company enter a future commercial
flow. The access service adds no identity/operation writer, dispatch or credit call;
the later foundations/services below remain local only. Serializable local state
does not solve future HTTP revocation races.
The application append-only limitation remains: owner/superuser can modify history
with database privileges; no ACL, trigger or role separation was added.
Rollback: revert the service/CI/documentation commit; this slice has no schema,
migration, backfill or operational data to undo. Existing audit tables are preserved.

## Remote identity audit foundation

OpenCreditRemoteIdentityEvent introduces persistent history before any functional
identity writer. The internal transactional service documented below now implements
claim/enable/disable. There is still no endpoint, route, server action, UI, runtime
caller, provider call or consent mechanism for remote identity. The later operation
ledger below supplies storage only, with no writer. No real identity, access grant
or operational scope is created.

Future transition shapes are CLAIMED null -> false, ENABLED false -> true and
DISABLED true -> false. action remains String, with no native enum or manual CHECK.
previousEnabled is deliberately nullable; nextEnabled is required. The service below
derives action/state coherence and commits parent state plus event atomically.
The database foundation only stores facts: tests of those shapes prove storage,
not authorization or semantic enforcement by the database.

Event fields are exactly id, remoteIdentityId, companyId, providerScope, actorUserId,
action, previousEnabled, nextEnabled and createdAt. No updatedAt, normalizedCpf,
customer name/phone/email, provider payload, request/response, credential, token,
free-text or arbitrary metadata is copied into history.

The new unique(id,companyId,providerScope), OCRemoteIdentity_id_company_scope_key,
is deliberately redundant with RemoteIdentity.id's PK to support the strong composite
Event(remoteIdentityId,companyId,providerScope) -> RemoteIdentity(id,companyId,providerScope)
FK. An event cannot combine another identity, Company or scope. No redundant direct
Event -> Company relation is added. actorUserId references User.id only: a Platform
Admin of another Company is structurally valid, not thereby authorized.
Inverse relations are RemoteIdentity.events and User.openCreditRemoteIdentityEvents.
Both new FKs use ON DELETE RESTRICT and ON UPDATE NO ACTION; names follow Prisma's
generated PostgreSQL convention, including length truncation. Indexes cover
(remoteIdentityId,createdAt,id) and actorUserId. Timestamp alone is not a global
ordering guarantee.

**APPLICATION APPEND-ONLY, NOT DATABASE IMMUTABILITY.** The conservative TypeScript
guard rejects update/updateMany/delete/deleteMany/upsert and obvious delegate/method
escapes, computed literal access and aliases. Its reusable syntactic rule allows
direct create/read calls; the production scan permits Event.create only in
opencredit-remote-identity.service.ts and requires exactly that writer. Other
services, endpoints, UI and scripts remain forbidden writers. Mutators and delegate
escapes remain rejected globally, including in the authorized service.
This is not complete flow/taint analysis and does not protect against arbitrary
dynamic code or raw SQL. PostgreSQL owner/superuser can still directly alter/delete
data with database privileges. RESTRICT preserves parent references, not
cryptographic or administrative immutability. No ACL, trigger, role, GRANT/REVOKE
or separate DATABASE_URL is introduced.

Disabled RemoteIdentity continues reserving ownership. No automatic expiry, release
on disable, reassignment or change to normalizedCpf/default enabled is introduced.
Existing unique(providerScope,normalizedCpf) and
unique(companyId,providerScope,contactId) remain unchanged, as do Contact,
CommercialAccess, webhook and providerScope semantics.

Migration 20261016220000_add_opencredit_remote_identity_audit is structural only:
the redundant parent unique, Event table, indexes and two FKs. No DML, backfill,
seed, real scope or real identity. Both schemas retain equivalent logical models.
CI adds the unit/contract and material tests without replacing existing gates.
The dedicated material guard must pass before PrismaClient construction:
CI=true, GITHUB_ACTIONS=true, OPENCREDIT_REMOTE_IDENTITY_AUDIT_POSTGRES_TEST=1,
postgresql loopback only, qevora_ci database/user, fictitious CI password,
schema=public and ports 5432/55432. Only synthetic-* scopes/Companies/actors/Contacts
are used; the required parent snapshot uses an invalid repeated-digit synthetic CPF,
never logged or included in Event.

Material tests inspect migration completion, exact columns/defaults/PKs/unique/indexes
and both actual FK definitions; they exercise Company/scope mismatches, a platform
actor, missing actor, three stored action/state shapes, RESTRICT, NO ACTION and
rollback. The NO ACTION test supplies a valid access for the replacement scope so
the rejection is specifically the Event FK, not the older access FK.
Fixtures may remain only in the disposable database until container destruction;
there is no event cleanup API, deletion bypass or global table truncation.
Local validation is not a completed GitHub run.

Rollback before operational use requires reverting this slice and a separately
approved database plan for its empty Event table/redundant parent key. Once real
history exists, do not automatically erase it. The namespace confirmation and
trusted resolver are documented below; operation
authorization/evidence, final freshness and revocation/dispatch gates remain
separate blockers before commercial execution.

## Remote identity transactional service

claimOpenCreditRemoteIdentity(db,input), enableOpenCreditRemoteIdentity(db,input)
and disableOpenCreditRemoteIdentity(db,input) are internal server-only APIs with
an explicitly supplied transaction-capable client. This slice adds no schema or
migration. No endpoint, UI, server action, runtime caller or real scope/identity is
introduced. Rollback of this slice is a code revert; do not erase existing history.

All three operations are temporarily and conservatively Platform Admin-only via
isPlatformAdmin. Company ADMIN, SUPERVISOR and AGENT cannot perform them. Each
transaction rereads the actor and compares id, companyId, role and normalized email
with the authenticated SessionUser, then rechecks the current Platform Admin rule.
Missing/stale actors fail closed. A future caller must authenticate that session;
an arbitrary browser-supplied object is not an authentication boundary.

Input accepts only actor/companyId/contactId/providerScope. IDs use the existing
strict syntax and the branded scope is reparsed at runtime. Syntax is not trust:
the future caller must obtain scope exclusively from a trusted server-side resolver,
not browser input or raw tenantId/partnerId, email, password or token. The resolver
below derives the namespace from trusted server IDs only. Its sole runtime consumer
is now the human authorization admin boundary, not this remote-identity service.
Output contains only changed/enabled/identityId. Errors contain
closed codes, never CPF, identifiers, conflicting owners, raw Prisma metadata or cause.

CLAIM is a local ownership reservation, NOT consent or remote registration. New
claims always start disabled with CLAIMED null -> false. A disabled identity keeps
both ownership reservations indefinitely; disabling never releases, deletes,
expires, reassigns or changes the CPF snapshot or binding. Repeated claims of the
same exact binding preserve enabled state, creator and timestamps without a new
event. The two lookups are providerScope+normalizedCpf and
companyId+providerScope+contactId; both are reconciled. Different owners produce a
sanitized OWNERSHIP_CONFLICT; a changed Contact snapshot produces
IDENTITY_SNAPSHOT_MISMATCH; contradictory bindings produce IDENTITY_CONFLICT.

CLAIM and ENABLE reread Company and the exact tenant-scoped Contact, reject archived
Contacts and missing/invalid CPF, and reuse canonicalizeOpenCreditOwnershipCpf.
Only already-canonical digits and their conventional formatted representation are
queried with companyId, findMany and take:2. Archived duplicate Contacts count;
exactly one match must be the target Contact. No permissive legacy normalization.
Both operations require an existing enabled CommercialAccess. ENABLE additionally
requires the same identity from both unique lookups and a fresh matching CPF
snapshot; it records ENABLED false -> true. Already enabled is a true no-op.

DISABLE validates the current actor and Company, then uses only the scoped identity
binding. It remains possible with revoked CommercialAccess, an archived Contact,
changed/missing/invalid CPF or later ambiguity. Enabled -> disabled records DISABLED
true -> false. Missing or already-disabled identity is a no-op, with no event or
timestamp update. Absence returns identityId:null. Ownership fields and creator
are never updated by any transition.

State and exactly one derived Event.create share a short Serializable transaction
(maxWait=2000ms, timeout=5000ms). P2034 retries the entire transaction, at most three
attempts total, rereading authorization and all applicable facts. Only CLAIM retries
P2002 for OCRemote_scope_cpf_key or OCRemote_company_scope_contact_key (equivalent
Prisma field metadata accepted). Other PK/model/unknown unique failures do not retry.
Re-read ownership conflicts retain their semantic code; retry exhaustion produces
CONCURRENT_CONFLICT and unexpected storage failures STORAGE_ERROR. No HTTP, fetch,
sleep, crypto/provider request or network retry occurs inside these transactions.
No-op transitions write neither state nor event. Application append-only is not
database immutability: owner/superuser privileges can still alter history.

Unit/contract tests check authorization, stale actors, closed inputs, strict syntax,
reconciliation, retries, no-ops, sanitized errors and the no-caller boundary. The
dedicated material guard requires CI=true, GITHUB_ACTIONS=true,
OPENCREDIT_REMOTE_IDENTITY_SERVICE_POSTGRES_TEST=1 and only the established disposable
loopback PostgreSQL qevora_ci configuration. It runs before client construction.
Tests use synthetic fixtures and invalid repeated-digit synthetic CPFs, never logs
or events containing CPF. PostgreSQL tests prove state/event coherence, same-owner
and cross-company claim races, enable/disable races and valid serial histories.
A test-only transaction proxy injects a missing Event actor to trigger a real FK
failure after observing the state change, proving rollback for CLAIM, ENABLE and
DISABLE. No production failpoint, audit deletion or cleanup bypass exists.
CI preserves existing gates and adds the service unit and material tests.

This is NOT a complete operational boundary. Future authorization/evidence is still
a blocker before any runtime commercial claim. No consent=true or legal consent
is invented. An enabled RemoteIdentity alone does NOT authorize client POST,
simulation, proposal or any financial operation. Every future operation still needs
final freshness checks, operation idempotency and revocation/dispatch coordination.
No OpenCredit request, real identity/scope, webhook change, polling, Railway or
production configuration is introduced.

## Contact -> client profile adapter

buildOpenCreditClientProfileFromContact(input) is a pure synchronous server-only
adapter over caller-resolved snapshots, not an operational authorization boundary.
"mappable" != "authorized to dispatch". The input is closed at all three levels:
root contact/identity, seven Contact fields (id, companyId, name, phone, email, cpf,
archivedAt) and five identity fields (companyId, contactId, providerScope,
normalizedCpf, enabled). Only plain/null-prototype own enumerable data properties
are accepted. Unknown/symbol/nonenumerable keys, accessors and inherited snapshots
fail closed; getters are not invoked. Hostile object exceptions are sanitized,
although JavaScript cannot generally inspect a Proxy without triggering its traps.

It checks strict IDs, matching Company/Contact, runtime scope syntax, enabled=true
and non-archived Contact. Missing/malformed CPF fails; Contact CPF is canonicalized
only with canonicalizeOpenCreditOwnershipCpf and compared with the identity's
already-canonical exact eleven-digit snapshot. No repair, inference or ownership
mutation. The DTO uses the reserved identity.normalizedCpf, not the original Contact
string. Identity enablement here proves local coherence, NOT consent or permission
to execute client POST, validation, simulation, proposal or any financial operation.

### Explicit optional phone policy for controlled createClient

The published createClient request requires only `cpf`; `celular` is optional.
The known provider description is DDD followed by the number, with a national
eleven-digit example. Acceptance of a leading country code is not established.
This change does not normalize phones or infer a missing ninth digit/DDD.

`OpenCreditCreateClientPhonePolicy` is exactly `"include" | "omit"`. Existing
callers and requests without the option retain `include`. Only an explicit `omit`
excludes the own `celular` property from both the DTO and serialized JSON; no
`undefined`, `null` or empty-string replacement is sent. Contact.phone is neither
modified nor persisted differently. An empty phone still has its previous default
rejection; deliberate OMIT can exclude it. Invalid options fail closed, never
fall back to omission.

The official human dispatch boundary accepts an optional `phonePolicy` in its
otherwise closed `{companyId, contactId, commandId}` JSON. It propagates the same
policy through preparation, dispatcher and transactional reservation into the
adapter. Authenticated session, Platform Admin, same-origin, rate limits, trusted
scope, current authorization binding, single intent and one-shot transport stay
unchanged. No new endpoint or provider client is introduced.

The human UI defaults to INCLUDE, presents an explicit selector and policy preview,
and clears both visible confirmations when the policy changes. The preview states that the
Contact phone remains preserved. Changing policy does not create another intent,
unlock a terminal operation or authorize replay. After uncertainty, do not resend.
The policy is chosen for each explicit command; it is not an immutable PREPARED
snapshot and is not reconstructed from historical operations. Resuming PREPARED
requires reviewing the policy again (the UI defaults to INCLUDE after remount).

Auditability here is the explicit administrative request and its pre-dispatch UI
preview, not a new durable policy field. Existing operations store neither profile
nor phone snapshots; diagnostic/schema/migrations remain unchanged. Historical
UNKNOWN stays unchanged. Tests use synthetic fixtures and fake HTTP; the material
gate uses only disposable local PostgreSQL. No real provider execution is part of
implementing or testing this option. Rollback is reverting this patch; no data
backfill or database rollback is needed.

By default only identity.normalizedCpf -> cpf, Contact.name -> nome, Contact.phone -> celular
and non-null Contact.email -> email are passed to buildOpenCreditClientProfilePayload.
Null email is omitted; strings are preserved exactly. There is no trim, lowercasing,
phone formatting, +55 insertion, DDD inference or independent email validator.
The existing builder remains responsible for its technical DTO rules; rejection
becomes PROFILE_INVALID without the original exception, data or cause. All adapter
errors are fresh closed-code messages without identifiers or PII. Input is not
mutated and each successful call returns a fresh OpenCreditClientProfilePayload
without a wrapper.

The other fifteen fields are deliberately absent: data_nascimento, nome_mae, rg,
orgao_emissor, uf_emissor, data_expedicao, genero, estado_civil, endereco_cep,
endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade
and endereco_uf. No enrichment from MulticredClient, proposals, conversations,
webhooks, another Contact or AI. The pure builder/identity policy semantics remain
unchanged. No database, environment lookup, provider client, HTTP implementation,
endpoint, UI, runtime caller, consent, schema, migration or dependency is introduced.
CI adds only the focused adapter unit gate, preserving existing gates.

Before any real client POST a future trusted operational boundary must reread,
near dispatch: actor/session, Company, enabled CommercialAccess and RemoteIdentity,
trusted server-resolved providerScope, unarchived Contact, current CPF equality,
absence of ambiguity, applicable authorization/evidence and operation state,
idempotency/reconciliation. This adapter substitutes none of those checks. The
builder receives an object, not raw JSON; a future boundary accepting external JSON
must reject duplicate JSON keys BEFORE conversion. Keys collapsed by JSON.parse
cannot be recovered here. Rollback is a code revert, with no data migration.

### Validate operation audit — 2026-10-16

Sources: [official partner OpenAPI](https://core.api.opencredit.tech/api/partner-openapi.json)
and [official documentation](https://core.api.opencredit.tech/api/partner-docs).
The documentation HTML references the partner OpenAPI. The inspected document is
OpenAPI 3.1.0, API version 2.8.0. Only public documentation was fetched; no business
endpoint, login or client data request was executed.

The route and method ARE proven: operationId IntegrationApiController_validateClient,
GET /api/tenants/{tenantId}/integration/clients/validate, JWT security. It is NOT a
published POST operation. No requestBody is declared; therefore there are no body
properties, required array or body enums to implement. Published parameters:

| Parameter | Location | Formal schema | Formal required |
| --- | --- | --- | --- |
| tenantId | path | string (documented operation default) | true |
| cpf | query | string | true |
| stage | query | string, no enum | true |
| simulationId | query | string | true |
| bankId | query | string | true |
| product | query | string, no enum | true |

No partnerId or idempotency header is declared. CPF is sent in the query; bankId is
also declared there. No tenant default is hardcoded into the adapter.

**Published inconsistency:** descriptions say stage=simulate needs no bank;
stage=propose needs simulationId (preferred) OR bankId; omitting stage checks all
stages and permits omitting bank context. Yet the formal parameter list marks stage,
simulationId AND bankId required=true. Product is described as clt, but no formal
enum exists; likewise simulate/propose are descriptions, not a formal stage enum.
Do not silently resolve this contradiction or implement requests from an inferred
conditional contract. Provider clarification is required before a validate boundary.

Published responses are 200, 400 and 401. The 200 application/json schema contains
only example, with no formal type/properties/required definitions. Its example shows
data.found, data.valid, data.evaluatedFor (bankId/source), data.pending and requestId.
Pending items show field/label/regex/scope and resolveWith(method/path/optional field);
the illustration includes client bank-account and bank employer-contact pendencies.
The description permits evaluatedFor.bankId=null without bank context. These are
examples/descriptions, NOT guaranteed field types, nullability or enums. Error
illustrations show VALIDATION_ERROR (400) and UNAUTHORIZED (401), not a formal error
response schema. No local validate response parser is added.

The operation is described as checking stage-specific missing data and is published
as GET (read intent). No mutation or banking action is described, but that is not
proof of provider implementation having zero side effects. No idempotency-key
contract or operation-specific retry guidance is published. Do not infer replay
safety for financial operations. No validate HTTP code, POST client code or provider
request is implemented. The endpoint identity is proven; a complete unambiguous
request/response runtime contract is NOT PROVEN.

## Commercial operation durable ledger foundation

OpenCreditCommercialOperation and OpenCreditCommercialOperationEvent supply durable
local structure BEFORE any non-idempotent provider request. The initial foundation
introduced no writer. The transactional service documented below now supplies local
preparation, reservation and UNKNOWN transitions only. There is still no dispatch
service, endpoint, UI, runtime caller, provider request, real operation/identity/scope,
consent/evidence mechanism or external reconciliation. This foundation does NOT authorize financial activity.
The Contact adapter and client-profile contract remain pure and unchanged.

Operation fields are exactly id, companyId, remoteIdentityId, providerScope,
operationKind, intentKey, state, revision, createdByUserId, createdAt and updatedAt.
Event fields are exactly id, operationId, companyId, providerScope, actorUserId,
action, previousState (nullable), nextState, revision and createdAt. Event has no
updatedAt. Neither ledger copies CPF, normalizedCpf, name, phone, email, payload,
request/response body, provider raw data, credentials, tokens, notes, stack, error
message or arbitrary URL. Do not create CPF/payload/request hashes: low-entropy CPF
is enumerable under a simple hash. No new encryption/HMAC key or env is introduced.

Operation explicitly references Company.id and createdBy User.id. Its strong
(remoteIdentityId,companyId,providerScope) FK references the existing
RemoteIdentity(id,companyId,providerScope) unique. Events reference
Operation(id,companyId,providerScope) through (operationId,companyId,providerScope),
and actor User.id. Every new FK uses RESTRICT / NO ACTION. Platform actors may
structurally belong to a different Company; the service must authorize them.
Only the necessary Company/User/RemoteIdentity inverse relations are added; existing
ownership uniqueness, reservation and disable semantics are unchanged.

Unique(companyId,providerScope,intentKey), OCOperation_company_scope_intent_key,
identifies one LOCAL QEVORA intention, not provider idempotency. The redundant
unique(id,companyId,providerScope), OCOperation_id_company_scope_key, supports the
Event composite FK. Indexes cover identity/createdAt/id, Company/scope/state/createdAt/id,
Operation creator, Event operation/createdAt/id and Event actor. createdAt plus id
supports stable listing, not proof of a global temporal order.

The initial foundation had no intent-key syntax validator. The service below now
requires a canonical lowercase UUID v4, stable across retries of the SAME intention, scoped by
Company and providerScope, never derived from CPF/name/phone/email, Contact id,
payload hash, token or credentials. The currently audited create-client contract
publishes no provider idempotency-key support. Do not send Idempotency-Key, intentKey
or operationId to the provider without a future formal contract.

operationKind remains String. The only implemented local kind is CLIENT_PROFILE_UPSERT,
matching the documented createClient POST's create-or-update-fields description.
The word UPSERT is NOT a provider idempotency guarantee. Future SIMULATION/PROPOSAL
kinds require separate review; no such flow is implemented.

state also remains String, with structural default PREPARED. No Prisma enum, manual
CHECK, trigger or database transition enforcement is supplied. The service enforces
only the transitions below; SUCCEEDED/FAILED remain future boundary meanings:

| State | Future meaning |
| --- | --- |
| PREPARED | Durable local intention; no dispatch has been authorized as sent. |
| IN_FLIGHT | Final dispatch CAS/reservation persisted BEFORE HTTP; may have been sent. |
| SUCCEEDED | A positive remote result was received, validated and persisted. |
| FAILED | A definitive known result establishes lack of successful acceptance. |
| UNKNOWN | Provider receipt/application cannot be proved or excluded. |

revision is Int default 0 for optimistic concurrency/CAS. A service transition
must match id + expected revision + expected state, increment revision and append
the coherent action/previousState/nextState/revision Event in the SAME transaction.
Example only: PREPARED/revision 0 -> IN_FLIGHT/revision 1 with an Event carrying
previousState=PREPARED, nextState=IN_FLIGHT, revision=1. The service below implements
that CAS. Synthetic foundation state inserts prove storage ONLY;
arbitrary other strings are not blocked by these tables.

**NO AUTOMATIC POST REPLAY.** After IN_FLIGHT, abandoned/crashed execution cannot be
assumed unsent, silently reset to PREPARED or retried automatically. UNKNOWN must
never be automatically resent; future explicit reconciliation is required.
Timeout, socket reset, process crash, lost/truncated/invalid response, or provider
5xx when acceptance cannot be excluded must not automatically mean FAILED.
They may require UNKNOWN. Exact classification belongs to the future HTTP boundary.

The PREPARED -> IN_FLIGHT reservation uses a short transaction rereading
actor/session, Company, enabled CommercialAccess/RemoteIdentity, current unarchived
Contact, CPF snapshot equality, ambiguity and operation state/revision. A future caller
must additionally establish trusted server-resolved providerScope and applicable
authorization/evidence. Reconstruct the DTO
from fresh data BEFORE final CAS; do not persist it in this ledger. Treatment of the
exact request after CAS remains a separately reviewed boundary, not an invented
payload store. HTTP happens OUTSIDE the transaction. This reduces but does not
eliminate the commit-to-request revocation window. Revoke/disable must prevent new
reservations; a previously IN_FLIGHT operation remains possibly sent, and subsequent
revocation cannot pretend it never happened. No HTTP boundary is implemented here.

GET /api/tenants/{tenantId}/integration/clients/validate remains identified but its
full runtime contract remains NOT PROVEN because formal required parameters conflict
with the description. It is neither implemented nor used for automatic reconciliation.
Consent/evidence remains a separate operational boundary; there is no consent=true,
generic consent boolean or fictional evidenceId in these models.

**APPLICATION APPEND-ONLY, NOT DATABASE IMMUTABILITY.** Event history must not be
updated/deleted/upserted by application code. The current conservative TypeScript
inventory originally required ZERO writers. It now permits only the service below:
Operation.create/updateMany and Event.create. All other production sources and scripts
remain forbidden writers. Event update/delete/upsert/createMany remain forbidden
everywhere. It rejects obvious delegate extraction/aliases and dynamic mutator
calls; reusable read syntax is tested separately. This is not complete taint
analysis or arbitrary raw SQL enforcement. PostgreSQL owner/superuser can still
alter/delete data. No role split, ACL/GRANT/REVOKE, trigger/function or separate
DATABASE_URL is introduced. No history cleanup bypass is added.

Migration 20261016230000_add_opencredit_commercial_operation_foundation adds only
two tables, two unique indexes, five nonunique indexes and five FKs. No DML, seed,
backfill or change to existing data. SQLite/PostgreSQL new logical models are
equivalent; PostgreSQL FK names follow Prisma's native <=63-character convention.
CI preserves all prior gates and adds unit/storage and material PostgreSQL tests.
The dedicated guard precedes client construction and requires CI=true,
GITHUB_ACTIONS=true, OPENCREDIT_COMMERCIAL_OPERATION_POSTGRES_TEST=1, PostgreSQL
loopback, ports 5432/55432, database/user qevora_ci, fictitious CI password and exactly
schema=public. Fixtures are synthetic; the invalid repeated-digit CPF exists only
in the required RemoteIdentity parent, never in the new ledger or logs.

Material tests inspect exact columns/defaults/PKs/uniques/indexes/FKs and exercise
cross-company/scope rejection, independent intent namespaces, missing actors,
RESTRICT, NO ACTION and actual rollback after a final FK failure following valid
Operation/Event inserts. Fixtures remain only until the disposable DB is destroyed;
no Event deletion or cleanup API exists. Local tests are not a completed GitHub run.

Rollback before real use: revert this slice and separately approve a database plan
for the two empty new tables. Never automatically drop tables once real intentions
or history exist. No production migration, Railway change, remote POST, retry,
reconciliation or real operation is performed by this development.

## Commercial operation transactional service

`opencredit-commercial-operation.service.ts` is server-only, has no default client
and takes an explicitly injected transaction-capable DB. It is the sole approved
ledger writer, with no runtime caller. Only CLIENT_PROFILE_UPSERT is derived internally;
the caller cannot select an operation kind, remote identity, CPF or payload.

PREPARE takes actor, companyId, contactId, providerScope and intentKey. Inputs are
closed data snapshots: unknown keys, accessors, coercion and silent normalization
are rejected. The intentKey must be canonical lowercase UUID v4; a future trusted
caller must generate it securely with randomUUID and preserve it for the same local
intention. It is not derived from identifiers/PII, is never hashed, and is never a
provider idempotency key.

Each transaction first rereads the actor (id/companyId/role/normalized email),
reapplies the current Platform Admin rule and confirms Company. Platform Admin is a
temporary conservative gate, NOT final commercial authorization or consent/evidence.
PREPARE then looks up the existing Company/scope/intent BEFORE freshness checks.
A matching kind and linked Contact is a strict no-op in PREPARED, IN_FLIGHT,
SUCCEEDED, FAILED or UNKNOWN, preserving creator/timestamps/revision/events even after
revocation or Contact changes. Different kind/Contact/binding is INTENT_CONFLICT;
unrecognized stored state fails closed. No second intention is silently generated.

Only a new intent requires a current unarchived tenant Contact, strictly canonicalizable
CPF, enabled CommercialAccess, enabled correctly bound RemoteIdentity, matching CPF
snapshot and global scope/CPF ownership of that same identity. Ambiguity includes
archived Contacts, searches canonical digits plus conventional formatting under the
same Company with take:2, and requires exactly the target Contact. The adapter must
accept fresh snapshots; PROFILE_INVALID is sanitized without PII or cause. PREPARE
discards the profile, checks the same-transaction Company/scope/identity/kind predicate
and rejects any existing intention as INTENT_CONFLICT, regardless of state. Only an
absent predicate permits atomic creation of PREPARED/revision0 and one PREPARED Event
(null -> PREPARED) with the effective actor. Its result contains only changed,
operationId, state and revision, including on existing-intent no-op.

RESERVE takes actor, companyId, operationId, providerScope and expectedRevision;
it accepts no caller Contact, identity or intent. It requires the scoped persisted
CLIENT_PROFILE_UPSERT operation to be PREPARED at the expected revision, rereads all
freshness facts and reconstructs the profile BEFORE CAS. CAS updateMany matches
id/companyId/providerScope/state PREPARED/revision and requires count=1, setting
IN_FLIGHT and revision+1. RESERVED_FOR_DISPATCH Event and CAS commit atomically.
Only AFTER commit does the winner receive operationId/state/revision/profile.
The fresh profile is PII in memory, intended only for a future trusted HTTP boundary:
no persistence, logging, Event, error or endpoint serialization is introduced.
The loser or any repeated IN_FLIGHT reservation MUST fail with state/revision conflict,
never success/no-op or a profile. This prevents treating repeated reservation as permission
to send again. expectedRevision must be a safe integer >=0 and <=2147483646 so +1
fits PostgreSQL Int. Semantic state/revision conflicts remain distinct from retries exhausted.

markOpenCreditCommercialOperationUnknown takes the same transition input. It rereads
actor, Company and operation, but deliberately NOT access/identity/Contact freshness.
After IN_FLIGHT, revocation, identity disable, archived Contact, changed CPF or
ambiguity must not block the protective classification: CAS IN_FLIGHT/revision ->
UNKNOWN/revision+1 and MARKED_UNKNOWN Event are atomic. Repeated UNKNOWN is a safe
no-op returning the current revision without another Event, even for an older valid
expectedRevision. PREPARED/SUCCEEDED/FAILED/other states are rejected. UNKNOWN never
returns to PREPARED or IN_FLIGHT; no reset/replay/resume/automatic dispatch retry API exists.

Transactions use Serializable, maxWait=2000ms, timeout=5000ms and at most three total
attempts without sleep. P2034 retries the WHOLE local transaction and authorization.
Only PREPARE may also retry P2002 for OCOperation_company_scope_intent_key or
OCOperation_company_scope_identity_kind_key (or their exact equivalent field sets
for the correct model), then reread the winning intention. Unexpected
P2002 becomes STORAGE_ERROR; exhausted eligible retries become CONCURRENT_CONFLICT.
These are LOCAL DB retries, not HTTP replay. Error messages are fixed closed codes
prefixed OPENCREDIT_COMMERCIAL_OPERATION_, without cause/raw Prisma metadata/PII.

### Single createClient intention: database enforcement

The current foundation now adds the portable unique index
`OCOperation_company_scope_identity_kind_key` on
`(companyId, providerScope, remoteIdentityId, operationKind)` in both Prisma schemas.
The existing intentKey unique remains the command-idempotency key. The predicate
read is preserved for early INTENT_CONFLICT; the database unique is the final
authority preventing a second operation for the same identity/kind in any state.
Serializable transactions and CAS remain defense-in-depth, with the same three
attempts, maxWait=2000ms and timeout=5000ms; there is no sleep/backoff or raw lock.
The human admin command is an existing caller of prepare; preparation alone is
not consent, authorization to dispatch, or provider-side idempotency.

Migration `20261020190000_enforce_opencredit_operation_single_identity_kind`
checks historical groups before creating the index. Any duplicates fail closed
with fixed `OPENCREDIT_OPERATION_IDENTITY_KIND_DUPLICATES_EXIST`, without IDs/PII.
No row is deleted, selected as winner, updated, reconciled or backfilled. A future
deliberate update/resync needs an explicit lifecycle/schema decision, not another
intentKey bypass. Deployment with duplicates must stop for a separately approved
data plan; do not silently clean up or roll back the uniqueness protection.

The disposable migration gate tests both the previous 19-migration chain with
duplicate Operations/Events (failed upgrade preserves all rows/states), and a
clean full-chain deployment with a material unique violation. The commercial
service material gate forces 50 distinct-command races and requires one winner,
one INTENT_CONFLICT and one Operation/PREPARED Event without replay. The database
unique is the structural authority; a direct violation proves its P2002 behavior.
A separate unit contract proves the service handles that P2002 correctly. Under
Serializable/SSI a race may instead be resolved by P2034 before unique checking,
or by reading the winner after commit. Neither P2002 nor P2034 is mandatory in a
race: their counters are diagnostic only. Results are not implied by test definitions.
No live provider HTTP, provider idempotency claim, Railway change, active
reconciliation or new commercial workflow is introduced by this correction.

There is still no HTTP, API client, POST /clients, validate, simulation, proposal,
polling, response classification/reconciliation, SUCCEEDED or FAILED writer, provider
idempotency header or real identity/scope. parseOpenCreditProviderScope validates
ONLY syntax. Namespace identification is now operationally confirmed and the trusted
resolver is implemented below. Before ANY real caller, its integration and appropriate
consumer authorization/evidence remain required and BLOCKED.
No consent=true or fictional evidence is supplied. The commit-to-dispatch revocation
window remains a future boundary concern. The validate route remains identified but
its complete runtime contract remains NOT PROVEN and cannot serve as reconciliation.

CI adds service unit and PostgreSQL material gates without removing prior gates.
The dedicated guard runs before client construction, requiring CI=true,
GITHUB_ACTIONS=true, OPENCREDIT_COMMERCIAL_OPERATION_SERVICE_POSTGRES_TEST=1 and the
same strict disposable loopback qevora_ci database/credentials/schema/ports. Tests use
only synthetic fixtures and cover concurrent prepare/reserve, fresh profile rebuild,
revocation, UNKNOWN, actor/event atomicity and real FK failure AFTER observed mutation
to prove full rollback. No production failpoint or Event cleanup/deletion is added.
This service slice changes no schema, migration or dependencies. Rollback before
runtime adoption is reverting this code/CI slice; no automatic ledger deletion is safe.

## Strict raw JSON parser foundation

`parseOpenCreditStrictJson(raw: string)` in `opencredit-strict-json.ts` is a pure,
synchronous server-only primitive. It accepts a primitive JavaScript string, NOT
bytes/Buffer/Response, and returns any JSON root value: object, array, string,
number, boolean or null. Non-string inputs fail without coercion or property reads.
Byte limits, raw UTF-8 decoding, Content-Type/charset validation and complete stream
deadlines belong to the future HTTP boundary BEFORE calling this parser. A JS string
cannot prove that its original bytes were valid UTF-8.

A bounded recursive-descent scanner constructs values directly: it never calls
JSON.parse. Each object has its own Set of decoded keys; duplicate detection occurs
before insertion and before parsing the duplicate value. Escape-equivalent keys
(for example `a` and `\u0061`, or literal/escaped supplementary Unicode) are duplicates,
even for identical values. Equal keys in different objects are allowed. No Unicode
normalization/case-folding is performed: distinct code-unit sequences stay distinct.

Only standard JSON tokens/whitespace (space/tab/CR/LF) are accepted. Comments,
trailing commas, BOM/non-JSON whitespace outside strings, malformed/truncated JSON,
unknown escapes, literal U+0000..U+001F in strings, and trailing root data are rejected.
All JSON escapes are decoded. LOCAL STRICT UNICODE POLICY: decoded keys and strings
must contain paired UTF-16 surrogates; isolated high/low surrogates are rejected,
whether literal or escaped. Mixed literal/escaped valid pairs are accepted.

Objects are created with Object.create(null), including nested objects. Every field
is an own enumerable data property. __proto__, constructor and prototype are inert
ordinary JSON keys, not operations on prototypes. This does not authorize unsafe
merging into ordinary objects downstream; contract consumers still need allowlists.

LOCAL QEVORA DEFENSIVE LIMITS, not provider guarantees:

| Limit | Value | Measurement |
| --- | --- | --- |
| Raw string | 1,000,000 | UTF-16 code units |
| Container nesting | 64 | Root container depth 1; scalar root depth 0 |
| Object keys | 10,000 | Per object, after escape decoding |
| Array items | 100,000 | Per array |
| Total nodes | 200,000 | All values/containers; excludes key strings |
| Decoded string/key | 262,144 | UTF-16 code units, including both surrogate units |

Numbers use strict JSON grammar and IEEE-754 binary64, NOT arbitrary precision.
Integer results must be Number.isSafeInteger. Fraction/exponent lexemes additionally
allow at most 15 significant decimal digits (leading/trailing mantissa zeros excluded).
This deliberately rejects some representable numbers, such as a 16-digit safe integer
written with `e0`, rather than promising precision for arbitrary decimal input.
Ordinary binary64 fractional rounding remains possible; overflow and nonzero underflow
to zero are rejected. Signed zero is preserved. Future exact Decimal/financial
contracts require a separately reviewed representation; do not use this primitive
to claim exact monetary precision.

Closed errors use OPENCREDIT_STRICT_JSON_<CODE>: INVALID_INPUT, TOO_LARGE, TOO_DEEP,
TOO_MANY_NODES, TOO_MANY_OBJECT_KEYS, TOO_MANY_ARRAY_ITEMS, STRING_TOO_LARGE,
UNEXPECTED_TOKEN, UNEXPECTED_END, INVALID_STRING, INVALID_ESCAPE, INVALID_UNICODE,
INVALID_NUMBER, DUPLICATE_KEY and TRAILING_DATA. Diagnostics contain no input,
duplicate key, offset, excerpt, raw provider body, original exception/cause or parser
stack. No partial result escapes after failure.

This slice introduces zero HTTP/fetch/provider call/API client/DB/Prisma, endpoint,
UI, runtime caller, commercial ledger integration, retry/replay, authorization/evidence
or providerScope resolver. Existing object-only parseOpenCreditClientProfileResult,
API client and CommercialOperation service remain unchanged and unconnected. A future
boundary may compose raw string -> strict JSON -> operation-specific contract parser.
Structural JSON integrity does NOT prove the provider response contract or classify
createClient results. SUCCEEDED/FAILED classification remains BLOCKED; validate runtime
contract remains NOT PROVEN. Shared conversation authority foundation is unchanged.

CI adds only the tsx@4.20.6 unit gate and preserves all existing gates, including
shared authority. Tests cover decoded-key duplicates, Unicode, grammar, all inclusive
limit boundaries, hostile inputs, inert prototype-related keys and no-side-effect /
no-caller guards. No dependency, schema, migration or PostgreSQL gate is added.

## Trusted providerScope resolver

Operational Prospecta/OpenCredit onboarding confirmation received on 2026-10-17:
clients registered by CPF remain bound to the store/promoter code used as partnerId;
rotating username/password does not change that binding or move existing clients.
This is operational onboarding information, NOT a formal published OpenAPI contract.
The public API paths remain tenant-scoped. QEVORA therefore conservatively identifies
the current remote namespace by the EXACT pair tenantId + partnerId. Global partnerId
uniqueness across tenants has not been proven and is not assumed.

`opencredit-provider-scope-resolver.ts` is server-only and exports:

- `resolveOpenCreditProviderScope(config: Readonly<{ tenantId: string; partnerId: string }>)`
  returning the existing branded OpenCreditProviderScope;
- `resolveConfiguredOpenCreditProviderScope()`, a small wrapper reading ONLY
  OPENCREDIT_TENANT_ID and OPENCREDIT_PARTNER_ID;
- OpenCreditProviderScopeResolverError, code CONFIGURATION, fixed message
  OPENCREDIT_PROVIDER_SCOPE_CONFIGURATION, with no raw configuration, cause or
  detailed internal stack.

Both IDs must satisfy configuredOpenCreditId: 1..128 restricted ASCII characters,
alphanumeric first, then alphanumeric/underscore/hyphen. An additional exact-character
check rejects the terminal-newline exception permitted by the shared validator's `$`
anchor; the existing validator itself is unchanged. Missing/invalid IDs fail closed.
The injectable API accepts own data properties only; it never executes getters.
There is no trim, case conversion, Unicode normalization, replacement or fallback.
Validated IDs are hashed exactly as configured.

Version 1 derivation is fixed:

```text
digest = SHA256(UTF8("qevora/opencredit/provider-scope/v1\0")
                || UTF8(JSON.stringify([tenantId, partnerId]))).hexLowercase
scope = "ocp-" + digest[0:10] + "f" + digest[10:20] + "f"
        + digest[20:30] + "f" + digest[30:40] + "f"
        + digest[40:50] + "f" + digest[50:55]
```

The domain contains a literal NUL byte after v1. The closed two-string JSON array
provides unambiguous deterministic encoding for these ASCII IDs. The output has
exactly 64 characters: ocp- plus 55 digest hex characters and five fixed hexadecimal
`f` separators. This retains 220 bits of the truncated SHA-256 digest, not 240/256.
Truncation is intentional; no absolute collision-free guarantee is claimed. Separators
are fixed regardless of digest content and guarantee at most ten consecutive decimal
digits, preserving the UNCHANGED parseOpenCreditProviderScope rule. The final value is
reparsed by that parser. Changing this algorithm/version later would change namespaces
and requires a separate migration/compatibility decision, never silent replacement.

Output is built ONLY from the fixed prefix, digest slices and fixed separators.
Raw tenantId/partnerId are never deliberately inserted into the output. Short IDs
may naturally coincide with digest substrings; substring exclusion is not promised.
The scope is a local opaque, deterministic, hash-pseudonymized, non-self-explanatory
identifier. It is NOT secret or encrypted. Unkeyed SHA-256 does not prevent enumeration
or brute force of predictable/low-entropy IDs. No HMAC or new secret is introduced.

OPENCREDIT_API_EMAIL, OPENCREDIT_API_PASSWORD, access/refresh tokens, credential
fingerprints and unverified JWT claims do not participate. Credential rotation with
the same exact tenantId + partnerId preserves the scope. Browser/request body/query,
Company, Contact, CPF and webhook data are not configuration sources. Future callers
must use trusted server configuration; the injectable signature does not establish
provenance or grant browser callers permission to choose scopes.

The hash is NOT authorization, consent or proof of provider access. CommercialAccess
and enabled RemoteIdentity with their Company/Contact ownership checks remain required.
The resolver alone does not authorize POST /clients. The evidence foundation,
reservation enforcement and human admin boundary documented above now supply the
separate authorization layers; dispatch and FAILED writing remain BLOCKED.

Current state: remote namespace identification RESOLVED for this integration on the
operational confirmation above; trusted providerScope primitive IMPLEMENTED; sole
runtime consumer is the human authorization admin boundary; createClient dispatch BLOCKED.
The resolver itself introduces no endpoint, UI, HTTP/provider request, login, DB/Prisma access,
schema/migration, polling, validate/simulation/proposal or Railway change is introduced.
CI adds only its tsx@4.20.6 unit gate and preserves all existing gates. No PostgreSQL
gate or database dependency is added for the resolver.

## Strict HTTP JSON response boundary

`readOpenCreditStrictJsonResponse(response)` in `opencredit-http-json-boundary.ts`
is a passive server-only primitive consuming an already-obtained native Response:

```text
provider Response bytes
→ Content-Type check
→ bounded stream
→ fatal UTF-8 decode (BOM preserved)
→ parseOpenCreditStrictJson
→ operation-specific parser (future caller, composition tested locally)
```

Only application/json is accepted, optionally with a single UTF-8 charset parameter.
Case-insensitive tokens, SP/HTAB optional whitespace and quoted UTF-8 are allowed;
other charsets, extra/duplicate parameters, missing Content-Type, suffix media types
and combined media types are rejected. Missing, consumed or caller-locked bodies
are rejected; this primitive never releases a lock owned by another reader.

LOCAL QEVORA LIMIT — NOT PROVIDER CONTRACT: maximum 64 KiB of actual body bytes,
and a total 20-second body-read deadline, not a per-chunk idle timeout. These match
the existing banks reader; the proposal status reader uses 32 KiB and 20 seconds.
The new generic ceiling is not a reason to enlarge or replace either existing reader.
A valid decimal Content-Length above the ceiling rejects before any read. Absent,
malformed or understated lengths never bypass the actual streamed-byte counter.
One deadline race bounds the whole read, avoiding retained deadline reactions per
chunk; monotonic elapsed-time checks also cover continuously available/empty chunks.

Incremental TextDecoder uses fatal:true and ignoreBOM:true. Despite its name, the
latter preserves U+FEFF instead of silently stripping the signature: the existing
strict parser therefore rejects a leading BOM, including one split across chunks.
Malformed UTF-8 and an incomplete final encoding reject without replacement.
The strict parser receives the decoded string without a JSON.parse shortcut, so
duplicate decoded keys, trailing data, comments and malformed JSON still reject.
Any valid JSON root is supported, not only objects. Only parsed JSON values are
returned; raw strings/bytes are not returned as a separate transport diagnostic.
A JSON string root is still a legitimate parsed JSON value.

Errors have closed codes, fixed messages and a fixed diagnostic stack, with no
original cause, raw body/headers/URL, PII, credentials, offsets or snippets. Failure
cancels the owned body when appropriate and always releases its reader lock.
Cancellation rejection is suppressed; cancellation is deliberately not awaited
because an underlying source can leave that promise pending forever. A Response
body is consumed by design (bodyUsed changes); headers/status and supplied bytes
are not edited. HTTP status is not interpreted and remains the caller's concern.

Local tests compose Response → boundary → strict parser → the existing
parseOpenCreditClientProfileResult and preserve all four success/created boolean
pairs. They are NOT authorization, consent, financial acceptance, guaranteed remote
creation, idempotency or a ledger SUCCEEDED/FAILED/UNKNOWN classification.

This slice makes no request, login, refresh or provider call. It has no production
consumer, endpoint, UI, worker, webhook/cron integration, DB/Prisma or ledger writer.
It does not alter the existing client/authentication/retry contract or readers.
The operation service remains the sole existing ledger writer; PREPARED/IN_FLIGHT/
UNKNOWN invariants are unchanged. No schema, migration, environment, dependency,
secret or Railway change is introduced. The existing validate required/conditional
parameter divergence remains unresolved; neither validate nor createClient is enabled.
CI adds only the explicit boundary unit gate and preserves existing material gates.

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
STRICT JSON PARSER: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
RUNTIME CONSUMER AUTHORIZATION/EVIDENCE: BLOCKED
CREATE CLIENT DISPATCH: BLOCKED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
LEDGER SUCCEEDED/FAILED TRANSITIONS: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## CreateClient outcome classification policy

`classifyOpenCreditCreateClientOutcome` in `opencredit-create-client-outcome.ts`
is a pure, synchronous, passive server-only policy. It accepts only sanitized
observations, not Response, raw JSON/body, headers, URL, CPF, IDs, credentials,
provider messages or errors. The closed discriminated union accepts:

- PARSED_RESPONSE: integer HTTP status 100..599 and an exact success/created
  boolean pair already validated by the operation-specific parser;
- UNREADABLE_RESPONSE: the same status range and only INVALID_CONTENT_TYPE,
  TOO_LARGE, INVALID_UTF8, INVALID_JSON, STREAM_ERROR, INVALID_RESPONSE or
  INVALID_CONTRACT;
- NO_RESPONSE: only TIMEOUT or NETWORK. A body-read timeout is represented as
  NO_RESPONSE/TIMEOUT for this policy even if headers were previously obtained;
  either representation of untrustworthy results must never imply remote failure.

Root and nested objects must contain exactly the expected own enumerable data
properties. Custom prototypes, inherited fields, accessors, symbols, hidden fields,
extras and invalid values reject through one fixed sanitized error without cause,
original exception or submitted data. Null-prototype records remain supported.

| Observation | Local classification | Basis / extra output |
| --- | --- | --- |
| 201 + true/true | SUCCEEDED | HTTP_201_SUCCESS_CREATED; created=true |
| 201 + true/false | SUCCEEDED | HTTP_201_SUCCESS_UPDATED; created=false |
| 201 + false/false | UNKNOWN | HTTP_201_UNCONFIRMED_RESULT |
| 201 + false/true | UNKNOWN | HTTP_201_CONTRADICTORY_RESULT |
| non-201, any valid pair | UNKNOWN | UNPUBLISHED_HTTP_STATUS |
| unreadable response, any valid status | UNKNOWN | UNREADABLE_RESPONSE |
| no response | UNKNOWN | NO_RESPONSE |

This is LOCAL QEVORA policy, NOT a formal provider response schema. The public
OpenAPI 3.1.0 / version 2.8.0 was rechecked for IntegrationApiController_createClient:
only HTTP 201 documents a positive result, with an example but no complete schema.
The 400/401 examples do not justify negative classification. No schema
for 4xx/5xx is invented. Every non-201, including 200/202, 401/403 and 5xx, stays
UNKNOWN even with parsed true/false flags. A structurally validated 201 false/false
does NOT prove non-application remotely: the booleans are documented only by example,
without a complete formal schema or conclusive operational evidence. It remains
UNKNOWN; false/true also remains UNKNOWN as contradictory. No observation in the
current policy emits FAILED, and its output type is restricted to SUCCEEDED | UNKNOWN.
FAILED in the existing ledger remains reserved for future conclusive evidence,
not an invented future basis or a transition introduced by this slice.
For 201 true/false the provider describes updating an existing CPF; this is NOT
proof of idempotency. No guarantee of financial acceptance or remote uniqueness
is inferred. Output is a fresh closed object: state and closed basis, plus created
only on SUCCEEDED, without raw status or transport/provider diagnostics.

The existing parser still preserves all four boolean pairs without classification;
tests compose it with the policy without connecting production components. Earlier
slice descriptions of blocked classification refer to their original scope; this
slice implements only the in-memory policy, NOT ledger outcome transitions.

No POST/request, API client, HTTP boundary call, runtime consumer, endpoint, UI,
worker, webhook, cron, polling, DB/Prisma, ledger writer or side effect is added.
The operation service remains unchanged: PREPARED -> IN_FLIGHT -> UNKNOWN. This
policy does not authorize an operation, supply consumer consent/evidence, permit
retry/replay, reserve identity, dispatch, reconcile or resolve ambiguous outcomes.
Missing/unreadable responses cannot prove the provider did not apply an operation.
401 never grants permission to replay a POST. No provider idempotency key, request
hash or CPF-derived key is introduced; intentKey remains local intention identity.
No schema, migration, environment, dependency or Railway change is introduced.
CI adds one focused unit gate and preserves every existing gate; this DB-free
policy needs no new material PostgreSQL gate.

## CreateClient outcome ledger settlement

`applyOpenCreditCreateClientObservation(db, transitionInput, observation)` is the
only new public settlement API. It classifies the closed observation through the
UNCHANGED `classifyOpenCreditCreateClientOutcome` before opening any transaction.
Invalid observations become the fixed service error
OPENCREDIT_COMMERCIAL_OPERATION_INVALID_OBSERVATION, without original input/cause,
transaction, mutation or event. The sanitized classification is captured once;
transaction serialization retries do not reread the supplied observation.

```text
PARSED/validated observation (or closed unreadable/no-response fact)
→ existing outcome policy
→ authorized atomic local ledger settlement
```

| Outcome policy result | Allowed transition / final event |
| --- | --- |
| SUCCEEDED CREATED (201 true/true) | IN_FLIGHT → SUCCEEDED / MARKED_SUCCEEDED_CREATED |
| SUCCEEDED UPDATED (201 true/false) | IN_FLIGHT → SUCCEEDED / MARKED_SUCCEEDED_UPDATED |
| UNKNOWN (every other valid observation) | IN_FLIGHT → UNKNOWN / MARKED_UNKNOWN |
| FAILED | Impossible: not emitted by the current policy; no writer |

A private shared terminal CAS implements both the new API and the existing
`markOpenCreditCommercialOperationUnknown`; the latter's public behavior is
preserved. Each transaction remains Serializable, rereads the effective Platform
Admin, Company and tenant/scope/kind-scoped operation, and CASes id + companyId +
providerScope + IN_FLIGHT + expectedRevision. Exactly count=1 permits revision+1
and an Event in the same transaction. Count=0 conflicts, unexpected counts fail
as STORAGE_ERROR. Event or commit failure cannot return success; Event failure
rolls the mutation back. P2034 retries stay bounded at three attempts, rereading
actor and operation each time, without sleep/backoff or HTTP retry.

The effective transaction actor is recorded, not assumed to be the creator. Only
the existing Event.action distinguishes CREATED from UPDATED: no response, profile,
CPF, boolean metadata, token, header, URL or provider diagnostic is persisted.
Results contain only changed, operationId, state and revision, never the observation.
`created=false` is NOT proof of provider idempotency.

Settlement records a post-dispatch fact, not permission to dispatch. It does not
reread Contact/CPF, CommercialAccess, RemoteIdentity or the profile adapter. Changes
to these facts after dispatch (revocation, disabled identity, archived/changed or
ambiguous Contact) cannot erase or block recording an already observed result.
The existing actor/Platform Admin policy remains temporary and unchanged; consumer
authorization/evidence still needs its own reviewed orchestration boundary.

Repeated SUCCEEDED or UNKNOWN is an authorized/scoped safe no-op, even with an older
valid expectedRevision: it returns the persisted revision without another event or
timestamp mutation. The first terminal action remains authoritative even if a later
positive observation differs on created. Conflicting terminal states reject:
UNKNOWN → SUCCEEDED and SUCCEEDED → UNKNOWN are forbidden. PREPARED, FAILED and
unrecognized states cannot be settled. No reset/resume/replay or reconciliation
is introduced. The first committed terminal CAS wins concurrent attempts; at most
one terminal revision/event is written. Ambiguity remains UNKNOWN, never FAILED.

The outcome guard now permits exactly one static named import in exactly
`src/lib/opencredit-commercial-operation.service.ts`, with only the classifier and
its observation type, without aliases. All other production consumers, dynamic
imports, requires, wildcards and re-exports remain forbidden. The service still
has no external runtime caller. Its export list stays closed; no public generic
markSucceeded or markFailed API exists. Static writer checks restrict the shared
terminal primitive to SUCCEEDED/UNKNOWN and preserve existing ledger write sites.

The unit/material PostgreSQL suites are expanded through existing CI gates; no CI
change is needed. Material tests cover both positive actions, observation UNKNOWN,
repeat/no-overwrite, real Event FK rollback and concurrent competing terminal CASes.
Execution results must be reported separately; mock tests do not prove material
PostgreSQL rollback/concurrency. Earlier sections describe their original slices;
the outcome policy remains pure, while this section introduces its sole approved
passive ledger consumer. No real HTTP/POST, provider call, endpoint, UI, worker,
cron, webhook, AI/chatbot, validate/simulation/proposal integration, schema,
migration, dependency, environment or Railway configuration is introduced.

```text
HTTP JSON RESPONSE BOUNDARY: IMPLEMENTED
CREATE CLIENT REQUEST CONTRACT: IMPLEMENTED
CREATE CLIENT OUTCOME POLICY: IMPLEMENTED
CREATE CLIENT OUTCOME LEDGER SETTLEMENT: IMPLEMENTED
TRUSTED PROVIDER SCOPE: IMPLEMENTED
COMMERCIAL OPERATION LOCAL LEDGER: IMPLEMENTED
RUNTIME CONSUMER AUTHORIZATION/EVIDENCE: BLOCKED
CREATE CLIENT DISPATCH: BLOCKED
FAILED TRANSITION: BLOCKED
RECONCILIATION: BLOCKED
AUTOMATIC REPLAY: FORBIDDEN
```

## CommercialAccess human review UI

Platform Admins can review a Company's **Acesso comercial OpenCredit** in the
existing Empresas administration page. The panel is not mounted in tenant-facing
settings. ATIVO / INATIVO / NÃO CONFIGURADO reflect a server context snapshot,
not a browser assumption or a provider permission.

POST /api/admin/integrations/opencredit/commercial-access/context accepts exactly
{companyId} and returns only {ok:true,exists,enabled}. It follows the existing
session, Platform Admin, same-origin, no-query/no-browser-Authorization, JSON,
512 actual bytes, one-second total deadline, fatal UTF-8 and strict JSON guards.
The configured providerScope is server-derived only. A bounded read-only
transaction rechecks the persisted Platform Admin, Company and scoped Access.
It creates no domain data; only the shared limiter may perform its normal
RateLimitBucket infrastructure writes. Responses use Cache-Control: no-store.
Context budgets are separate from mutation budgets (60/min actor, 30/min Company).

Grant and revoke use only the two existing admin mutation endpoints, each behind
an explicit window.confirm click. No mutation occurs on mount/effect, timer or
automation. A successful mutation reloads context; its body is not used to infer
final state. On ambiguity, no automatic retry occurs and context must be refreshed
before another action. Company-keyed remount, abort, epoch checks and synchronous
busy/current-context refs reject stale responses/actions and double clicks.
401/403 hides the panel. No internal scope, IDs, actor or raw errors are displayed.

This is operational Company access, NOT consumer consent or authorization.
The existing domain service and its exclusive admin mutation authority are
unchanged. No RemoteIdentity, ConsumerAuthorization, commercial operation,
provider/Meta call, schema, migration, dependency, environment or Railway change.
Regression gates include the actual compiled UI async callbacks, closed HTTP
boundary and read-only material PostgreSQL snapshots. Rollback removes this
panel/context and their exact gates/allowlists; it does not delete domain history.

## RemoteIdentity human admin boundary and review UI

This slice adds the sole approved runtime consumer of the existing RemoteIdentity
domain service: the human admin handler. Earlier foundation sections describing
no runtime caller refer to their original slices. The domain implementation and
its ownership, snapshot, protective disable, Serializable retries and atomic
Identity/Event rules remain unchanged.

POST /api/admin/integrations/opencredit/remote-identity/{claim,enable,disable}
accepts exactly {companyId,contactId}, derives the actor from session and the scope
from resolveConfiguredOpenCreditProviderScope, and calls exactly one existing
service operation. It neither reads/canonicalizes CPF nor decides ownership.
Only the three fixed routes compose this mutation handler. Public results contain
only {ok:true,changed,enabled}; no identity ID, CPF, scope, actor or raw error.
Domain errors use a closed descriptor-based, module-stable code mapping.

POST /api/admin/integrations/opencredit/remote-identity/context accepts the same
two fields and returns only {ok:true,exists,enabled}. Its separate read-only
transaction rechecks the persisted Platform Admin, Company, scoped Contact and
exact Company/providerScope/contact identity, without reading CPF or mutating
domain data. Missing identity is not created. Only the existing shared limiter
may perform normal RateLimitBucket infrastructure writes.

All four boundaries require Platform Admin, same-origin, no query or browser
Authorization, application/json, 512 actual bytes, a one-second total body
deadline, fatal UTF-8 and strict JSON/decoded duplicate-key rejection. All replies
use Cache-Control: no-store and fixed sanitized errors. Mutation budgets are shared
across all three actions (10/min actor, 5/min Company+Contact); context budgets are
separate (60/min actor, 30/min Company+Contact), before scope resolution.

The contact detail panel is mounted only for Platform Admin and displays
NÃO VINCULADO / VINCULADO — INATIVO / ATIVO. CLAIM reserves a disabled identity;
it never automatically enables it. ENABLE and DISABLE each require a new human
click and window.confirm. Successful commands only trigger a context reload,
never another command, and mutation bodies never determine final UI state.
Company+Contact-keyed remount, abort, sequence, busy/current-context refs prevent
double clicks, stale responses/actions and ambiguous retry. Errors invalidate
actionable state until a new context read; 401/403 hides the panel.

This is a local operational identity binding, NOT consent, ConsumerAuthorization
or permission for a financial operation. No provider HTTP/authentication, API
client, createClient dispatch, automation, AI/chatbot/webhook/worker consumer,
schema, migration, env, dependency or Railway change is introduced.
Tests include real HTTP boundary composition with the existing service, local
disposable PostgreSQL ownership/rollback/concurrency, read-only snapshots and
compiled UI callbacks. All preexisting CI gates remain; dedicated unit/UI and
material gates are additive. Rollback removes the new UI/boundaries and exact
allowlists/gates, preserving identity ownership/history; there is no delete or
automatic release of ownership.
# createClient technical diagnostics (2026-10-26)

The nullable `OpenCreditCommercialOperation.diagnostic` column is a versioned,
closed technical DTO serialized as text, consistently across SQLite/PostgreSQL.
Migration `20261026130000_add_opencredit_operation_diagnostic` only adds a nullable
column. No DML, backfill, constraint changes or reconstruction of old observations.
Historical NULL means diagnostic unavailable, not provider failure or no attempt.
Rollback: revert application usage and leave the additive nullable column in place;
do not delete diagnostic evidence or reverse a production migration manually.

The dispatcher persists the observation in an independent transaction BEFORE the
existing terminal settlement. It records HTTP status when actually observed,
restricted request/correlation IDs, boolean success/created only when parsed,
read/parse flags, closed technical category, known provider error code,
observation/response timestamps and commit-to-dispatch timestamp. That timestamp
does NOT prove delivery, receipt or processing. No diagnostic is an idempotency key.

Settlement diagnostic statuses are NOT_ATTEMPTED (pre-auth failure), NOT_CONFIRMED
(observation saved before settlement), ERROR (settlement threw) and CONFIRMED.
These are technical metadata, never CommercialOperation states. State/revision and
ledger Events are unchanged by a diagnostic write. The first provider observation
is protected by compare-and-swap; only its settlement flag may advance to ERROR or
CONFIRMED. A subsequent explicitly initiated reservation can supersede a prior
pre-auth diagnostic, which is not a provider attempt. No replay is introduced.

Diagnostics are scoped to operation + Company + trusted providerScope + revision;
the persisted actor must still satisfy the same Platform Admin guard. Diagnostic
persistence is best effort and never authorizes dispatch or blocks the protective
settlement. Independent storage survives terminal rollback when storage is working.
An outage/process crash can still leave NULL or NOT_CONFIRMED; terminal state/events
remain authoritative. A confirmation-metadata write can fail after terminal commit.
Structured sanitized logs report the persistence result as a fallback, not an
atomic guarantee between PostgreSQL and the external provider.

Privacy: no raw request/response, free provider message, error detail, URL/query,
CPF, phone, email, tokens, password, bearer/header collection or profile snapshot is
stored. `failureMessageSanitized` is deliberately not a copied provider string:
the browser uses fixed local messages for a closed category. Only VALIDATION_ERROR
and UNAUTHORIZED provider error codes are retained; others are discarded.
Provider IDs are taken only from observed x-request-id / x-correlation-id or the
documented top-level body requestId. Only UUID or req_ + 12..32 hex forms survive;
11 consecutive digits and known profile/config secret substrings are rejected.
The official client also rejects IDs containing its cached access/refresh token,
including opaque tokens that happen to match the UUID/req_ grammar, without
returning the token pair or performing authentication. Alternate test transports
without this sanitizer fail closed by discarding IDs.
All other ID forms are intentionally lost rather than persisted unsafely. These
are opaque diagnostic references, not proof of identity/permission or receipt.
Request IDs returned on a POST response may be unavailable if the body is unreadable.

Technical categories distinguish non-201, network, transport/body timeout, body
size, UTF-8/JSON/contract failure, success=false and pre-reservation authentication
failure. The existing outcome classifier is unchanged: only HTTP 201 and
success=true can settle SUCCEEDED; every other observation remains UNKNOWN.
No current path writes FAILED. Transport remains auth -> reserve/commit -> one
POST, without additional diagnostic DB work between commit and transport. No
refresh+POST replay, second POST, reset, automatic reconciliation or retry is added.

The existing Platform Admin review context/UI presents only the closed diagnostic,
including success/created/status/category/IDs and settlement metadata, also for
SUCCEEDED/PREPARED operations. It adds no command or permission. Old operations
remain reviewable without diagnostics. Never interpret HTTP 200 from the CRM,
found=false, UPSERT wording or a technical diagnostic as permission to resend.
