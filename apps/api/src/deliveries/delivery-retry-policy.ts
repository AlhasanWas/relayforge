import { type BackoffPolicy, backoffDelayMs } from '../common/backoff';
import { AttemptOutcome, DeadLetterReason, DeliveryStatus } from '../generated/prisma/client';
import type { RetryableStatusCodes } from './retryable-status-codes';

/** What happened when RelayForge tried to deliver a webhook. */
export type DeliveryResult =
  | {
      readonly kind: 'response';
      readonly status: number;
      readonly retryAfter: string | null;
      readonly body: string;
    }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'network-error'; readonly code: string; readonly message: string }
  | { readonly kind: 'blocked-destination'; readonly message: string }
  /** The endpoint was disabled or deleted after the delivery was scheduled. */
  | { readonly kind: 'endpoint-unavailable' };

export type DeliveryVerdict =
  | { readonly outcome: typeof AttemptOutcome.SUCCESS }
  | {
      readonly outcome: typeof AttemptOutcome.RETRYABLE_FAILURE;
      readonly retryAfterMs: number | null;
    }
  | {
      readonly outcome: typeof AttemptOutcome.PERMANENT_FAILURE;
      readonly deadLetterReason: DeadLetterReason;
    };

export type NextDeliveryState =
  | { readonly status: typeof DeliveryStatus.SUCCEEDED }
  | { readonly status: typeof DeliveryStatus.PENDING; readonly nextAttemptAt: Date }
  | { readonly status: typeof DeliveryStatus.DEAD_LETTER; readonly reason: DeadLetterReason };

export interface DeliveryRetryPolicyOptions extends BackoffPolicy {
  readonly retryableStatusCodes: RetryableStatusCodes;
}

/** Statuses whose Retry-After header is honoured (RFC 9110 §10.2.3). */
const RETRY_AFTER_STATUSES = new Set([429, 503]);

/**
 * The single place that decides what a delivery result means and what happens
 * next. Pure and deterministic given `now` and `random`; the worker only asks.
 */
export class DeliveryRetryPolicy {
  constructor(private readonly options: DeliveryRetryPolicyOptions) {}

  classify(result: DeliveryResult, now: Date): DeliveryVerdict {
    switch (result.kind) {
      case 'response':
        if (result.status >= 200 && result.status < 300) {
          return { outcome: AttemptOutcome.SUCCESS };
        }
        if (this.options.retryableStatusCodes.includes(result.status)) {
          return {
            outcome: AttemptOutcome.RETRYABLE_FAILURE,
            retryAfterMs: RETRY_AFTER_STATUSES.has(result.status)
              ? parseRetryAfterMs(result.retryAfter, now)
              : null,
          };
        }
        // Includes 3xx: redirects are not followed, so a moved endpoint must be updated.
        return {
          outcome: AttemptOutcome.PERMANENT_FAILURE,
          deadLetterReason: DeadLetterReason.NON_RETRYABLE_RESPONSE,
        };
      case 'timeout':
      case 'network-error':
        return { outcome: AttemptOutcome.RETRYABLE_FAILURE, retryAfterMs: null };
      case 'blocked-destination':
        return {
          outcome: AttemptOutcome.PERMANENT_FAILURE,
          deadLetterReason: DeadLetterReason.NON_RETRYABLE_RESPONSE,
        };
      case 'endpoint-unavailable':
        return {
          outcome: AttemptOutcome.PERMANENT_FAILURE,
          deadLetterReason: DeadLetterReason.ENDPOINT_UNAVAILABLE,
        };
    }
  }

  /**
   * @param attemptNumber The attempt that just finished (1-based).
   * @param maxAttempts   The delivery's snapshotted retry budget.
   */
  nextState(
    verdict: DeliveryVerdict,
    attemptNumber: number,
    maxAttempts: number,
    now: Date,
    random: () => number,
  ): NextDeliveryState {
    switch (verdict.outcome) {
      case AttemptOutcome.SUCCESS:
        return { status: DeliveryStatus.SUCCEEDED };
      case AttemptOutcome.PERMANENT_FAILURE:
        return { status: DeliveryStatus.DEAD_LETTER, reason: verdict.deadLetterReason };
      case AttemptOutcome.RETRYABLE_FAILURE:
        return this.retryOrDeadLetter(
          attemptNumber,
          maxAttempts,
          verdict.retryAfterMs,
          now,
          random,
        );
    }
  }

  /** Used when an attempt's outcome is unknown (its worker lost the lease). */
  afterUnknownOutcome(
    attemptNumber: number,
    maxAttempts: number,
    now: Date,
    random: () => number,
  ): NextDeliveryState {
    return this.retryOrDeadLetter(attemptNumber, maxAttempts, null, now, random);
  }

  private retryOrDeadLetter(
    attemptNumber: number,
    maxAttempts: number,
    retryAfterMs: number | null,
    now: Date,
    random: () => number,
  ): NextDeliveryState {
    if (attemptNumber >= maxAttempts) {
      return {
        status: DeliveryStatus.DEAD_LETTER,
        reason: DeadLetterReason.MAX_ATTEMPTS_EXHAUSTED,
      };
    }
    // Retry-After may lengthen the computed delay but never shorten it.
    const delayMs = Math.min(
      this.options.maxMs,
      Math.max(retryAfterMs ?? 0, backoffDelayMs(attemptNumber, this.options, random)),
    );
    return { status: DeliveryStatus.PENDING, nextAttemptAt: new Date(now.getTime() + delayMs) };
  }
}

/** Parses Retry-After as delta-seconds or an HTTP date. Invalid or past values yield null. */
export function parseRetryAfterMs(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date) || !/[a-z]/i.test(trimmed)) {
    return null;
  }
  const delta = date - now.getTime();
  return delta > 0 ? delta : null;
}
