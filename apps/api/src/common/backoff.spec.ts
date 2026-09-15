import { backoffDelayMs } from './backoff';

const policy = { baseMs: 1_000, maxMs: 60_000 };

describe('backoffDelayMs', () => {
  it('doubles the ceiling each attempt with delays between half and the full ceiling', () => {
    const lowest = [1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, policy, () => 0));
    const highest = [1, 2, 3, 4].map((attempt) => backoffDelayMs(attempt, policy, () => 0.999_999));

    expect(lowest).toEqual([500, 1_000, 2_000, 4_000]);
    expect(highest).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('never exceeds the maximum delay', () => {
    expect(backoffDelayMs(30, policy, () => 0.999_999)).toBe(60_000);
    expect(backoffDelayMs(1_000, policy, () => 0.5)).toBe(45_000);
  });

  it('grows monotonically in its lower bound, unlike full jitter', () => {
    const floors = Array.from({ length: 10 }, (_, index) =>
      backoffDelayMs(index + 1, policy, () => 0),
    );

    expect([...floors].sort((a, b) => a - b)).toEqual(floors);
  });

  it.each([0, -1, 1.5])('rejects attempt %p', (attempt) => {
    expect(() => backoffDelayMs(attempt, policy, () => 0)).toThrow(RangeError);
  });
});
