# OpenCredit API authentication (not webhook authentication)

Audited against the official [partner documentation](https://core.api.opencredit.tech/api/partner-docs)
and its [OpenAPI](https://core.api.opencredit.tech/api/partner-openapi.json), contract 2.8.0,
on 2026-10-14. Existing inbound ingestion/HMAC and configuration are independent.
No changes to lead.assigned, receive modes, schema, migrations or UI are needed.

## Server-only client

`src/lib/opencredit-api-client.ts` exports a lazy reusable client and injectable factory.
Supply OPENCREDIT_API_EMAIL and OPENCREDIT_API_PASSWORD through the deployment's
secret manager; never put actual values in Git, logs, browser state or URLs.
Importing the client makes no requests. Only the platform-admin connection test
described below uses it; no commercial workflow is connected.

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

All four settings must exist before external requests: OPENCREDIT_API_EMAIL,
OPENCREDIT_API_PASSWORD, OPENCREDIT_TENANT_ID and OPENCREDIT_PARTNER_ID. IDs accept
1–128 ASCII letters/digits/underscore/hyphen, starting with a letter/digit. Values
are runtime-only, never hardcoded, accepted from requests or stored in the database.
Confirm the actual account/tenant/partner relationship through provider onboarding.
This endpoint is not a Company-to-partner commercial authorization registry.

The service constructs exactly GET `/api/tenants/{tenantId}/banks` with product=clt
and the configured partnerId. It never selects another path or initiates commercial
POST/PATCH/DELETE. Required login/refresh POSTs remain solely in the existing client.
Provider 401 recovery and the single GET retry are unchanged; no service retry exists.

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
