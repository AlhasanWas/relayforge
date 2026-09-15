import { TimeoutError, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  it('resolves with the operation result when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1_000, 'answer')).resolves.toBe(42);
  });

  it('propagates the operation error', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1_000, 'op')).rejects.toThrow(
      'boom',
    );
  });

  it('rejects with TimeoutError when the operation is too slow', async () => {
    const never = new Promise<never>(() => undefined);

    await expect(withTimeout(never, 10, 'enqueue')).rejects.toThrow(
      new TimeoutError('enqueue', 10),
    );
  });
});
