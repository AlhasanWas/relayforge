import { Test, type TestingModule } from '@nestjs/testing';
import { Clock } from '../../../src/clock/clock';
import { RandomSource } from '../../../src/clock/random-source';
import { APP_CONFIG, type AppConfig } from '../../../src/config/app-config';
import { WorkerModule } from '../../../src/worker.module';
import { createTestConfig } from './test-environment';

/** A random source that always returns the same value, for exact backoff assertions. */
export class FixedRandomSource extends RandomSource {
  constructor(private readonly value = 0.5) {
    super();
  }

  next(): number {
    return this.value;
  }
}

export interface TestWorkerOptions {
  config?: AppConfig;
  clock?: Clock;
  random?: RandomSource;
}

/**
 * Boots the real WorkerModule without starting consumers or the publisher loop;
 * tests drive `OutboxPublisher`, `EventProcessor` and consumers explicitly.
 */
export async function createTestWorker(options: TestWorkerOptions = {}): Promise<TestingModule> {
  const config = options.config ?? createTestConfig({ WORKER_AUTOSTART: 'false' });
  if (config.worker.autostart) {
    throw new Error('Test workers must be created with WORKER_AUTOSTART=false');
  }
  let builder = Test.createTestingModule({ imports: [WorkerModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(RandomSource)
    .useValue(options.random ?? new FixedRandomSource());
  if (options.clock !== undefined) {
    builder = builder.overrideProvider(Clock).useValue(options.clock);
  }
  const worker = await builder.compile();
  await worker.init();
  return worker;
}
