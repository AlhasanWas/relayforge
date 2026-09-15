# ADR 002: Event processing

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

An accepted webhook must change financial state exactly once, even when:

- the processing job runs more than once (BullMQ retries, stalled jobs, outbox
  republishing);
- two different events for the same payment are processed at the same time;
- the process crashes halfway through;
- events arrive out of order (a refund before its payment).

## Decision

**One database transaction per event.** `EventProcessor.process(eventId)`:

1. `SELECT … FROM incoming_events WHERE id = $1 FOR UPDATE`. A concurrent run of
   the same event blocks here and then finds a final status (`ALREADY_FINAL`).
2. Stops if a _newer_ retry is already scheduled in the outbox for this event
   (`SUPERSEDED`), so a stale duplicate job cannot run a deferred event early.
3. Normalises the stored payload through the provider adapter into
   provider-neutral facts (`PaymentEvent`). Unknown types become `IGNORED`.
4. Takes `pg_advisory_xact_lock(hash(connection, payment id))`. Different events for
   the same payment serialise, so they never race to create or update its
   transaction.
5. Runs the pure state machine `decide(transaction, event)`.
6. Writes the domain `Transaction`, a balanced ledger journal, one
   `WebhookDelivery` plus outbox message per subscribed active endpoint, and the
   final event status.
7. Commits. Deferred balance triggers run here.

No network I/O happens inside the transaction. A crash anywhere rolls back
everything; the event stays `RECEIVED` and runs again.

**State machine.** Pure and exhaustively unit-tested. Outcomes:

- `create` / `update`: apply the change and journal it.
- `no-change`: a valid repeat, such as a second failure notice. The event is
  `PROCESSED` with no deliveries.
- `retry-later`: a refund for a payment not yet seen.
- `reject`: a business rule violation (`INVALID_TRANSITION`, `AMOUNT_MISMATCH`,
  `CURRENCY_MISMATCH`, `REFUND_EXCEEDS_CAPTURED`, `DUPLICATE_REFUND`). The event
  becomes `FAILED` with that reason, and financial state is untouched.

**Waiting for dependencies.** `retry-later` increments `processing_attempts` and
inserts an outbox message with `available_at = now + backoff` in the same
transaction. After `EVENT_PROCESSING_MAX_ATTEMPTS` the event is `FAILED`.

**Unexpected errors** (for example a lost database connection) roll back and
rethrow; BullMQ retries the job a few times. When those attempts are exhausted,
the event is marked `FAILED` with `PROCESSING_ERROR`. A poison event cannot be
retried forever.

## Guarantees and their enforcement

| Guarantee                   | Mechanism               | Backstop                                                                        |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------- |
| An event is applied once    | Row lock + status check | `UNIQUE(ledger_transactions.source_event_id)`; final statuses frozen by trigger |
| One transaction per payment | Advisory lock           | `UNIQUE(provider_connection_id, external_payment_id)`                           |
| A refund is recorded once   | Journal existence check | `UNIQUE(transaction_id, kind, external_reference_id)`                           |
| No partial state            | Single transaction      | Deferred balance triggers at COMMIT                                             |

These are proven by integration tests: 25 concurrent duplicate deliveries with
10 concurrent processing runs yield one transaction, one journal and two
postings; a database failure injected after the ledger writes leaves no rows
behind.

## Consequences

- Throughput per payment is serialised by the advisory lock. That is the correct
  granularity for financial state and does not serialise unrelated payments.
- Webhook payloads delivered to customers are snapshots of the transaction at
  processing time, stored on the delivery row, so retries and replays send
  identical bytes.
