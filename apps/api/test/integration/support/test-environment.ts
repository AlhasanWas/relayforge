import { type AppConfig, loadConfig } from '../../../src/config/app-config';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://relayforge:relayforge@localhost:5432/relayforge_test';

export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

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

export function createTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_POOL_MAX: '5',
    REDIS_URL: TEST_REDIS_URL,
    HEALTH_CHECK_TIMEOUT_MS: '1000',
    ...overrides,
  });
}
