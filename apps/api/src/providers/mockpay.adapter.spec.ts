import { MockPayAdapter } from './mockpay.adapter';
import { ProviderAdapterRegistry } from './provider-adapter.registry';

const body = (value: unknown) => Buffer.from(JSON.stringify(value));

const event = {
  id: 'evt_1',
  type: 'payment.succeeded',
  created_at: '2026-09-15T10:00:00Z',
  data: { payment_id: 'pay_1', amount: 1999, currency: 'USD' },
};

describe('MockPayAdapter', () => {
  const adapter = new MockPayAdapter();

  it('accepts a valid event whose id matches the signed message id', () => {
    expect(adapter.parsePayload(body(event), 'evt_1')).toEqual({
      ok: true,
      event: { externalEventId: 'evt_1', eventType: 'payment.succeeded', payload: event },
    });
  });

  it('rejects an event whose id differs from the signed message id', () => {
    expect(adapter.parsePayload(body(event), 'evt_other')).toEqual({
      ok: false,
      issues: [{ path: 'id', message: 'must equal the signed webhook-id header' }],
    });
  });

  it('passes schema issues through', () => {
    const result = adapter.parsePayload(
      body({ ...event, data: { ...event.data, amount: 0 } }),
      'evt_1',
    );

    expect(result.ok).toBe(false);
  });

  it('never exposes the signature header for diagnostics', () => {
    expect(adapter.diagnosticHeaderNames).not.toContain('webhook-signature');
  });
});

describe('ProviderAdapterRegistry', () => {
  it('resolves the adapter for each provider type', () => {
    const mockPay = new MockPayAdapter();

    expect(new ProviderAdapterRegistry(mockPay).get('MOCKPAY')).toBe(mockPay);
  });

  it('refuses to start when an adapter type has no implementation', () => {
    expect(() => ProviderAdapterRegistry.index([])).toThrow(
      /No provider adapter registered for: MOCKPAY/,
    );
  });
});

describe('MockPayAdapter.normalizeEvent', () => {
  const adapter = new MockPayAdapter();

  it('maps payment events to provider-neutral facts with bigint amounts', () => {
    expect(adapter.normalizeEvent(event)).toEqual({
      kind: 'payment',
      event: { type: 'payment.succeeded', paymentId: 'pay_1', amountMinor: 1999n, currency: 'USD' },
    });
    expect(
      adapter.normalizeEvent({
        ...event,
        type: 'payment.refunded',
        data: { refund_id: 're_1', payment_id: 'pay_1', amount: 500, currency: 'USD' },
      }),
    ).toEqual({
      kind: 'payment',
      event: {
        type: 'payment.refunded',
        paymentId: 'pay_1',
        refundId: 're_1',
        amountMinor: 500n,
        currency: 'USD',
      },
    });
  });

  it('marks well-formed events of other types as unsupported', () => {
    expect(adapter.normalizeEvent({ ...event, type: 'customer.created', data: {} })).toEqual({
      kind: 'unsupported',
    });
  });

  it('reports a stored payload that no longer matches the schema', () => {
    expect(adapter.normalizeEvent({ id: 'evt_1' })).toMatchObject({ kind: 'invalid' });
  });
});
