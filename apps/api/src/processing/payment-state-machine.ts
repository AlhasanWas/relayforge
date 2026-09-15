import { LedgerTransactionKind, TransactionStatus } from '../generated/prisma/client';
import type { PaymentEvent } from '../providers/payment-event';

/** The parts of a stored domain transaction the state machine reads. */
export interface TransactionSnapshot {
  readonly status: TransactionStatus;
  readonly amountMinor: bigint;
  readonly refundedAmountMinor: bigint;
  readonly currency: string;
}

export interface JournalRequest {
  readonly kind: LedgerTransactionKind;
  /** Provider payment id or refund id; unique per transaction and kind. */
  readonly externalReferenceId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export type RejectionReason =
  | 'INVALID_TRANSITION'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'REFUND_EXCEEDS_CAPTURED'
  | 'DUPLICATE_REFUND';

export type PaymentDecision =
  | {
      readonly outcome: 'create';
      readonly status: typeof TransactionStatus.SUCCEEDED | typeof TransactionStatus.FAILED;
      readonly journal: JournalRequest | null;
    }
  | {
      readonly outcome: 'update';
      readonly status: TransactionStatus;
      readonly refundedAmountMinor: bigint;
      readonly journal: JournalRequest | null;
    }
  /** Valid, but changes nothing (for example a repeated failure notice). */
  | { readonly outcome: 'no-change' }
  /** Depends on a transaction that has not arrived yet (webhooks can arrive out of order). */
  | { readonly outcome: 'retry-later'; readonly reason: 'TRANSACTION_NOT_FOUND' }
  /** A business rule forbids applying this event. Financial state is left untouched. */
  | { readonly outcome: 'reject'; readonly reason: RejectionReason };

export interface DecisionContext {
  /** Whether a refund journal already exists for this refund id on this transaction. */
  readonly refundAlreadyRecorded: boolean;
}

/**
 * Decides how a payment event changes a domain transaction. Pure: no I/O, no
 * clock, so every transition is exhaustively unit-tested.
 */
export function decide(
  current: TransactionSnapshot | null,
  event: PaymentEvent,
  context: DecisionContext,
): PaymentDecision {
  switch (event.type) {
    case 'payment.succeeded':
      return decideSucceeded(current, event);
    case 'payment.failed':
      return decideFailed(current);
    case 'payment.refunded':
      return decideRefunded(current, event, context);
  }
}

function decideSucceeded(
  current: TransactionSnapshot | null,
  event: Extract<PaymentEvent, { type: 'payment.succeeded' }>,
): PaymentDecision {
  const journal: JournalRequest = {
    kind: LedgerTransactionKind.PAYMENT_CAPTURED,
    externalReferenceId: event.paymentId,
    amountMinor: event.amountMinor,
    currency: event.currency,
  };

  if (current === null) {
    return { outcome: 'create', status: TransactionStatus.SUCCEEDED, journal };
  }
  if (current.status !== TransactionStatus.FAILED) {
    return reject('INVALID_TRANSITION');
  }
  // A payment that failed and later succeeded must still describe the same charge.
  if (current.currency !== event.currency) {
    return reject('CURRENCY_MISMATCH');
  }
  if (current.amountMinor !== event.amountMinor) {
    return reject('AMOUNT_MISMATCH');
  }
  return {
    outcome: 'update',
    status: TransactionStatus.SUCCEEDED,
    refundedAmountMinor: 0n,
    journal,
  };
}

function decideFailed(current: TransactionSnapshot | null): PaymentDecision {
  if (current === null) {
    return { outcome: 'create', status: TransactionStatus.FAILED, journal: null };
  }
  return current.status === TransactionStatus.FAILED
    ? { outcome: 'no-change' }
    : reject('INVALID_TRANSITION');
}

function decideRefunded(
  current: TransactionSnapshot | null,
  event: Extract<PaymentEvent, { type: 'payment.refunded' }>,
  context: DecisionContext,
): PaymentDecision {
  if (current === null) {
    return { outcome: 'retry-later', reason: 'TRANSACTION_NOT_FOUND' };
  }
  if (context.refundAlreadyRecorded) {
    return reject('DUPLICATE_REFUND');
  }
  if (current.status === TransactionStatus.FAILED) {
    return reject('INVALID_TRANSITION');
  }
  if (current.currency !== event.currency) {
    return reject('CURRENCY_MISMATCH');
  }

  const refundedAmountMinor = current.refundedAmountMinor + event.amountMinor;
  if (refundedAmountMinor > current.amountMinor) {
    return reject('REFUND_EXCEEDS_CAPTURED');
  }
  return {
    outcome: 'update',
    status:
      refundedAmountMinor === current.amountMinor
        ? TransactionStatus.REFUNDED
        : TransactionStatus.PARTIALLY_REFUNDED,
    refundedAmountMinor,
    journal: {
      kind: LedgerTransactionKind.PAYMENT_REFUNDED,
      externalReferenceId: event.refundId,
      amountMinor: event.amountMinor,
      currency: event.currency,
    },
  };
}

function reject(reason: RejectionReason): PaymentDecision {
  return { outcome: 'reject', reason };
}
