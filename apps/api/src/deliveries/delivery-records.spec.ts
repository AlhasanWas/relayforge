import { AttemptOutcome, DeadLetterReason, DeliveryStatus } from '../generated/prisma/client';
import { attemptRecord, deliveryStateUpdate } from './delivery-records';

describe('deliveryStateUpdate', () => {
  const now = new Date('2026-09-15T12:00:00.000Z');
  const released = { leaseOwner: null, leaseExpiresAt: null, updatedAt: now };

  it('schedules the next attempt for a retry', () => {
    const nextAttemptAt = new Date(now.getTime() + 7_500);

    expect(deliveryStateUpdate({ status: DeliveryStatus.PENDING, nextAttemptAt }, now)).toEqual({
      ...released,
      status: DeliveryStatus.PENDING,
      nextAttemptAt,
    });
  });

  it('clears the schedule when a delivery succeeds', () => {
    expect(deliveryStateUpdate({ status: DeliveryStatus.SUCCEEDED }, now)).toEqual({
      ...released,
      status: DeliveryStatus.SUCCEEDED,
      nextAttemptAt: null,
      deliveredAt: now,
    });
  });

  it('clears the schedule when a delivery is dead-lettered', () => {
    expect(
      deliveryStateUpdate(
        { status: DeliveryStatus.DEAD_LETTER, reason: DeadLetterReason.MAX_ATTEMPTS_EXHAUSTED },
        now,
      ),
    ).toEqual({
      ...released,
      status: DeliveryStatus.DEAD_LETTER,
      nextAttemptAt: null,
      deadLetteredAt: now,
      deadLetterReason: DeadLetterReason.MAX_ATTEMPTS_EXHAUSTED,
    });
  });
});

describe('attemptRecord', () => {
  it('strips NUL characters, which PostgreSQL text cannot store, from response bodies', () => {
    const record = attemptRecord({
      deliveryId: '01990000-0000-7000-8000-000000000010',
      attemptNumber: 1,
      outcome: AttemptOutcome.PERMANENT_FAILURE,
      result: { kind: 'response', status: 400, retryAfter: null, body: 'bad\u0000request' },
      startedAt: new Date('2026-09-15T12:00:00.000Z'),
      durationMs: 12,
      timeoutMs: 10_000,
    });

    expect(record).toMatchObject({ responseStatus: 400, responseBody: 'badrequest' });
  });
});
