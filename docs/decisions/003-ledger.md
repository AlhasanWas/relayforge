# ADR 003: Minimal double-entry ledger

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

RelayForge records money movements from payment events. A single-entry "ledger"
(one signed row per event) is easy to build, but it is not a ledger in the
accounting sense. It cannot express where money moved from and to, and nothing
forces the books to balance. Reviewers with payments experience will rightly
treat it as a log.

The goal is a _minimal_ but genuine double-entry model, not an accounting system.

## Decision

**Model.**

- `ledger_accounts`: `(workspace, code, currency)` is unique; `type` is `ASSET`
  or `LIABILITY`.
- `ledger_transactions`: journal header. It references the domain transaction and
  the source event (`UNIQUE`), with `kind` and the provider reference (payment or
  refund id).
- `ledger_postings`: `DEBIT` or `CREDIT`, positive `BIGINT` minor units, currency.

**Chart of accounts** (per workspace and currency, created on first use):

| Code                | Type      | Meaning                               |
| ------------------- | --------- | ------------------------------------- |
| `provider_clearing` | ASSET     | Collected by the provider, owed to us |
| `merchant_balance`  | LIABILITY | Owed to the merchant                  |

| Journal kind       | Debit               | Credit              |
| ------------------ | ------------------- | ------------------- |
| `PAYMENT_CAPTURED` | `provider_clearing` | `merchant_balance`  |
| `PAYMENT_REFUNDED` | `merchant_balance`  | `provider_clearing` |

A failed payment creates a domain transaction and no journal.

**Invariants and where they are enforced.**

| Invariant                                                | Enforcement                                                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Σ debits = Σ credits per journal                         | `assertBalanced` before writing; **deferred constraint trigger** at `COMMIT`    |
| At least two postings                                    | Same deferred trigger                                                           |
| Postings only added in the journal's own transaction     | `BEFORE INSERT` trigger comparing the header's `xmin` to `pg_current_xact_id()` |
| Journal and posting currency equal the account currency  | Composite foreign keys `(id, workspace_id, currency)`                           |
| Journals, postings and accounts are append-only          | `BEFORE UPDATE OR DELETE` triggers                                              |
| Positive amounts                                         | `CHECK (amount_minor > 0)`                                                      |
| One journal per source event; a refund id journaled once | `UNIQUE` constraints                                                            |

### Why enforce the balance in PostgreSQL

The balance is a cross-row property, which a `CHECK` constraint cannot express. A
`CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` evaluates it when the
transaction commits, after all postings exist. Its cost is one indexed aggregate
per posting, paid only on writes, and in exchange no code path (a bug, a script,
a manual `psql` session) can commit an unbalanced journal. The balance check alone
would still accept a _balanced pair_ appended to an existing journal, so a second
trigger rejects postings for journals created by an earlier transaction.

A consequence worth knowing: journals must not be written inside a savepoint,
because rows written in a subtransaction carry a different `xmin`. The processor
does not use savepoints.

## Consequences

- Balances are always derivable from postings; `GET /v1/ledger/balances`
  aggregates in SQL.
- The domain `transactions` table is a mutable view (status, refunded amount); the
  ledger is the immutable history. Reconciliation (Phase 6) checks that they agree.
- Deliberately out of scope: fees, payouts and settlement, FX, multi-currency
  journals, reversing entries for corrections, and a configurable chart of accounts.
