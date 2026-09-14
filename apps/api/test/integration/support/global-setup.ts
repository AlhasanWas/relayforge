import { execFileSync } from 'node:child_process';
import { assertDisposableTestDatabase, TEST_DATABASE_URL } from './test-environment';

/** Applies all migrations to the test database once before the suite runs. */
export default function globalSetup(): void {
  assertDisposableTestDatabase(TEST_DATABASE_URL);

  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: `${__dirname}/../../..`,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    // Progress output is noise; errors still reach the console via stderr.
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}
