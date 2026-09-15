import { randomBytes } from 'node:crypto';
import { type AppConfig, loadConfig } from '../../../src/config/app-config';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://relayforge:relayforge@localhost:5432/relayforge_test';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

/**
 * One key per test run, shared by every app and worker in it, as in a real deployment
 * where the API and worker processes must decrypt each other's secrets.
 */
const TEST_ENCRYPTION_KEY = randomBytes(32).toString('base64');

/**
 * Integration tests truncate every table. Refuse to point them at anything that
 * is not clearly a disposable test database.
 */
export function assertDisposableTestDatabase(databaseUrl: string): void {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against database "${databaseName}": ` +
        'the database name must end with "_test".',
    );
  }
}

/** Integration tests flush Redis. Refuse to flush logical database 0, the default. */
export function assertDisposableTestRedis(redisUrl: string): void {
  const databaseIndex = Number(new URL(redisUrl).pathname.slice(1) || '0');
  if (databaseIndex === 0) {
    throw new Error(
      'Refusing to run integration tests against Redis database 0: ' +
        'set TEST_REDIS_URL to a dedicated logical database, e.g. redis://localhost:6379/1.',
    );
  }
}

export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '5',
    REDIS_URL: TEST_REDIS_URL,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    // High enough that only tests about rate limiting ever reach it.
    RATE_LIMIT_MANAGEMENT_MAX: '10000',
    HEALTH_CHECK_TIMEOUT_MS: '1000',
    ...overrides,
  });
}
