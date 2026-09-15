# ADR 006: Transactional outbox between PostgreSQL and BullMQ

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

Work flows through asynchronous stages: an accepted webhook must be processed,
and a processed event must be delivered. The state lives in PostgreSQL; the
execution transport is BullMQ on Redis. Writing to the database and then
enqueueing to Redis is a **dual write**. If the process crashes, or Redis is
unavailable, between the commit and the enqueue, committed state exists with no
work scheduled for it, silently.

A periodic "find stuck rows" sweep can repair this, but it makes latency depend
on the sweep interval and the sweep's correctness, and every new kind of work
needs its own repair query.

## Decision

Use a **transactional outbox**:

| Layer      | Role                     |
| ---------- | ------------------------ |
| PostgreSQL | Source of truth          |
| Outbox     | Durable handoff boundary |
| BullMQ     | Execution transport      |

1. **Write:** every state change that requires work inserts an `outbox_messages`
   row (`topic`, `aggregate_id`, `available_at`) **in the same database
   transaction**. The API offers no way to write an outbox message outside a
   caller's transaction. Ingestion commits the event and
   `EVENT_PROCESSING_REQUESTED` together; processing commits the domain changes,
   the deliveries and `WEBHOOK_DELIVERY_REQUESTED` together.
2. **Publish:** every worker replica runs a publisher loop. Each iteration claims
   due rows (`published_at IS NULL AND available_at <= now`) with
   `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, setting a
   `lease_owner` and `lease_expires_at`. It enqueues them with
   `addBulk`, using **job id = outbox message id**, then sets `published_at`, but
   only for rows it still leases and only after Redis acknowledged the enqueue.
3. **Fail:** if the enqueue fails or times out (BullMQ waits for a connection
   instead of failing, so every publish is bounded by a timeout), the lease is
   released and `available_at` moves forward by exponential backoff with jitter.
   `publish_attempts` and `last_error` record what happened.
4. **Consume:** jobs carry only `{ outboxMessageId, aggregateId }`. Consumers load
   state from PostgreSQL and transition it conditionally, so running a job twice
   is harmless.

**Scheduling lives in PostgreSQL.** A delayed retry is an outbox row with a
future `available_at`, not a delayed BullMQ job. A Redis flush cannot erase a
retry schedule.

## Failure analysis

| Failure                                       | Result                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Crash before commit                           | Nothing was committed, so there is nothing to lose                                                                                                                       |
| Redis down at commit time                     | Commit succeeds (no Redis in the transaction); the row publishes after recovery                                                                                          |
| Crash after enqueue, before marking published | The lease expires, another publisher republishes. BullMQ ignores the existing job id; if the job was already removed, the consumer's state check makes the rerun a no-op |
| Two publishers poll at once                   | `SKIP LOCKED` gives them disjoint rows; tested with concurrent publishers                                                                                                |
| Redis loses a published job                   | The recovery sweep (defence in depth) creates a new outbox row for work stuck in a non-final state                                                                       |

## Consequences

- Accepting a webhook needs only PostgreSQL, so ingestion survives Redis outages.
- The median publish latency is bounded by the poll interval (500 ms by default).
  A backlog drains without waiting, because a full batch triggers an immediate
  next poll.
- Every job is at-least-once, so consumers must stay idempotent. This is the
  contract anyway: BullMQ itself can re-run stalled jobs.
- Published rows are retained briefly and pruned by the recovery sweep; the
  outbox is a handoff mechanism, not an audit history.

## Alternatives considered

- **Enqueue after commit, sweep for stragglers.** Simpler, but the queue becomes
  the place work can silently disappear, and repair depends on a per-feature query.
- **PostgreSQL `LISTEN/NOTIFY` to wake the publisher.** It would cut latency, but
  notifications are not durable, so polling would still be required. Future
  improvement, not a replacement.
- **Change data capture (Debezium, logical replication).** Robust, but adds
  infrastructure out of proportion to this system.
- **A database-backed queue only (no Redis).** Viable at this scale. BullMQ was
  kept for its worker concurrency, stalled-job detection and operational tooling.
