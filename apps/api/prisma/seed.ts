/**
 * Idempotent seed for local development. Safe to run repeatedly.
 *
 * Provider definitions are global reference data. Demo workspace data (API keys,
 * provider connections, endpoints) is added once the features that own it exist.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, ProviderAdapterType } from '../src/generated/prisma/client';

async function seed(prisma: PrismaClient): Promise<void> {
  await prisma.providerDefinition.upsert({
    where: { slug: 'mockpay' },
    update: {},
    create: {
      slug: 'mockpay',
      displayName: 'MockPay',
      adapterType: ProviderAdapterType.MOCKPAY,
    },
  });
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL must be set to run the seed');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seed(prisma);
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
