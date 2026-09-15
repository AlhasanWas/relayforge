import { decide, isSinkMode } from './sink-mode';

describe('decide', () => {
  const never = () => 0.999;

  it('answers 200 in SUCCESS mode', () => {
    expect(decide('SUCCESS', 1, never)).toEqual({ kind: 'respond', status: 200 });
  });

  it('answers 500 in FAIL_500 mode', () => {
    expect(decide('FAIL_500', 0, never)).toEqual({ kind: 'respond', status: 500 });
  });

  it('never answers in TIMEOUT mode', () => {
    expect(decide('TIMEOUT', 0, never)).toEqual({ kind: 'hang' });
  });

  it('fails with the configured probability in RANDOM_FAILURE mode', () => {
    expect(decide('RANDOM_FAILURE', 0.5, () => 0.6)).toEqual({ kind: 'respond', status: 200 });
    expect(decide('RANDOM_FAILURE', 0.5, () => 0.1)).toEqual({ kind: 'respond', status: 500 });

    const values = [0.1, 0.9];
    expect(decide('RANDOM_FAILURE', 0.5, () => values.shift() ?? 0)).toEqual({
      kind: 'respond',
      status: 503,
    });
  });
});

describe('isSinkMode', () => {
  it.each(['SUCCESS', 'FAIL_500', 'TIMEOUT', 'RANDOM_FAILURE'])('accepts %s', (mode) => {
    expect(isSinkMode(mode)).toBe(true);
  });

  it.each(['success', 'FAIL', '', 42, null])('rejects %p', (mode) => {
    expect(isSinkMode(mode)).toBe(false);
  });
});
