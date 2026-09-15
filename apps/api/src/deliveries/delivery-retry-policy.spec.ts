import {
  type DeliveryResult,
  DeliveryRetryPolicy,
  parseRetryAfterMs,
} from './delivery-retry-policy';
import { RetryableStatusCodes } from './retryable-status-codes';

const now = new Date('2026-09-15T12:00:00.000Z');
const half = () => 0.5;

const policy = new DeliveryRetryPolicy({
  baseMs: 10_000,
  maxMs: 3_600_000,
  retryableStatusCodes: RetryableStatusCodes.parse('408,429,5xx'),
});

const response = (status: number, retryAfter: string | null = null): DeliveryResult => ({
  kind: 'response',
  status,
  retryAfter,
  body: '',
});

describe('DeliveryRetryPolicy.classify', () => {
  it.each([200, 201, 202, 204, 299])('treats %i as success', (status) => {
    expect(policy.classify(response(status), now)).toEqual({ outcome: 'SUCCESS' });
  });

  it.each([408, 429, 500, 502, 503, 504, 599])('retries %i', (status) => {
    expect(policy.classify(response(status), now)).toMatchObject({ outcome: 'RETRYABLE_FAILURE' });
  });

  it.each([400, 401, 403, 404, 409, 410, 422, 301, 302, 307])(
    'does not retry %i and dead-letters it',
    (status) => {
      expect(policy.classify(response(status), now)).toEqual({
        outcome: 'PERMANENT_FAILURE',
        deadLetterReason: 'NON_RETRYABLE_RESPONSE',
      });
    },
  );

  it('retries timeouts and network errors', () => {
    expect(policy.classify({ kind: 'timeout' }, now)).toEqual({
      outcome: 'RETRYABLE_FAILURE',
      retryAfterMs: null,
    });
    expect(
      policy.classify({ kind: 'network-error', code: 'ECONNREFUSED', message: 'refused' }, now),
    ).toMatchObject({ outcome: 'RETRYABLE_FAILURE' });
  });

  it('never retries a blocked destination or an unavailable endpoint', () => {
    expect(policy.classify({ kind: 'blocked-destination', message: 'private' }, now)).toMatchObject(
      {
        outcome: 'PERMANENT_FAILURE',
      },
    );
    expect(policy.classify({ kind: 'endpoint-unavailable' }, now)).toEqual({
      outcome: 'PERMANENT_FAILURE',
      deadLetterReason: 'ENDPOINT_UNAVAILABLE',
    });
  });

  it('honours Retry-After only for 429 and 503', () => {
    expect(policy.classify(response(429, '120'), now)).toEqual({
      outcome: 'RETRYABLE_FAILURE',
      retryAfterMs: 120_000,
    });
    expect(policy.classify(response(503, '30'), now)).toMatchObject({ retryAfterMs: 30_000 });
    expect(policy.classify(response(500, '120'), now)).toMatchObject({ retryAfterMs: null });
  });

  it('follows a custom retryable status configuration', () => {
    const narrow = new DeliveryRetryPolicy({
      baseMs: 1_000,
      maxMs: 60_000,
      retryableStatusCodes: RetryableStatusCodes.parse('503'),
    });

    expect(narrow.classify(response(503), now)).toMatchObject({ outcome: 'RETRYABLE_FAILURE' });
    expect(narrow.classify(response(500), now)).toMatchObject({ outcome: 'PERMANENT_FAILURE' });
  });
});

describe('DeliveryRetryPolicy.nextState', () => {
  const retryable = { outcome: 'RETRYABLE_FAILURE', retryAfterMs: null } as const;

  it('schedules a retry with jittered exponential backoff', () => {
    // Attempt 1: ceiling 10 s → 5 s + 0.5 × 5 s = 7.5 s. Attempt 3: ceiling 40 s → 30 s.
    expect(policy.nextState(retryable, 1, 8, now, half)).toEqual({
      status: 'PENDING',
      nextAttemptAt: new Date(now.getTime() + 7_500),
    });
    expect(policy.nextState(retryable, 3, 8, now, half)).toEqual({
      status: 'PENDING',
      nextAttemptAt: new Date(now.getTime() + 30_000),
    });
  });

  it('dead-letters when the retry budget is exhausted', () => {
    expect(policy.nextState(retryable, 8, 8, now, half)).toEqual({
      status: 'DEAD_LETTER',
      reason: 'MAX_ATTEMPTS_EXHAUSTED',
    });
  });

  it('lets Retry-After lengthen but never shorten the delay, within the maximum', () => {
    const longer = policy.nextState(
      { outcome: 'RETRYABLE_FAILURE', retryAfterMs: 120_000 },
      1,
      8,
      now,
      half,
    );
    const shorter = policy.nextState(
      { outcome: 'RETRYABLE_FAILURE', retryAfterMs: 1_000 },
      1,
      8,
      now,
      half,
    );
    const excessive = policy.nextState(
      { outcome: 'RETRYABLE_FAILURE', retryAfterMs: 86_400_000 },
      1,
      8,
      now,
      half,
    );

    expect(longer).toEqual({ status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 120_000) });
    expect(shorter).toEqual({ status: 'PENDING', nextAttemptAt: new Date(now.getTime() + 7_500) });
    expect(excessive).toEqual({
      status: 'PENDING',
      nextAttemptAt: new Date(now.getTime() + 3_600_000),
    });
  });

  it('passes success and permanent failures straight through', () => {
    expect(policy.nextState({ outcome: 'SUCCESS' }, 1, 8, now, half)).toEqual({
      status: 'SUCCEEDED',
    });
    expect(
      policy.nextState(
        { outcome: 'PERMANENT_FAILURE', deadLetterReason: 'NON_RETRYABLE_RESPONSE' },
        1,
        8,
        now,
        half,
      ),
    ).toEqual({ status: 'DEAD_LETTER', reason: 'NON_RETRYABLE_RESPONSE' });
  });

  it('retries after an unknown outcome unless the budget is spent', () => {
    expect(policy.afterUnknownOutcome(2, 8, now, half)).toMatchObject({ status: 'PENDING' });
    expect(policy.afterUnknownOutcome(8, 8, now, half)).toEqual({
      status: 'DEAD_LETTER',
      reason: 'MAX_ATTEMPTS_EXHAUSTED',
    });
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('0', now)).toBe(0);
    expect(parseRetryAfterMs(' 90 ', now)).toBe(90_000);
  });

  it('parses a future HTTP date', () => {
    expect(parseRetryAfterMs('Tue, 15 Sep 2026 12:02:00 GMT', now)).toBe(120_000);
  });

  it.each([null, '', 'soon', '-5', '1.5', 'Tue, 15 Sep 2026 11:00:00 GMT'])(
    'ignores %p',
    (value) => {
      expect(parseRetryAfterMs(value, now)).toBeNull();
    },
  );
});

describe('RetryableStatusCodes', () => {
  it('parses codes and classes', () => {
    const codes = RetryableStatusCodes.parse(' 408, 429 ,5XX');

    expect([408, 429, 500, 503].every((status) => codes.includes(status))).toBe(true);
    expect([400, 404, 200].some((status) => codes.includes(status))).toBe(false);
  });

  it.each(['abc', '600', '5x', '2xx', '204'])('rejects %p', (spec) => {
    expect(() => RetryableStatusCodes.parse(spec)).toThrow();
  });
});
