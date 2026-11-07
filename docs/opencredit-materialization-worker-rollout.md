# OpenCredit: controlled worker rollout

Implementation only. This change does not enable the worker, change integration
flags, deploy, or process production jobs. Activation requires separate approval.

## Environment contract

| Variable | Default | Accepted values |
| --- | --- | --- |
| `OPENCREDIT_MATERIALIZATION_WORKER_ENABLED` | OFF | Only the exact string `true` enables the worker |
| `OPENCREDIT_MATERIALIZATION_WORKER_BATCH_LIMIT` | `1` | Canonical decimal integers `1` through `10` |
| `OPENCREDIT_MATERIALIZATION_WORKER_INTERVAL_MS` | `1000` | Canonical decimal integers `1000` through `2147483647` |

Missing, malformed, zero, negative, fractional, whitespace-padded, or out-of-range
batch values fall back to **1**, including values above 10. Invalid intervals fall
back to **1000 ms**. Numeric factory options obey the same hard bounds.

The interval is a delay **after** each completed/failed cycle, not a fixed-rate
timer. There is no immediate refill after processing a batch or after failure.
The first enabled cycle runs at startup. Batch configuration is read per cycle;
interval configuration is read when constructing the worker.

## Gates, bounded work, and kill switch

Each cycle checks the live environment reference before recover, expire, claim,
and each process call. OFF means no new worker operation is dispatched. Work
already dispatched is not interrupted or rolled back. If OFF occurs after claim,
unprocessed leases remain protected until normal lease recovery; there is no
manual requeue or replacement claim.

Environment variables belong to a process. Changing Railway configuration does
not rewrite an existing process's `process.env`: platform propagation/restart is
still required. This is not a distributed instantaneous cancellation mechanism.
No Railway configuration is changed by this PR.

The batch ceiling is **per cycle, per worker instance**, not per boot or a global
deployment quota. Multiple instances may collectively process more than one batch.
Use a single instance and a separately approved conservative interval for a future
limited rollout. For exactly one job total, use the existing single-job pilot.

The worker calls the unchanged readiness-protected `claim(batchLimit)` once per
cycle. Its existing cursor evaluates at most 4 pages of 25 candidates per claim,
without loading the entire queue. WAITING_IDENTITY stays PENDING with no attempt
or lease. READY_EXISTING_CONTACT and READY_NEW_CONTACT alone admit leases.
Integration gates remain `enabled=false`, `paused=false`,
`materializationEnabled=true`, with company/integration/providerScope binding.

Recover and expire remain native bounded maintenance phases, each receiving the
same batchLimit, and can affect up to that many jobs **in addition to** the claimed
batch. Their existing global scope and expiry/retry behavior are unchanged. OFF
prevents both. The batch ceiling is not a ceiling on all maintenance mutations.

Existing row locks, SKIP LOCKED, conditional lease updates, Serializable claim,
identity advisory locks and materializer revalidation remain authoritative.
Identity conflicts after readiness fail closed through the existing review path.
There is no global Contact table lock, schema change, or provider fallback.

## Errors and sanitized telemetry

`opencredit_materialization_worker_cycle` logs closed phases `started`,
`completed`, or `failed`, plus only numeric counts, batchLimit, durationMs,
workerEnabled and skipped. `skipped=true` means zero leases were claimed; it does
not assert that maintenance performed no work or that no READY job exists.
Counters distinguish completed, needsReview, retry and lost-lease/failed results.
No IDs, identity, envelopes, tokens, headers, exception text or stack are logged.
The best-effort logger isolates synchronous exceptions and rejected promises.

The materializer retains its native typed retry/review, attempt ceiling, backoff,
and lease-loss handling. An unexpected rejected process call fails the cycle,
stops the remaining batch, emits a sanitized failure, and rejects `runOnce()`.
The scheduler contains that rejection, waits a full interval, and never refills
within that cycle. A failed cycle is never reported as completed.

## Future activation and rollback (recommendation only)

Before separately authorized activation: repeat the production preflight, inspect
stale/expired/retry/review jobs, confirm bindings and a single intended instance,
then choose batch=1 and a conservative interval. Recover/expire happen before
claim; account for their effects before enabling anything.

Kill switch: set ENABLED to a value other than exact `true` through the approved
operations process and verify it reached the live application. In-flight work
can complete; inspect its persisted outcome. Do not manually retry ambiguous work.
Code rollback is a revert of this isolated commit; no data/schema rollback is
required. Reverting code alone does not disable an already enabled worker, so
disable first and verify OFF. Do not revert to the former batch=10 default while
the worker is enabled.
