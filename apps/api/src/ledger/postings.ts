import {
  LedgerAccountType,
  LedgerTransactionKind,
  PostingDirection,
} from '../generated/prisma/client';

/**
 * The minimal chart of accounts, per workspace and currency:
 *
 * - `provider_clearing` (asset): money the payment provider has collected on our
 *   behalf and owes us.
 * - `merchant_balance` (liability): money we owe the merchant.
 */
export const LEDGER_ACCOUNTS = {
  provider_clearing: LedgerAccountType.ASSET,
  merchant_balance: LedgerAccountType.LIABILITY,
} as const;

export type LedgerAccountCode = keyof typeof LEDGER_ACCOUNTS;

export interface PostingLine {
  readonly account: LedgerAccountCode;
  readonly direction: PostingDirection;
  readonly amountMinor: bigint;
}

export class UnbalancedJournalError extends Error {
  constructor(debits: bigint, credits: bigint) {
    super(`Journal is unbalanced: debits ${debits}, credits ${credits}`);
    this.name = 'UnbalancedJournalError';
  }
}

/**
 * The postings for a journal kind:
 *
 * | Kind             | Debit             | Credit            |
 * | ---------------- | ----------------- | ----------------- |
 * | PAYMENT_CAPTURED | provider_clearing | merchant_balance  |
 * | PAYMENT_REFUNDED | merchant_balance  | provider_clearing |
 */
export function buildPostings(kind: LedgerTransactionKind, amountMinor: bigint): PostingLine[] {
  if (amountMinor <= 0n) {
    throw new RangeError(`Journal amount must be positive, received ${amountMinor}`);
  }
  const [debit, credit]: [LedgerAccountCode, LedgerAccountCode] =
    kind === LedgerTransactionKind.PAYMENT_CAPTURED
      ? ['provider_clearing', 'merchant_balance']
      : ['merchant_balance', 'provider_clearing'];

  const lines: PostingLine[] = [
    { account: debit, direction: PostingDirection.DEBIT, amountMinor },
    { account: credit, direction: PostingDirection.CREDIT, amountMinor },
  ];
  assertBalanced(lines);
  return lines;
}

/**
 * Application-side balance check, run before anything is written. PostgreSQL
 * re-checks the same rule with a deferred constraint trigger at COMMIT.
 */
export function assertBalanced(lines: readonly PostingLine[]): void {
  let debits = 0n;
  let credits = 0n;
  for (const line of lines) {
    if (line.direction === PostingDirection.DEBIT) {
      debits += line.amountMinor;
    } else {
      credits += line.amountMinor;
    }
  }
  if (lines.length < 2 || debits !== credits) {
    throw new UnbalancedJournalError(debits, credits);
  }
}
