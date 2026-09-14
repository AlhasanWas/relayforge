import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Redis } from 'ioredis';
import { AppModule } from '../../../src/app.module';
import { APP_CONFIG, type AppConfig } from '../../../src/config/app-config';
import { configureHttpApp } from '../../../src/http/configure-http-app';
import { REDIS } from '../../../src/redis/redis.module';
import { createTestConfig } from './test-environment';

const REDIS_READY_TIMEOUT_MS = 5_000;

export interface TestAppOptions {
  config?: AppConfig;
  /**
   * The app deliberately starts without waiting for Redis (ingestion must not
   * depend on it). Tests that assume a connected Redis wait explicitly.
   */
  waitForRedis?: boolean;
}

/** Boots the real AppModule with test configuration and the production HTTP setup. */
export async function createTestApp(options: TestAppOptions = {}): Promise<NestExpressApplication> {
  const config = options.config ?? createTestConfig();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    rawBody: true,
  });
  configureHttpApp(app, config);
  await app.init();

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
