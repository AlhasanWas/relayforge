import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { AppModule } from '../../../src/app.module';
import { Clock } from '../../../src/clock/clock';
import { APP_CONFIG, type AppConfig } from '../../../src/config/app-config';
import { configureHttpApp } from '../../../src/http/configure-http-app';
import { REDIS } from '../../../src/redis/redis.module';
import { createTestConfig } from './test-environment';

const REDIS_READY_TIMEOUT_MS = 5_000;

export interface TestAppOptions {
  config?: AppConfig;
  /** Replaces the system clock, for tests that depend on time. */
  clock?: Clock;
  /**
   * The app deliberately starts without waiting for Redis (ingestion must not
   * depend on it). Tests that assume a connected Redis wait explicitly.
   */
  waitForRedis?: boolean;
}

/** Boots the real AppModule with test configuration and the production HTTP setup. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const config = options.config ?? createTestConfig();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config);
  if (options.clock !== undefined) {
    builder = builder.overrideProvider(Clock).useValue(options.clock);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  configureHttpApp(app, config);
  await app.init();
  await app.listen(0);

  if (options.waitForRedis ?? true) {
    await waitUntilReady(app.get<Redis>(REDIS));
  }
  return app;
}

async function waitUntilReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') return;

  let timer: NodeJS.Timeout | undefined;
  let onReady: (() => void) | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      onReady = resolve;
      redis.once('ready', onReady);
      timer = setTimeout(() => {
        reject(new Error(`Redis did not become ready within ${REDIS_READY_TIMEOUT_MS} ms`));
      }, REDIS_READY_TIMEOUT_MS);
    });
  } finally {
    clearTimeout(timer);
    if (onReady) redis.off('ready', onReady);
  }
}
