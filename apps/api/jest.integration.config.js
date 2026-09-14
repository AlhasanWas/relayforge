/**
 * Integration tests: run against real PostgreSQL and Redis (see docker-compose.yml).
 * Run serially because tests share one database and truncate it between cases.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int-spec.ts'],
  // Relative imports use .js specifiers (NodeNext); resolve them to the .ts sources.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/integration/support/global-setup.ts',
  testTimeout: 30_000,
};
