import type { PaymentEvent } from '../providers/payment-event';
import { decide, type TransactionSnapshot } from './payment-state-machine';

const succeeded: PaymentEvent = {
  type: 'payment.succeeded',
  paymentId: 'pay_1',
  amountMinor: 1000n,
  currency: 'USD',
};
const failed: PaymentEvent = {
  type: 'payment.failed',
  paymentId: 'pay_1',
  amountMinor: 1000n,
  currency: 'USD',
  failureCode: 'card_declined',
};
const refund = (amountMinor: bigint, currency = 'USD'): PaymentEvent => ({
  type: 'payment.refunded',
  paymentId: 'pay_1',
  refundId: 're_1',
  amountMinor,
  currency,
});

const snapshot = (overrides: Partial<TransactionSnapshot> = {}): TransactionSnapshot => ({
  status: 'SUCCEEDED',
  amountMinor: 1000n,
  refundedAmountMinor: 0n,
  currency: 'USD',
  ...overrides,
});

const fresh = { refundAlreadyRecorded: false };

describe('payment state machine', () => {
  describe('payment.succeeded', () => {
    it('creates a SUCCEEDED transaction with a capture journal', () => {
      expect(decide(null, succeeded, fresh)).toEqual({
        outcome: 'create',
        status: 'SUCCEEDED',
        journal: {
          kind: 'PAYMENT_CAPTURED',
          externalReferenceId: 'pay_1',
          amountMinor: 1000n,
          currency: 'USD',
        },
      });
    });

    it('moves a FAILED transaction to SUCCEEDED with a capture journal', () => {
      expect(decide(snapshot({ status: 'FAILED' }), succeeded, fresh)).toMatchObject({
        outcome: 'update',
        status: 'SUCCEEDED',
        refundedAmountMinor: 0n,
        journal: { kind: 'PAYMENT_CAPTURED' },
      });
    });

    it.each(['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const)(
      'rejects a second capture of a %s transaction',
      (status) => {
        expect(decide(snapshot({ status }), succeeded, fresh)).toEqual({
          outcome: 'reject',
          reason: 'INVALID_TRANSITION',
        });
      },
    );

    it('rejects a late success whose amount differs from the failed payment', () => {
      expect(decide(snapshot({ status: 'FAILED', amountMinor: 900n }), succeeded, fresh)).toEqual({
        outcome: 'reject',
        reason: 'AMOUNT_MISMATCH',
      });
    });

    it('rejects a late success whose currency differs from the failed payment', () => {
      expect(decide(snapshot({ status: 'FAILED', currency: 'EUR' }), succeeded, fresh)).toEqual({
        outcome: 'reject',
        reason: 'CURRENCY_MISMATCH',
      });
    });
  });

  describe('payment.failed', () => {
    it('creates a FAILED transaction without touching the ledger', () => {
      expect(decide(null, failed, fresh)).toEqual({
        outcome: 'create',
        status: 'FAILED',
        journal: null,
      });
    });

    it('changes nothing when the transaction already failed', () => {
      expect(decide(snapshot({ status: 'FAILED' }), failed, fresh)).toEqual({
        outcome: 'no-change',
      });
    });

    it.each(['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const)(
      'rejects failing a %s transaction',
      (status) => {
        expect(decide(snapshot({ status }), failed, fresh)).toEqual({
          outcome: 'reject',
          reason: 'INVALID_TRANSITION',
        });
      },
    );
  });

  describe('payment.refunded', () => {
    it('retries later when the payment has not been seen yet', () => {
      expect(decide(null, refund(100n), fresh)).toEqual({
        outcome: 'retry-later',
        reason: 'TRANSACTION_NOT_FOUND',
      });
    });

    it('records a partial refund', () => {
      expect(decide(snapshot(), refund(400n), fresh)).toEqual({
        outcome: 'update',
        status: 'PARTIALLY_REFUNDED',
        refundedAmountMinor: 400n,
        journal: {
          kind: 'PAYMENT_REFUNDED',
          externalReferenceId: 're_1',
          amountMinor: 400n,
          currency: 'USD',
        },
      });
    });

    it('completes a refund when the remaining amount is refunded', () => {
      expect(
        decide(
          snapshot({ status: 'PARTIALLY_REFUNDED', refundedAmountMinor: 400n }),
          refund(600n),
          fresh,
        ),
      ).toMatchObject({ outcome: 'update', status: 'REFUNDED', refundedAmountMinor: 1000n });
    });

    it('rejects a refund larger than the remaining captured amount', () => {
      expect(
        decide(
          snapshot({ status: 'PARTIALLY_REFUNDED', refundedAmountMinor: 400n }),
          refund(601n),
          fresh,
        ),
      ).toEqual({ outcome: 'reject', reason: 'REFUND_EXCEEDS_CAPTURED' });
      expect(
        decide(snapshot({ status: 'REFUNDED', refundedAmountMinor: 1000n }), refund(1n), fresh),
      ).toEqual({ outcome: 'reject', reason: 'REFUND_EXCEEDS_CAPTURED' });
    });

    it('rejects the same refund id arriving again under a different event id', () => {
      expect(decide(snapshot(), refund(100n), { refundAlreadyRecorded: true })).toEqual({
        outcome: 'reject',
        reason: 'DUPLICATE_REFUND',
      });
    });

    it('rejects refunding a failed payment', () => {
      expect(decide(snapshot({ status: 'FAILED' }), refund(100n), fresh)).toEqual({
        outcome: 'reject',
        reason: 'INVALID_TRANSITION',
      });
    });

    it('rejects a refund in a different currency', () => {
      expect(decide(snapshot(), refund(100n, 'EUR'), fresh)).toEqual({
        outcome: 'reject',
        reason: 'CURRENCY_MISMATCH',
      });
    });
  });
});
