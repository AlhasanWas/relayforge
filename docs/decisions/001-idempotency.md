# ADR 001: Idempotent webhook ingestion

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

Payment providers deliver webhooks at least once. The same event arrives again
when the provider times out, retries after a network error, or replays history,
and those copies can arrive at the same moment on different API instances. Each
event must affect financial state exactly once.

A common implementation is _SELECT, then INSERT if missing_. Under concurrency
it is broken: two requests both see "missing" and both insert. Application locks
do not help across processes, and a distributed lock adds a dependency that can
fail open.

## Decision

**The database decides.** `incoming_events` has
`UNIQUE (provider_connection_id, external_event_id)`, and ingestion inserts with
`INSERT … ON CONFLICT DO NOTHING RETURNING id` (Prisma `createManyAndReturn` with
`skipDuplicates`), in one transaction with the event's outbox message.

- **Inserted:** the event and its `EVENT_PROCESSING_REQUESTED` outbox message
  commit together, and the response is `202 { eventId, duplicate: false }`.
- **Nothing inserted:** another request already owns the key. PostgreSQL makes
  the losing insert wait for the winner's transaction, so the follow-up `SELECT`
  sees the committed row. If `payload_hash` (SHA-256 of the raw body) matches, the
  response is `202 { eventId, duplicate: true }`. The same status for the same
  request keeps provider retries simple.
- **Same id, different bytes:** `409 EVENT_PAYLOAD_CONFLICT`. The stored event is
  never changed or merged, and the attempt is recorded as `PAYLOAD_CONFLICT`.

**Scope is the provider connection.** Provider event ids are only unique per
provider account, and two workspaces may connect to the same provider.

**Only authenticated events take part.** Signature verification and payload
validation happen before the insert. Rejected requests go to
`rejected_webhook_attempts`, which has no uniqueness on external ids. So a
forged request cannot reserve an event id and block the genuine event.

**Downstream steps have their own keys.** Ingestion idempotency prevents
duplicate _events_. Processing adds further database guarantees: a row lock on
the event, one ledger transaction per source event, one domain transaction per
provider payment, and one original delivery per event and endpoint.

## Why ON CONFLICT rather than catching the unique violation

Both are correct. `ON CONFLICT DO NOTHING` was chosen because:

- A unique violation aborts the enclosing PostgreSQL transaction, so the event
  and outbox writes would have to be restructured around the failure.
- Expected duplicates would show up in database error logs and metrics as errors.
- The code expresses the intent directly instead of using exceptions for control
  flow.

## Consequences

- Correctness does not depend on Redis, caches or timing, and holds across any
  number of API instances. An integration test fires 25 identical signed requests
  concurrently and asserts one event, one outbox message and exactly one
  non-duplicate response.
- `payload_hash` covers the raw bytes, not canonical JSON. A provider that
  re-serialises an identical event with different whitespace or key order gets a
  `409`. That is the honest outcome, because the signature also covers raw bytes.
- The stored `payload` is JSONB, so key order and whitespace are not preserved;
  the hash is the record of the exact bytes.
