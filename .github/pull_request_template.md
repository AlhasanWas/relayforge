## Description

Briefly describe the change, the problem it solves, and the technical approach taken.

## Related Issues & ADRs

- Fixes #
- Relevant ADR: `docs/decisions/00X-...`

## Architectural Invariant Checklist

Please verify the following senior engineering invariants before requesting review:

- [ ] **Dual-Write Safety:** Work scheduled across process boundaries is committed through the Transactional Outbox table (`outbox_messages`).
- [ ] **Ledger Integrity:** Any modified or new journal posting balances ($\sum \text{Debits} = \sum \text{Credits}$) with $\ge 2$ postings and obeys the PostgreSQL deferred constraint triggers.
- [ ] **Idempotency & Concurrency:** Concurrency is handled cleanly via `ON CONFLICT` and/or advisory locks.
- [ ] **Network Isolation:** Outbound HTTP calls execute strictly outside database transactions.
- [ ] **SSRF & Security:** Any outbound network destination passes the `guardedLookup` DNS filter.
- [ ] **Tests:** New edge cases and concurrent failure modes are covered by integration tests.

## Verification Steps

Detail the commands or steps taken to verify this PR locally:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```
