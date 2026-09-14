import { createWebhookHeaders, generateWebhookSecret } from '@relayforge/shared/webhooks';
import { StandardWebhooksVerifier } from './standard-webhooks.verifier';

describe('StandardWebhooksVerifier', () => {
  const verifier = new StandardWebhooksVerifier();
  const secret = generateWebhookSecret();
  const now = new Date('2026-09-15T10:00:00Z');
  const timestamp = Math.floor(now.getTime() / 1000);
  const rawBody = Buffer.from('{"id":"evt_1"}');
  const headers = createWebhookHeaders({ secret, messageId: 'evt_1', timestamp, body: rawBody });

  const verify = (overrides: Record<string, string | string[] | undefined> = {}) =>
    verifier.verify({
      rawBody,
      headers: { ...headers, ...overrides },
      secret,
      now,
      toleranceSeconds: 300,
    });

  it('accepts a valid signature and returns the signed message id', () => {
    expect(verify()).toEqual({ valid: true, messageId: 'evt_1' });
  });

  it.each([
    ['a missing signature header', { 'webhook-signature': undefined }, 'MISSING_SIGNATURE_HEADERS'],
    ['a malformed timestamp', { 'webhook-timestamp': 'soon' }, 'MALFORMED_SIGNATURE_HEADERS'],
    [
      'a repeated signature header',
      { 'webhook-signature': [headers['webhook-signature'], headers['webhook-signature']] },
      'MALFORMED_SIGNATURE_HEADERS',
    ],
    [
      'a wrong signature',
      { 'webhook-signature': `v1,${Buffer.alloc(32).toString('base64')}` },
      'INVALID_SIGNATURE',
    ],
  ])('maps %s to a rejection reason', (_label, override, reason) => {
    expect(verify(override)).toEqual({ valid: false, reason });
  });

  it('reports an authentic but stale request as outside tolerance', () => {
    const result = verifier.verify({
      rawBody,
      headers,
      secret,
      now: new Date(now.getTime() + 301_000),
      toleranceSeconds: 300,
    });

    expect(result).toEqual({ valid: false, reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' });
  });
});
