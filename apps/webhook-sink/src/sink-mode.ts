export const SINK_MODES = ['SUCCESS', 'FAIL_500', 'TIMEOUT', 'RANDOM_FAILURE'] as const;

export type SinkMode = (typeof SINK_MODES)[number];

export function isSinkMode(value: unknown): value is SinkMode {
  return typeof value === 'string' && (SINK_MODES as readonly string[]).includes(value);
}

export type SinkDecision = { kind: 'respond'; status: number } | { kind: 'hang' };

/** Statuses used by RANDOM_FAILURE: a mix of transient failures RelayForge retries. */
const RANDOM_FAILURE_STATUSES = [500, 502, 503] as const;

/**
 * How the sink answers a webhook in a given mode.
 *
 * - SUCCESS: 200.
 * - FAIL_500: 500, which RelayForge retries until the delivery is dead-lettered.
 * - TIMEOUT: never answers, so RelayForge's request times out and is retried.
 * - RANDOM_FAILURE: fails with probability `failureRate`, otherwise 200.
 */
export function decide(mode: SinkMode, failureRate: number, random: () => number): SinkDecision {
  switch (mode) {
    case 'SUCCESS':
      return { kind: 'respond', status: 200 };
    case 'FAIL_500':
      return { kind: 'respond', status: 500 };
    case 'TIMEOUT':
      return { kind: 'hang' };
    case 'RANDOM_FAILURE': {
      if (random() >= failureRate) {
        return { kind: 'respond', status: 200 };
      }
      const index = Math.floor(random() * RANDOM_FAILURE_STATUSES.length);
      return { kind: 'respond', status: RANDOM_FAILURE_STATUSES[index] ?? 500 };
    }
  }
}
