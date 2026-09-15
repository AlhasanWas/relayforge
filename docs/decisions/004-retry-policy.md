# ADR 004: Webhook delivery retries, leases and dead-lettering

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

Customer endpoints fail in many ways: deploys return 502, overloaded services
return 429 or 503, networks drop connections, handlers hang, and some requests are
simply rejected (400, 404). Retrying transient failures is essential; retrying
permanent ones wastes resources and delays operators noticing the problem.
Workers can also crash mid-attempt, and HTTP gives no way to learn afterwards
whether a request that was sent was also processed.

## Decision

### Classification (one place: `DeliveryRetryPolicy`)

| Observed                                              | Outcome             | Next state                               |
| ----------------------------------------------------- | ------------------- | ---------------------------------------- |
| 2xx                                                   | `SUCCESS`           | `SUCCEEDED`                              |
| Timeout, DNS or connection error                      | `RETRYABLE_FAILURE` | `PENDING` with backoff                   |
| Configured retryable statuses (default `408,429,5xx`) | `RETRYABLE_FAILURE` | `PENDING` with backoff                   |
| Other 4xx, and 3xx (redirects are not followed)       | `PERMANENT_FAILURE` | `DEAD_LETTER` (`NON_RETRYABLE_RESPONSE`) |
| Destination resolves to a private or reserved address | `PERMANENT_FAILURE` | `DEAD_LETTER`                            |
| Endpoint disabled or deleted since scheduling         | `PERMANENT_FAILURE` | `DEAD_LETTER` (`ENDPOINT_UNAVAILABLE`)   |
| Retryable, but `attempt_count = max_attempts`         | —                   | `DEAD_LETTER` (`MAX_ATTEMPTS_EXHAUSTED`) |

The retryable statuses are configuration (`DELIVERY_RETRYABLE_STATUS_CODES`), not
code scattered through the worker. 2xx can never be configured as retryable.

### Backoff

`ceiling = min(max, base × 2^(attempt − 1))`, `delay = ceiling/2 + random × ceiling/2`
("equal jitter"). Jitter spreads out the retries of many deliveries that failed
together during a receiver outage. The half-ceiling floor guarantees the delay
keeps growing, which "full jitter" does not.

`Retry-After` on 429 and 503 is honoured when it is valid delta-seconds or a future
HTTP date: `delay = min(max, max(retryAfter, backoff))`. A receiver can ask for more
time but cannot make RelayForge retry sooner than its own schedule or later than
the configured maximum.

`max_attempts` is copied onto each delivery when it is created, so configuration
changes never alter the budget of deliveries already in flight.

### Scheduling

A retry is a `WEBHOOK_DELIVERY_REQUESTED` outbox row with
`available_at = next_attempt_at`, written in the same transaction as the attempt
record (see ADR 006). There are no long-lived delayed jobs in Redis.

### Leases and attempt records

1. **Claim:** a single conditional update, so only one worker can succeed:

   ```sql
   UPDATE webhook_deliveries
      SET status = 'PROCESSING', lease_owner = $me,
          lease_expires_at = now + lease, attempt_count = attempt_count + 1
    WHERE id = $1 AND status = 'PENDING' AND next_attempt_at <= now
   ```

   The lease is the request timeout plus a safety margin, so a healthy worker
   always finishes well within it.

2. **Send** outside any transaction.
3. **Finalise** in one transaction: update the delivery only
   `WHERE status = 'PROCESSING' AND lease_owner = $me`, insert the attempt row, and
   insert the retry's outbox row. If the guarded update matches nothing, the
   transaction rolls back and the result is discarded (`LEASE_LOST`).
4. **Recovery:** the sweep finds `PROCESSING` rows whose lease expired. It records
   the attempt as `UNKNOWN` (`LEASE_EXPIRED`) and moves the delivery to `PENDING`, or to
   `DEAD_LETTER` if the budget is spent.

The database enforces the lease shape (`PROCESSING` ⇔ lease owner and expiry set),
one immutable attempt record per attempt number, and that final states never change.

### What the attempt history does and does not guarantee

Each attempt number has at most one immutable record: either the outcome the
worker observed, or `UNKNOWN`. It does **not** claim that every physical HTTP
request was recorded with its result. An `UNKNOWN` attempt may or may not have
reached the receiver.

### Delivery semantics: at-least-once

The unavoidable failure case: the receiver processes the webhook and returns 200,
then the worker crashes (or stalls past its lease) before step 3 commits.
RelayForge cannot know the request succeeded, so it delivers again. **Exactly-once
delivery over HTTP is impossible**, and RelayForge does not claim it.

To make at-least-once safe for receivers, every request for an event carries the
same `webhook-id` (the RelayForge event id) across retries and replays. Receivers
must deduplicate on it. `relayforge-delivery-id` and `relayforge-attempt` headers
are informational.

### Dead letters and replay

Dead-lettered deliveries stay queryable (`GET /v1/deliveries?status=DEAD_LETTER`)
with their full attempt history. `POST /v1/deliveries/:id/replay` creates a **new**
delivery that references the original and re-sends the same payload with the same
`webhook-id`. The original row and its attempts are never modified. At most one
replay of a delivery can be active; a partial unique index enforces this under
concurrency. Replays are audited.

## Consequences

- A receiver that returns 4xx for a transient reason (for example 404 during a
  deploy) is dead-lettered immediately. Operators can replay it, or configure
  additional retryable statuses.
- Redirects must be fixed at the source by updating the endpoint URL; following
  them would bypass the SSRF checks performed for the original host.
- Duplicates are possible by design. They are bounded to crashes and lease expiries,
  and are identifiable by `webhook-id`.
