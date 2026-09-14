import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { REDIS } from '../redis/redis.module';
import { rateLimitPolicyOf } from './rate-limit-policy';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS, PinoLogger],
      useFactory: (config: AppConfig, redis: Redis, logger: PinoLogger) => {
        logger.setContext(RedisThrottlerStorage.name);
        return {
          // The throttler named "default" emits standard, unsuffixed headers
          // (Retry-After, X-RateLimit-Limit, ...). The limit depends on the route's policy.
          throttlers: [
            {
              name: 'default',
              ttl: config.rateLimit.windowMs,
              limit: (context) =>
                rateLimitPolicyOf(context) === 'ingestion'
                  ? config.rateLimit.ingestionMax
                  : config.rateLimit.managementMax,
            },
          ],
          storage: new RedisThrottlerStorage(redis, logger),
        };
      },
    }),
  ],
  providers: [RateLimitGuard],
  exports: [RateLimitGuard],
})
export class RateLimitModule {}
