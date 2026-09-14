import { generateIngressKey, isWellFormedIngressKey } from './ingress-key';
import { type IncomingWebhook, isJsonContentType, rejectionMetadata } from './incoming-webhook';

describe('isJsonContentType', () => {
  it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])(
    'accepts %p',
    (value) => {
      expect(isJsonContentType(value)).toBe(true);
    },
  );

  it.each([undefined, 'text/plain', 'application/jsonp', 'application/x-www-form-urlencoded'])(
    'rejects %p',
    (value) => {
      expect(isJsonContentType(value)).toBe(false);
    },
  );
});

describe('rejectionMetadata', () => {
  const webhook: IncomingWebhook = {
    ingressKey: generateIngressKey(),
    rawBody: Buffer.from('{"amount":1}'),
    headers: {
      'webhook-id': 'evt_1',
      'webhook-signature': 'v1,c2VjcmV0',
      authorization: 'Bearer should-not-appear',
      'content-type': 'application/json',
      'user-agent': 'x'.repeat(1000),
    },
    requestId: 'req-1',
    sourceIp: '203.0.113.9',
  };

  it('keeps only diagnostic headers, truncated, and never the body or signature', () => {
    const metadata = rejectionMetadata(webhook, ['webhook-id'], { issues: [] });
    const serialized = JSON.stringify(metadata);

    expect(metadata).toMatchObject({
      headers: { 'webhook-id': 'evt_1', 'content-type': 'application/json' },
      bodyBytes: 12,
      issues: [],
    });
    expect(serialized).not.toContain('c2VjcmV0');
    expect(serialized).not.toContain('should-not-appear');
    expect(serialized).not.toContain('"amount"');
    expect((metadata.headers as Record<string, string>)['user-agent']).toHaveLength(256);
  });
});

describe('ingress keys', () => {
  it('generates well-formed, unique keys', () => {
    const keys = Array.from({ length: 50 }, generateIngressKey);

    expect(keys.every(isWellFormedIngressKey)).toBe(true);
    expect(new Set(keys).size).toBe(50);
  });

  it.each(['', 'ing_short', `key_${'a'.repeat(24)}`, `ing_${'a'.repeat(23)}!`])(
    'rejects %p',
    (value) => {
      expect(isWellFormedIngressKey(value)).toBe(false);
    },
  );
});
