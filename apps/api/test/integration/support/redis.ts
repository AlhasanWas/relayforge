import { Redis } from 'ioredis';
import { assertDisposableTestRedis, TEST_REDIS_URL } from './test-environment';

/** Clears rate limit windows and queues left by previous tests. */
export async function flushTestRedis(): Promise<void> {
  assertDisposableTestRedis(TEST_REDIS_URL);
  const redis = new Redis(TEST_REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }
}
