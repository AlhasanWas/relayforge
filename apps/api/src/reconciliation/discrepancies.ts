import { TransactionStatus } from '../generated/prisma/client';

export const DiscrepancyType = {
  /** A captured payment has no capture journal. */
  MISSING_LEDGER_ENTRY: 'MISSING_LEDGER_ENTRY',
  /** A payment has more than one capture journal. */
  DUPLICATE_LEDGER_ENTRY: 'DUPLICATE_LEDGER_ENTRY',
  /** Journal amounts disagree with the transaction's amount or refunded amount. */
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  /** A journal's currency differs from its transaction's currency. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  /** Refund journals where the transaction records no refund, or refunds exceed the capture. */
  UNEXPECTED_REVERSAL: 'UNEXPECTED_REVERSAL',
  /** Journals for a failed payment, or for an event that was never successfully processed. */
  ORPHAN_ENTRY: 'ORPHAN_ENTRY',
  /** Debits and credits differ, or a journal has fewer than two postings. */
  UNBALANCED_JOURNAL: 'UNBALANCED_JOURNAL',
  /** An account's balance differs from the total implied by the transactions. */
  ACCOUNT_BALANCE_MISMATCH: 'ACCOUNT_BALANCE_MISMATCH',
} as const;

export type DiscrepancyType = (typeof DiscrepancyType)[keyof typeof DiscrepancyType];

export interface Discrepancy {
  readonly type: DiscrepancyType;
  readonly detail: string;
  readonly transactionId?: string;
  readonly ledgerTransactionId?: string;
  readonly accountCode?: string;
  readonly currency?: string;
  /** Amounts are integer minor units as strings. */
  readonly expectedMinor?: string;
  readonly actualMinor?: string;
}

/** Aggregated ledger facts for one domain transaction, as returned by SQL. */
export interface TransactionLedgerRow {
  readonly transactionId: string;
  readonly status: TransactionStatus;
  readonly currency: string;
  readonly amountMinor: bigint;
  readonly refundedAmountMinor: bigint;
  readonly captureJournals: bigint;
  readonly capturedMinor: bigint;
  readonly refundJournals: bigint;
  readonly refundedJournalMinor: bigint;
  readonly currencyMismatch: boolean;
}

/**
 * Compares a transaction with its journals. Pure, so every rule is unit-tested; the
 * SQL only narrows the rows to those that might be inconsistent.
 */
export function transactionDiscrepancies(row: TransactionLedgerRow): Discrepancy[] {
  const found: Discrepancy[] = [];
  const base = { transactionId: row.transactionId, currency: row.currency };
  const journalCount = row.captureJournals + row.refundJournals;

  if (row.currencyMismatch) {
    found.push({
      ...base,
      type: DiscrepancyType.CURRENCY_MISMATCH,
      detail: 'A journal is recorded in a different currency than its transaction',
    });
  }

  if (row.status === TransactionStatus.FAILED) {
    if (journalCount > 0n) {
      found.push({
        ...base,
        type: DiscrepancyType.ORPHAN_ENTRY,
        detail: 'A failed payment has ledger journals; failed payments move no money',
        actualMinor: (row.capturedMinor + row.refundedJournalMinor).toString(),
      });
    }
    return found;
  }

  if (row.captureJournals === 0n) {
    found.push({
      ...base,
      type: DiscrepancyType.MISSING_LEDGER_ENTRY,
      detail: 'A captured payment has no capture journal',
      expectedMinor: row.amountMinor.toString(),
      actualMinor: '0',
    });
  } else if (row.captureJournals > 1n) {
    found.push({
      ...base,
      type: DiscrepancyType.DUPLICATE_LEDGER_ENTRY,
      detail: `The payment has ${row.captureJournals} capture journals; exactly one is expected`,
      expectedMinor: row.amountMinor.toString(),
      actualMinor: row.capturedMinor.toString(),
    });
  } else if (row.capturedMinor !== row.amountMinor) {
    found.push({
      ...base,
      type: DiscrepancyType.AMOUNT_MISMATCH,
      detail: 'The capture journal amount differs from the transaction amount',
      expectedMinor: row.amountMinor.toString(),
      actualMinor: row.capturedMinor.toString(),
    });
  }

  const unexpectedReversal =
    (row.refundJournals > 0n && row.status === TransactionStatus.SUCCEEDED) ||
    row.refundedJournalMinor > row.capturedMinor;
  if (unexpectedReversal) {
    found.push({
      ...base,
      type: DiscrepancyType.UNEXPECTED_REVERSAL,
      detail:
        row.refundedJournalMinor > row.capturedMinor
          ? 'Refund journals exceed the captured amount'
          : 'Refund journals exist but the transaction records no refund',
      expectedMinor: row.refundedAmountMinor.toString(),
      actualMinor: row.refundedJournalMinor.toString(),
    });
  } else if (row.refundedJournalMinor !== row.refundedAmountMinor) {
    found.push({
      ...base,
      type: DiscrepancyType.AMOUNT_MISMATCH,
      detail: 'Refund journals do not add up to the transaction refunded amount',
      expectedMinor: row.refundedAmountMinor.toString(),
      actualMinor: row.refundedJournalMinor.toString(),
    });
  }

  return found;
}
