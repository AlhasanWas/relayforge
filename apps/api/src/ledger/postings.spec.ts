import { assertBalanced, buildPostings, UnbalancedJournalError } from './postings';

describe('buildPostings', () => {
  it('debits provider clearing and credits the merchant balance for a capture', () => {
    expect(buildPostings('PAYMENT_CAPTURED', 1999n)).toEqual([
      { account: 'provider_clearing', direction: 'DEBIT', amountMinor: 1999n },
      { account: 'merchant_balance', direction: 'CREDIT', amountMinor: 1999n },
    ]);
  });

  it('reverses the accounts for a refund', () => {
    expect(buildPostings('PAYMENT_REFUNDED', 500n)).toEqual([
      { account: 'merchant_balance', direction: 'DEBIT', amountMinor: 500n },
      { account: 'provider_clearing', direction: 'CREDIT', amountMinor: 500n },
    ]);
  });

  it('nets to zero on each account after a full refund', () => {
    const lines = [
      ...buildPostings('PAYMENT_CAPTURED', 1000n),
      ...buildPostings('PAYMENT_REFUNDED', 1000n),
    ];
    const net = (account: string) =>
      lines
        .filter((line) => line.account === account)
        .reduce(
          (sum, line) => sum + (line.direction === 'DEBIT' ? line.amountMinor : -line.amountMinor),
          0n,
        );

    expect(net('provider_clearing')).toBe(0n);
    expect(net('merchant_balance')).toBe(0n);
  });

  it.each([0n, -1n])('rejects a non-positive amount %p', (amount) => {
    expect(() => buildPostings('PAYMENT_CAPTURED', amount)).toThrow(RangeError);
  });
});

describe('assertBalanced', () => {
  it('rejects unequal debits and credits', () => {
    expect(() => {
      assertBalanced([
        { account: 'provider_clearing', direction: 'DEBIT', amountMinor: 1000n },
        { account: 'merchant_balance', direction: 'CREDIT', amountMinor: 999n },
      ]);
    }).toThrow(UnbalancedJournalError);
  });

  it('rejects a journal with fewer than two postings', () => {
    expect(() => {
      assertBalanced([]);
    }).toThrow(UnbalancedJournalError);
  });
});
