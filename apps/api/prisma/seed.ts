/**
 * Idempotent seed for local development and the demo. Safe to run repeatedly.
 *
 * - Global provider definitions.
 * - A demo workspace with an ADMIN API key taken from SEED_ADMIN_API_KEY, so the
 *   dashboard and demo scripts can share a known development credential.
 * - A MockPay connection for the demo workspace, with the ingress key and signing
 *   secret the MockPay demo scripts use.
 *
 * Never run against production: the demo credentials live in `.env.example`.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { decodeWebhookSecret } from '@relayforge/shared/webhooks';
import { apiKeyPrefix, hashApiKey } from '../src/auth/api-key';
import { loadConfig } from '../src/config/app-config';
import { SecretCipher } from '../src/crypto/secret-cipher';
import { ApiKeyRole, PrismaClient, ProviderAdapterType } from '../src/generated/prisma/client';
import { isWellFormedIngressKey } from '../src/ingestion/ingress-key';

/** Fixed id so the seed can upsert the demo workspace. */
const DEMO_WORKSPACE_ID = '01990000-0000-7000-8000-000000000001';

interface SeedInput {
  adminApiKey: string;
  adminApiKeyPrefix: string;
  mockPayIngressKey: string;
  mockPaySigningSecret: string;
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

  const mockPayIngressKey = environment.DEMO_MOCKPAY_INGRESS_KEY ?? '';
  if (!isWellFormedIngressKey(mockPayIngressKey)) {
    throw new Error('DEMO_MOCKPAY_INGRESS_KEY must be a well-formed ingress key (ing_...)');
  }

  const mockPaySigningSecret = environment.DEMO_MOCKPAY_SIGNING_SECRET ?? '';
  decodeWebhookSecret(mockPaySigningSecret);

  return { adminApiKey, adminApiKeyPrefix, mockPayIngressKey, mockPaySigningSecret };
}

async function seed(prisma: PrismaClient, cipher: SecretCipher, input: SeedInput): Promise<void> {
  const mockPay = await prisma.providerDefinition.upsert({
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

  await prisma.providerConnection.upsert({
    where: { publicIngressKey: input.mockPayIngressKey },
    update: {},
    create: {
      workspaceId: DEMO_WORKSPACE_ID,
      providerDefinitionId: mockPay.id,
      name: 'MockPay (demo)',
      publicIngressKey: input.mockPayIngressKey,
      signingSecretEncrypted: cipher.encrypt(
        input.mockPaySigningSecret,
        'provider_connection.signing_secret',
      ),
      timestampToleranceSec: 300,
    },
  });
}

async function main(): Promise<void> {
  // Reuses the API's validated configuration so the seed encrypts with the same key.
  const config = loadConfig(process.env);
  const input = readInput(process.env);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.database.url }),
  });
  try {
    await seed(prisma, new SecretCipher(config.security.encryptionKey), input);
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
