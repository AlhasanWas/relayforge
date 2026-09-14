import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';

// Not exported from the package root; derived from the public interface instead.
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const KEY_PREFIX = 'rf:rate-limit:';

/**
 * Atomic fixed-window counter: increments the hit count and ensures the window has
 * an expiry, returning [hits, remaining window in ms]. A single script keeps the
 * INCR and PEXPIRE atomic, so a crash between them cannot leave an immortal key.
 */
const FIXED_WINDOW_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

/**
 * Redis-backed throttler storage so limits hold across API replicas.
 *
 * Fixed windows are simple and cheap; the tradeoff is that a caller can send up to
 * twice the limit across a window boundary. A blocked caller stays blocked until
 * the window resets (a separate block duration is not used).
 *
 * If Redis is unavailable the request is allowed and a warning is logged: rate
 * limiting protects capacity, and must not turn a Redis outage into an API outage.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    private readonly redis: Redis,
    private readonly logger: PinoLogger,
  ) {}

  async increment(
    key: string,
    ttlMs: number,
    limit: number,
    _blockDurationMs: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const windowSeconds = Math.ceil(ttlMs / 1000);
    try {
      const result = await this.redis.eval(FIXED_WINDOW_SCRIPT, 1, `${KEY_PREFIX}${key}`, ttlMs);
      const { hits, remainingMs } = parseScriptResult(result);
      const secondsToReset = Math.max(1, Math.ceil(remainingMs / 1000));
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire: secondsToReset,
        isBlocked,
        timeToBlockExpire: isBlocked ? secondsToReset : 0,
      };
    } catch (error: unknown) {
      this.logger.warn(
        { err: error, throttler: throttlerName },
        'Rate limit storage unavailable; allowing request',
      );
      return { totalHits: 0, timeToExpire: windowSeconds, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

function parseScriptResult(result: unknown): { hits: number; remainingMs: number } {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    typeof result[0] === 'number' &&
    typeof result[1] === 'number'
  ) {
    return { hits: result[0], remainingMs: result[1] };
  }
  throw new Error(`Unexpected rate limit script result: ${JSON.stringify(result)}`);
}
