export interface BackoffPolicy {
  /** Delay ceiling for the first retry, in milliseconds. */
  readonly baseMs: number;
  /** Upper bound for any delay, in milliseconds. */
  readonly maxMs: number;
}

/**
 * Exponential backoff with "equal jitter": the ceiling doubles per attempt up to
 * `maxMs`, and the delay is drawn uniformly from [ceiling/2, ceiling].
 *
 * Jitter spreads out retries that failed together (for example, after a receiver
 * outage) so they do not return as a synchronised burst. Keeping half the ceiling
 * as a floor guarantees the delay still grows with each attempt, which "full
 * jitter" (uniform in [0, ceiling]) does not.
 *
 * @param attempt 1 for the first retry, 2 for the second, and so on.
 * @param random  Source of uniform values in [0, 1); injected for deterministic tests.
 */
export function backoffDelayMs(
  attempt: number,
  policy: BackoffPolicy,
  random: () => number,
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError(`attempt must be a positive integer, received ${attempt}`);
  }
  // Cap the exponent so 2 ** exponent cannot overflow to Infinity.
  const exponent = Math.min(attempt - 1, 40);
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
  const half = ceiling / 2;
  return Math.round(half + random() * half);
}
