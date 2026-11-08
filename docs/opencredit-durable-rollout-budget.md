# OpenCredit durable rollout budget V1

This feature is OFF until explicitly configured. Installing the migration does
not create a budget or activate a worker. Production activation requires a
separate operational authorization and preflight.

## Modes

`OPENCREDIT_MATERIALIZATION_WORKER_ENABLED` must equal `true`. In addition:

- `OPENCREDIT_MATERIALIZATION_WORKER_MODE=NORMAL` requires the rollout ID variable
  to be absent (even an empty value is invalid).
- `OPENCREDIT_MATERIALIZATION_WORKER_MODE=ROLLOUT` requires
  `OPENCREDIT_MATERIALIZATION_WORKER_ROLLOUT_ID` to identify an existing budget.
  IDs accept 1–128 ASCII letters/digits/underscore/hyphen, starting alphanumeric.
- Missing or invalid mode/ID prevents startup. There is no fallback to NORMAL.

Existing batch/interval bounds remain unchanged. ROLLOUT skips global recover
and expire; NORMAL retains its maintenance behavior. Maintenance never refunds
an admission or reconciles/releases a rollout. NORMAL/PILOT cannot claim a
reserved binding or an unreconciled job.

## Durable authority

The PostgreSQL budget binds company, integration and provider scope. A partial
unique index allows only one unreleased reservation per binding, including
CLOSED/expired budgets. Closing, expiry, restart and completion do not release it.

Each admission has a unique `(rolloutId, slot)` and `(rolloutId, jobId)`. A partial
unique index on unreconciled `jobId` prevents silent readmission. There is no
permanent global job ID uniqueness. Core admission fields are immutable through
the application; only explicit reconciliation sets `reconciledAt`.

Claims lock the budget first in a Serializable transaction, then lock the job,
validate the integration/readiness and conditionally grant a lease. The same
transaction inserts its admission and conditionally increments the budget. The
last slot closes the budget. The caller receives a lease only after commit.
Failure rolls back all three changes; ambiguous commit is never retried blindly.

Database CHECK constraints enforce `1 <= maxAdmitted <= 3` and
`0 <= admittedCount <= maxAdmitted`. Slots, composite foreign keys and partial
unique indexes enforce binding/reservation/admission uniqueness. Counter/ledger
equality is maintained by the service transaction and checked at admission/admin
boundaries and in tests. V1 intentionally has no cross-table trigger: these
invariants assume application-controlled writes, not arbitrary privileged SQL.

The cap counts admitted leases, not successful completions. Crash, stale lease,
RETRY, NEEDS_REVIEW, expiry or COMPLETED never return capacity. Missing, closed,
expired, exhausted, inconsistent or unavailable budgets grant no new leases.

Before domain writes, the materializer checks the unreconciled admission, job,
binding, attempt and SHA-256 hash of the random lease token. It uses plain budget
reads, avoiding inverse budget/job lock acquisition. CLOSED permits completion
of an already admitted lease, including the last slot. No provider call is added.

## Administrative lifecycle (no UI)

`POST /api/admin/integrations/opencredit/materialization/rollouts` uses existing
session/platform-admin authentication, same-origin protection, bounded strict
JSON and actor/binding rate limits. Authorization is rechecked against the user
record. Provider scope comes from trusted server configuration, never the body.
Responses expose technical budget metadata only. No job envelope is read.

Commands have exactly the documented keys:

- CREATE: `action`, `companyId`, `integrationId`, `maxAdmitted` (1–3), `expiresAt`
  (future UTC ISO timestamp).
- CLOSE: `action`, `companyId`, `integrationId`, `rolloutId`.
- RELEASE: `action`, `companyId`, `integrationId`, `rolloutId`,
  `confirmReconciled: true`, `expectedAdmittedCount` (0–3).

CREATE/RELEASE require the runtime worker flag to be OFF and valid materialization
gates. Operators must independently confirm all replicas are OFF/quiescent before
using them. CREATE rejects existing PROCESSING/lease markers. CLOSE works even
if integration gates changed and never resets capacity. RELEASE requires CLOSED,
the expected ledger count, no PROCESSING/lease markers in the binding and each
admitted job in COMPLETED/RETRY/NEEDS_REVIEW/EXPIRED at its admitted attempt.
The administrator must inspect/reconcile outcomes first; the command does not
recover, expire, requeue or reset a job. It atomically reconciles admissions and
releases the reservation. A later explicit budget may then admit a still-eligible
job again; the old rollout can never admit that job twice.

## Preflight and rollback

Read-only preflight adds up to 100 sanitized budget summaries plus total/complete,
reservation status, ledger count/consistency and remaining capacity. No job IDs,
token/hash, identity or payload appear in this summary. NORMAL claimable count
is zero for a reserved binding; readiness is reported independently.

Operational stop: set worker OFF and confirm the effective runtime, then inspect
leases/outcomes before CLOSE/RELEASE. This document does not authorize that action
in production. Do not delete budgets/admissions or reset counters to roll back.
Keep additive tables and reservations while reconciling; rolling code back to a
version unaware of reservations is unsafe unless every worker/pilot is OFF.

Tests cover clean migration, upgrade preserving existing rows, concurrency,
atomic rollback, ambiguous commit, binding isolation, admission provenance,
reconciliation/reuse and bounded cursor scans. No production data is used.
