import { type TransactionLedgerRow, transactionDiscrepancies } from './discrepancies';

const consistent: TransactionLedgerRow = {
  transactionId: 'tx_1',
  status: 'PARTIALLY_REFUNDED',
  currency: 'USD',
  amountMinor: 1000n,
  refundedAmountMinor: 300n,
  captureJournals: 1n,
  capturedMinor: 1000n,
  refundJournals: 1n,
  refundedJournalMinor: 300n,
  currencyMismatch: false,
};

const types = (row: Partial<TransactionLedgerRow>) =>
  transactionDiscrepancies({ ...consistent, ...row }).map((discrepancy) => discrepancy.type);

describe('transactionDiscrepancies', () => {
  it('finds nothing for a consistent transaction', () => {
    expect(transactionDiscrepancies(consistent)).toEqual([]);
    expect(
      types({
        status: 'SUCCEEDED',
        refundedAmountMinor: 0n,
        refundJournals: 0n,
        refundedJournalMinor: 0n,
      }),
    ).toEqual([]);
    expect(
      types({
        status: 'FAILED',
        refundedAmountMinor: 0n,
        captureJournals: 0n,
        capturedMinor: 0n,
        refundJournals: 0n,
        refundedJournalMinor: 0n,
      }),
    ).toEqual([]);
  });

  it('reports a missing capture journal with expected and actual amounts', () => {
    expect(
      transactionDiscrepancies({
        ...consistent,
        status: 'SUCCEEDED',
        refundedAmountMinor: 0n,
        captureJournals: 0n,
        capturedMinor: 0n,
        refundJournals: 0n,
        refundedJournalMinor: 0n,
      }),
    ).toEqual([
      expect.objectContaining({
        type: 'MISSING_LEDGER_ENTRY',
        transactionId: 'tx_1',
        expectedMinor: '1000',
        actualMinor: '0',
      }),
    ]);
  });

  it('reports a duplicate capture', () => {
    expect(
      types({ captureJournals: 2n, capturedMinor: 2000n, refundedJournalMinor: 300n }),
    ).toContain('DUPLICATE_LEDGER_ENTRY');
  });

  it('reports a capture amount that differs from the transaction', () => {
    expect(types({ capturedMinor: 999n })).toEqual(['AMOUNT_MISMATCH']);
  });

  it('reports refunds that do not add up to the refunded amount', () => {
    expect(types({ refundedAmountMinor: 400n })).toEqual(['AMOUNT_MISMATCH']);
  });

  it('reports refund journals on a transaction that records no refund', () => {
    expect(types({ status: 'SUCCEEDED', refundedAmountMinor: 0n })).toEqual([
      'UNEXPECTED_REVERSAL',
    ]);
  });

  it('reports refund journals exceeding the capture', () => {
    expect(
      types({
        status: 'REFUNDED',
        refundedAmountMinor: 1000n,
        refundJournals: 2n,
        refundedJournalMinor: 1200n,
      }),
    ).toEqual(['UNEXPECTED_REVERSAL']);
  });

  it('reports journals on a failed payment as orphans', () => {
    expect(
      types({
        status: 'FAILED',
        refundedAmountMinor: 0n,
        refundJournals: 0n,
        refundedJournalMinor: 0n,
      }),
    ).toEqual(['ORPHAN_ENTRY']);
  });

  it('reports a journal in a different currency', () => {
    expect(types({ currencyMismatch: true })).toEqual(['CURRENCY_MISMATCH']);
  });
});
