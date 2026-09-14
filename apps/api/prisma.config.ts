import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

// Local development keeps configuration in the repository root `.env`.
// Deployed environments provide real environment variables instead.
const rootEnvFile = join(__dirname, '..', '..', '.env');
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // Optional so that `prisma generate` works without a database (e.g. in CI builds).
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
