/**
 * Idempotent seed for local development and the demo. Safe to run repeatedly.
 *
 * - Global provider definitions.
 * - A demo workspace with an ADMIN API key taken from SEED_ADMIN_API_KEY, so the
 *   dashboard and demo scripts can share a known development credential.
 *
 * Never run against production: the demo key lives in `.env.example`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { apiKeyPrefix, hashApiKey } from '../src/auth/api-key';
import { ApiKeyRole, PrismaClient, ProviderAdapterType } from '../src/generated/prisma/client';

/** Fixed id so the seed can upsert the demo workspace. */
const DEMO_WORKSPACE_ID = '01990000-0000-7000-8000-000000000001';

interface SeedInput {
  adminApiKey: string;
  adminApiKeyPrefix: string;
}

function readInput(environment: NodeJS.ProcessEnv): SeedInput {
  if (environment.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data when NODE_ENV=production');
  }
  const adminApiKey = environment.SEED_ADMIN_API_KEY ?? '';
  const adminApiKeyPrefix = apiKeyPrefix(adminApiKey);
  if (adminApiKeyPrefix === undefined) {
    throw new Error('SEED_ADMIN_API_KEY must be set to a well-formed RelayForge API key');
  }
  return { adminApiKey, adminApiKeyPrefix };
}

async function seed(prisma: PrismaClient, input: SeedInput): Promise<void> {
  await prisma.providerDefinition.upsert({
    where: { slug: 'mockpay' },
    update: {},
    create: { slug: 'mockpay', displayName: 'MockPay', adapterType: ProviderAdapterType.MOCKPAY },
  });

  await prisma.workspace.upsert({
    where: { id: DEMO_WORKSPACE_ID },
    update: {},
    create: { id: DEMO_WORKSPACE_ID, name: 'Demo workspace' },
  });

  const keyHash = hashApiKey(input.adminApiKey);
  await prisma.apiKey.upsert({
    where: { keyHash },
    update: {},
    create: {
      workspaceId: DEMO_WORKSPACE_ID,
      name: 'Demo admin (seed)',
      role: ApiKeyRole.ADMIN,
      prefix: input.adminApiKeyPrefix,
      keyHash,
    },
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run the seed');
  }
  const input = readInput(process.env);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seed(prisma, input);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Seed failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
