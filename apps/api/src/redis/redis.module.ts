import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [APP_CONFIG, PinoLogger],
      useFactory: (config: AppConfig, logger: PinoLogger): Redis => {
        logger.setContext('Redis');
        const client = new Redis(config.redis.url, {
          // Fail commands immediately while disconnected instead of buffering them
          // in memory; callers decide how to degrade.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          // Upper bound on how long a forced disconnect waits before destroying a
          // socket that never finished connecting (default 2 s delays shutdown).
          disconnectTimeout: 500,
        });
        client.on('error', (error: Error) => {
          logger.warn({ err: error }, 'Redis connection error');
        });
        return client;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      // Graceful: lets in-flight commands finish.
      await this.redis.quit();
    } else {
      // Not connected, so there is nothing to flush; stop reconnection attempts.
      this.redis.disconnect();
    }
  }
}
