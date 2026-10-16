# OpenCredit API authentication (not webhook authentication)

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
fingerprint. Rotating a key does not define a new namespace. The actual remote
namespace still needs confirmation with Prospecta; no tenant/account equivalence
or dynamic scope allowlist is invented here.

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
The effective provider namespace still requires confirmation with Prospecta.
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
never browser scope or email/password/token-derived namespaces. That resolver is
not implemented; the real provider namespace remains blocked pending Prospecta
confirmation. No real access/scope is configured or granted by this development.

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
flow. No remote identity, claim/reuse, operation record, dispatch or credit call exists
in this slice. Serializable local state does not solve future HTTP revocation races.
The application append-only limitation remains: owner/superuser can modify history
with database privileges; no ACL, trigger or role separation was added.
Rollback: revert the service/CI/documentation commit; this slice has no schema,
migration, backfill or operational data to undo. Existing audit tables are preserved.

## Remote identity audit foundation

OpenCreditRemoteIdentityEvent introduces persistent history before any functional
identity writer. The internal transactional service documented below now implements
claim/enable/disable. There is still no endpoint, route, server action, UI, runtime
caller, provider call, operation record or consent mechanism for remote identity.
No real identity, access grant or operational scope is created.

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
history exists, do not automatically erase it. The namespace still requires
Prospecta confirmation and trusted server-side resolution; operation
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
not browser input, tenantId, partnerId, email, password or token. No real resolver
is implemented here. Output contains only changed/enabled/identityId. Errors contain
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
