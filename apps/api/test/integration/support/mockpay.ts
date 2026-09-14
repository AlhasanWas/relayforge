/** Builds MockPay connections and correctly signed MockPay webhook requests for tests. */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  createWebhookHeaders,
  generateWebhookSecret,
  toUnixSeconds,
} from '@relayforge/shared/webhooks';
import { SecretCipher } from '../../../src/crypto/secret-cipher';
import { PrismaService } from '../../../src/database/prisma.service';
import { ProviderAdapterType } from '../../../src/generated/prisma/client';
import { generateIngressKey } from '../../../src/ingestion/ingress-key';

export interface TestConnection {
  id: string;
  workspaceId: string;
  ingressKey: string;
  /** Plaintext signing secret, as the provider would hold it. */
  secret: string;
}

export async function createMockPayConnection(
  app: INestApplication,
  workspaceId: string,
  options: { enabled?: boolean; timestampToleranceSec?: number | null } = {},
): Promise<TestConnection> {
  const prisma = app.get(PrismaService);
  const definition = await prisma.providerDefinition.upsert({
    where: { slug: 'mockpay' },
    update: {},
    create: { slug: 'mockpay', displayName: 'MockPay', adapterType: ProviderAdapterType.MOCKPAY },
  });
  const secret = generateWebhookSecret();
  const connection = await prisma.providerConnection.create({
    data: {
      workspaceId,
      providerDefinitionId: definition.id,
      name: 'MockPay (test)',
      publicIngressKey: generateIngressKey(),
      signingSecretEncrypted: app
        .get(SecretCipher)
        .encrypt(secret, 'provider_connection.signing_secret'),
      timestampToleranceSec:
        options.timestampToleranceSec === undefined ? 300 : options.timestampToleranceSec,
      enabled: options.enabled ?? true,
    },
  });
  return { id: connection.id, workspaceId, ingressKey: connection.publicIngressKey, secret };
}

export interface MockPayEventBody {
  id: string;
  type: string;
  created_at: string;
  data: Record<string, unknown>;
}

export function paymentSucceeded(overrides: Partial<MockPayEventBody> = {}): MockPayEventBody {
  return {
    id: `evt_${randomUUID()}`,
    type: 'payment.succeeded',
    created_at: '2026-09-15T12:00:00Z',
    data: { payment_id: `pay_${randomUUID()}`, amount: 1999, currency: 'USD' },
    ...overrides,
  };
}

export interface SignedRequest {
  body: string;
  headers: Record<string, string>;
}

/** Serialises and signs a body exactly as MockPay would send it. */
export function signMockPayRequest(
  connection: TestConnection,
  event: MockPayEventBody | string,
  options: { signedAt: Date; messageId?: string; secret?: string },
): SignedRequest {
  const body = typeof event === 'string' ? event : JSON.stringify(event);
  const messageId = options.messageId ?? (typeof event === 'string' ? 'evt_raw' : event.id);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      ...createWebhookHeaders({
        secret: options.secret ?? connection.secret,
        messageId,
        timestamp: toUnixSeconds(options.signedAt),
        body,
      }),
    },
  };
}
