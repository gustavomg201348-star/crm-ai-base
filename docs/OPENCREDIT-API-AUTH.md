# OpenCredit API authentication (not webhook authentication)

Audited against the official [partner documentation](https://core.api.opencredit.tech/api/partner-docs)
and its [OpenAPI](https://core.api.opencredit.tech/api/partner-openapi.json), contract 2.8.0,
on 2026-10-14. Existing inbound ingestion/HMAC and configuration are independent.
No changes to lead.assigned, receive modes, schema, migrations or UI are needed.

## Server-only client

`src/lib/opencredit-api-client.ts` exports a lazy reusable client and injectable factory.
Supply OPENCREDIT_API_EMAIL and OPENCREDIT_API_PASSWORD through the deployment's
secret manager; never put actual values in Git, logs, browser state or URLs.
Importing the client makes no requests. No route or existing caller uses it yet.

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
Rollback: remove this unused client/tests/document; no database rollback needed.
