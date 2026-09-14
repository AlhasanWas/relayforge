import {
  createWebhookHeaders,
  decodeWebhookSecret,
  generateWebhookSecret,
  InvalidWebhookSecretError,
  signWebhook,
  verifyWebhook,
  type VerifyWebhookInput,
} from './standard-webhooks';

// Test vector published with the Standard Webhooks specification.
const SPEC_VECTOR = {
  secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
  messageId: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
  timestamp: 1614265330,
  body: '{"test": 2432232314}',
  signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=',
};

const NOW = new Date(SPEC_VECTOR.timestamp * 1000);

function verificationInput(overrides: Partial<VerifyWebhookInput> = {}): VerifyWebhookInput {
  return {
    secret: SPEC_VECTOR.secret,
    headers: {
      id: SPEC_VECTOR.messageId,
      timestamp: String(SPEC_VECTOR.timestamp),
      signature: SPEC_VECTOR.signature,
    },
    body: SPEC_VECTOR.body,
    now: NOW,
    toleranceSeconds: 300,
    ...overrides,
  };
}

describe('signWebhook', () => {
  it('produces the signature from the specification test vector', () => {
    expect(signWebhook(SPEC_VECTOR)).toBe(SPEC_VECTOR.signature);
  });

  it('signs byte bodies identically to string bodies', () => {
    const fromBytes = signWebhook({ ...SPEC_VECTOR, body: Buffer.from(SPEC_VECTOR.body) });
    expect(fromBytes).toBe(SPEC_VECTOR.signature);
  });

  it('builds the three standard headers', () => {
    expect(createWebhookHeaders(SPEC_VECTOR)).toEqual({
      'webhook-id': SPEC_VECTOR.messageId,
      'webhook-timestamp': '1614265330',
      'webhook-signature': SPEC_VECTOR.signature,
    });
  });
});

describe('verifyWebhook', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyWebhook(verificationInput())).toEqual({
      valid: true,
      messageId: SPEC_VECTOR.messageId,
      timestamp: SPEC_VECTOR.timestamp,
    });
  });

  it('accepts a round trip with a generated secret', () => {
    const secret = generateWebhookSecret();
    const body = Buffer.from('{"id":"evt_1"}');
    const headers = createWebhookHeaders({
      secret,
      messageId: 'evt_1',
      timestamp: SPEC_VECTOR.timestamp,
      body,
    });

    const result = verifyWebhook({
      secret,
      headers: {
        id: headers['webhook-id'],
        timestamp: headers['webhook-timestamp'],
        signature: headers['webhook-signature'],
      },
      body,
      now: NOW,
      toleranceSeconds: 300,
    });

    expect(result.valid).toBe(true);
  });

  it('rejects a modified body', () => {
    const result = verifyWebhook(verificationInput({ body: '{"test": 2432232315}' }));
    expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('binds the message id into the signature', () => {
    const input = verificationInput();
    const result = verifyWebhook({ ...input, headers: { ...input.headers, id: 'msg_other' } });
    expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a signature made with a different secret', () => {
    const result = verifyWebhook(verificationInput({ secret: generateWebhookSecret() }));
    expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it('accepts any matching entry when several signatures are sent during secret rotation', () => {
    const rotated = signWebhook({ ...SPEC_VECTOR, secret: generateWebhookSecret() });
    const input = verificationInput();
    const result = verifyWebhook({
      ...input,
      headers: { ...input.headers, signature: `${rotated} ${SPEC_VECTOR.signature}` },
    });
    expect(result.valid).toBe(true);
  });

  it('ignores entries with other signature versions', () => {
    const base64 = SPEC_VECTOR.signature.slice('v1,'.length);
    const input = verificationInput();
    const result = verifyWebhook({
      ...input,
      headers: { ...input.headers, signature: `v1a,${base64}` },
    });
    expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it.each([
    ['not base64', 'v1,@@@@'],
    ['wrong length', `v1,${Buffer.alloc(16).toString('base64')}`],
    ['no separator', 'v1'],
  ])('rejects a malformed signature entry (%s)', (_label, signature) => {
    const input = verificationInput();
    const result = verifyWebhook({ ...input, headers: { ...input.headers, signature } });
    expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
  });

  it.each(['id', 'timestamp', 'signature'] as const)('rejects a missing %s header', (header) => {
    const input = verificationInput();
    const result = verifyWebhook({ ...input, headers: { ...input.headers, [header]: undefined } });
    expect(result).toEqual({ valid: false, reason: 'MISSING_HEADERS' });
  });

  it.each(['-1614265330', '1614265330.5', 'yesterday', '1'.repeat(13)])(
    'rejects a malformed timestamp %p',
    (timestamp) => {
      const input = verificationInput();
      const result = verifyWebhook({ ...input, headers: { ...input.headers, timestamp } });
      expect(result).toEqual({ valid: false, reason: 'MALFORMED_HEADERS' });
    },
  );

  it('rejects an over-long message id', () => {
    const input = verificationInput();
    const result = verifyWebhook({ ...input, headers: { ...input.headers, id: 'x'.repeat(256) } });
    expect(result).toEqual({ valid: false, reason: 'MALFORMED_HEADERS' });
  });

  describe('timestamp tolerance', () => {
    const at = (offsetSeconds: number): Date =>
      new Date((SPEC_VECTOR.timestamp + offsetSeconds) * 1000);

    it('accepts a timestamp exactly at the tolerance boundary', () => {
      expect(verifyWebhook(verificationInput({ now: at(300) })).valid).toBe(true);
      expect(verifyWebhook(verificationInput({ now: at(-300) })).valid).toBe(true);
    });

    it('rejects an authentic but stale request', () => {
      const result = verifyWebhook(verificationInput({ now: at(301) }));
      expect(result).toEqual({ valid: false, reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' });
    });

    it('rejects a timestamp too far in the future', () => {
      const result = verifyWebhook(verificationInput({ now: at(-301) }));
      expect(result).toEqual({ valid: false, reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' });
    });

    it('skips the check when tolerance is disabled', () => {
      const result = verifyWebhook(verificationInput({ now: at(86_400), toleranceSeconds: null }));
      expect(result.valid).toBe(true);
    });

    it('reports a forged stale request as an invalid signature, not a stale one', () => {
      const result = verifyWebhook(
        verificationInput({ now: at(3_600), secret: generateWebhookSecret() }),
      );
      expect(result).toEqual({ valid: false, reason: 'INVALID_SIGNATURE' });
    });
  });
});

describe('webhook secrets', () => {
  it('generates distinct 32-byte secrets that decode successfully', () => {
    const first = generateWebhookSecret();
    const second = generateWebhookSecret();
    expect(first).not.toBe(second);
    expect(decodeWebhookSecret(first)).toHaveLength(32);
  });

  it.each([
    ['a missing prefix', 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'],
    ['an empty key', 'whsec_'],
    ['invalid base64', 'whsec_not*base64'],
    ['a key shorter than 24 bytes', `whsec_${Buffer.alloc(16).toString('base64')}`],
    ['a key longer than 64 bytes', `whsec_${Buffer.alloc(65).toString('base64')}`],
  ])('rejects %s', (_label, secret) => {
    expect(() => decodeWebhookSecret(secret)).toThrow(InvalidWebhookSecretError);
  });
});
