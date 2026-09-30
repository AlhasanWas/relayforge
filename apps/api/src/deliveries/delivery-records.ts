import { AttemptOutcome, DeliveryStatus, type Prisma } from '../generated/prisma/client';
import type { DeliveryResult, NextDeliveryState } from './delivery-retry-policy';

/** Column values for moving a PROCESSING delivery to its next state and releasing the lease. */
export function deliveryStateUpdate(
  next: NextDeliveryState,
  now: Date,
): Prisma.WebhookDeliveryUpdateManyMutationInput {
  const released = { leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
  switch (next.status) {
    case DeliveryStatus.SUCCEEDED:
      return { ...released, status: next.status, nextAttemptAt: null, deliveredAt: now };
    case DeliveryStatus.PENDING:
      return { ...released, status: next.status, nextAttemptAt: next.nextAttemptAt };
    case DeliveryStatus.DEAD_LETTER:
      return {
        ...released,
        status: next.status,
        nextAttemptAt: null,
        deadLetteredAt: now,
        deadLetterReason: next.reason,
      };
  }
}

export interface AttemptRecordInput {
  readonly deliveryId: string;
  readonly attemptNumber: number;
  readonly outcome: AttemptOutcome;
  readonly result: DeliveryResult;
  readonly startedAt: Date;
  readonly durationMs: number;
  readonly timeoutMs: number;
}

export function attemptRecord(
  input: AttemptRecordInput,
): Prisma.DeliveryAttemptUncheckedCreateInput {
  const base = {
    deliveryId: input.deliveryId,
    attemptNumber: input.attemptNumber,
    outcome: input.outcome,
    startedAt: input.startedAt,
    recordedAt: input.startedAt,
    durationMs: input.durationMs,
  };
  const { result } = input;
  switch (result.kind) {
    case 'response':
      return { ...base, responseStatus: result.status, responseBody: toStorableText(result.body) };
    case 'timeout':
      return {
        ...base,
        errorCode: 'TIMEOUT',
        errorMessage: `No response within ${input.timeoutMs} ms`,
      };
    case 'network-error':
      return {
        ...base,
        errorCode: 'NETWORK_ERROR',
        errorMessage: `${result.code}: ${result.message}`,
      };
    case 'blocked-destination':
      return { ...base, errorCode: 'BLOCKED_DESTINATION', errorMessage: result.message };
    case 'endpoint-unavailable':
      return {
        ...base,
        errorCode: 'ENDPOINT_UNAVAILABLE',
        errorMessage: 'The endpoint was disabled or deleted; nothing was sent',
      };
  }
}

/** Attempt record for an attempt whose worker lost its lease before recording a result. */
export function unknownAttemptRecord(
  deliveryId: string,
  attemptNumber: number,
): Prisma.DeliveryAttemptUncheckedCreateInput {
  return {
    deliveryId,
    attemptNumber,
    outcome: AttemptOutcome.UNKNOWN,
    errorCode: 'LEASE_EXPIRED',
    errorMessage:
      'The worker lease expired before a result was recorded. The receiver may or may not have received this attempt.',
  };
}

/** PostgreSQL text cannot contain NUL characters. */
function toStorableText(value: string): string {
  return value.replaceAll('\u0000', '');
}
