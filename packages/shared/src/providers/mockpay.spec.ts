import { parseMockPayEvent } from './mockpay';

const succeeded = {
  id: 'evt_1',
  type: 'payment.succeeded',
  created_at: '2026-09-15T10:00:00Z',
  data: { payment_id: 'pay_1', amount: 1999, currency: 'USD', customer_id: 'cus_1' },
};

const body = (value: unknown) => JSON.stringify(value);

describe('parseMockPayEvent', () => {
  it('parses a payment.succeeded event', () => {
    const result = parseMockPayEvent(body(succeeded));

    expect(result).toEqual({
      ok: true,
      json: succeeded,
      event: {
        id: 'evt_1',
        type: 'payment.succeeded',
        createdAt: '2026-09-15T10:00:00Z',
        data: { payment_id: 'pay_1', amount: 1999, currency: 'USD', customer_id: 'cus_1' },
      },
    });
  });

  it('parses payment.failed and payment.refunded events', () => {
    const failed = parseMockPayEvent(
      body({
        ...succeeded,
        type: 'payment.failed',
        data: { payment_id: 'pay_1', amount: 1999, currency: 'USD', failure_code: 'card_declined' },
      }),
    );
    const refunded = parseMockPayEvent(
      body({
        ...succeeded,
        type: 'payment.refunded',
        data: { refund_id: 're_1', payment_id: 'pay_1', amount: 500, currency: 'USD' },
      }),
    );

    expect(failed.ok).toBe(true);
    expect(refunded.ok).toBe(true);
  });

  it('accepts bytes as well as strings', () => {
    expect(parseMockPayEvent(Buffer.from(body(succeeded))).ok).toBe(true);
  });

  it('accepts a well-formed event of an unknown type and marks it unknown', () => {
    const result = parseMockPayEvent(
      body({ ...succeeded, type: 'customer.created', data: { customer_id: 'cus_1' } }),
    );

    expect(result).toMatchObject({
      ok: true,
      event: { type: 'customer.created', known: false, data: { customer_id: 'cus_1' } },
    });
  });

  it('reports invalid JSON', () => {
    expect(parseMockPayEvent('{"id": ')).toEqual({
      ok: false,
      issues: [{ path: '', message: 'Body is not valid JSON' }],
    });
  });

  it.each([
    ['a missing id', { ...succeeded, id: undefined }, 'id'],
    ['a non-ISO timestamp', { ...succeeded, created_at: 'yesterday' }, 'created_at'],
    ['a non-object data field', { ...succeeded, data: 'x' }, 'data'],
    ['a JSON array body', [succeeded], ''],
  ])('rejects %s in the envelope', (_label, value, path) => {
    const result = parseMockPayEvent(body(value));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toContain(path);
  });

  it.each([
    ['a negative amount', { amount: -5 }, 'data.amount'],
    ['a fractional amount', { amount: 19.99 }, 'data.amount'],
    ['an amount beyond safe integer precision', { amount: 2 ** 60 }, 'data.amount'],
    ['a lowercase currency', { currency: 'usd' }, 'data.currency'],
    ['a missing payment id', { payment_id: undefined }, 'data.payment_id'],
  ])('rejects %s in payment data', (_label, override, path) => {
    const result = parseMockPayEvent(
      body({ ...succeeded, data: { ...succeeded.data, ...override } }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toEqual([path]);
  });

  it('never echoes field values in issue messages', () => {
    const result = parseMockPayEvent(
      body({ ...succeeded, data: { ...succeeded.data, currency: 'secret-looking-value' } }),
    );

    expect(JSON.stringify(result)).not.toContain('secret-looking-value');
  });
});
