import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { generateWebhookSecret } from '@relayforge/shared/webhooks';
import type { Pool } from 'pg';
import request from 'supertest';
import { SecretCipher } from '../../src/crypto/secret-cipher';
import { PrismaService } from '../../src/database/prisma.service';
import { DeliveryAttemptRunner } from '../../src/deliveries/delivery-attempt.runner';
import { ApiKeyRole } from '../../src/generated/prisma/client';
import { EventProcessor } from '../../src/processing/event-processor';
import { createTestPool, truncateAllTables } from './support/database';
import { bearer, createApiKey, createWorkspace } from './support/fixtures';
import {
  createMockPayConnection,
  type MockPayEventBody,
  paymentSucceeded,
  signMockPayRequest,
  type TestConnection,
} from './support/mockpay';
import { MutableClock } from './support/mutable-clock';
import { flushTestRedis } from './support/redis';
import { createTestApp } from './support/test-app';
import { createTestConfig } from './support/test-environment';
import { createTestWorker } from './support/test-worker';
import { WebhookReceiver } from './support/webhook-receiver';

describe('metrics overview', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let pool: Pool;
  let receiver: WebhookReceiver;
  let connection: TestConnection;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    worker = await createTestWorker({
      clock,
      config: createTestConfig({
        WORKER_AUTOSTART: 'false',
        DELIVERY_ALLOW_PRIVATE_DESTINATIONS: 'true',
      }),
    });
    prisma = app.get(PrismaService);
    pool = createTestPool();
    receiver = await WebhookReceiver.start();
  });

  afterAll(async () => {
    await receiver.close();
    await worker.close();
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    receiver.reset();
    clock.set(new Date('2026-09-15T12:00:00.000Z'));
    connection = await createMockPayConnection(app, await createWorkspace(prisma));
  });

  const send = (event: MockPayEventBody, secret?: string) => {
    const signed = signMockPayRequest(connection, event, { signedAt: clock.now(), secret });
    return request(app.getHttpServer())
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .send(signed.body);
  };

  const ingestAndProcess = async (event: MockPayEventBody) => {
    const response = await send(event).expect(202);
    const { eventId } = response.body as { eventId: string };
    await worker.get(EventProcessor).process(eventId);
    return eventId;
  };

  it('reports real counts and measured delivery latency for the window', async () => {
    await prisma.webhookEndpoint.create({
      data: {
        workspaceId: connection.workspaceId,
        url: receiver.url,
        eventTypes: ['payment.succeeded'],
        signingSecretEncrypted: app
          .get(SecretCipher)
          .encrypt(generateWebhookSecret(), 'webhook_endpoint.signing_secret'),
      },
    });
    const pay = (id: string, amount: number) =>
      paymentSucceeded({ data: { payment_id: id, amount, currency: 'USD' } });

    await ingestAndProcess(pay('pay_ok', 1000));
    await ingestAndProcess(pay('pay_retry', 2000));
    await ingestAndProcess(paymentSucceeded({ type: 'customer.created', data: {} }));
    await ingestAndProcess(
      paymentSucceeded({
        type: 'payment.refunded',
        data: { refund_id: 're_1', payment_id: 'pay_ok', amount: 5000, currency: 'USD' },
      }),
    );
    await send(pay('pay_forged', 1), generateWebhookSecret()).expect(401);

    receiver.respondWith({ kind: 'respond', status: 200 }, { kind: 'respond', status: 503 });
    for (const delivery of await prisma.webhookDelivery.findMany({ orderBy: { id: 'asc' } })) {
      await worker.get(DeliveryAttemptRunner).attempt(delivery.id);
    }

    // An event from before the window must not be counted.
    clock.advance(25 * 3_600_000);
    await send(pay('pay_later', 10)).expect(202);
    clock.advance(1_000);

    const admin = await createApiKey(prisma, connection.workspaceId, ApiKeyRole.MEMBER);
    const response = await request(app.getHttpServer())
      .get('/v1/metrics/overview?windowHours=24')
      .set(bearer(admin))
      .expect(200);

    expect(response.body).toMatchObject({
      window: { hours: 24 },
      events: { received: 1, processed: 0, failed: 0, ignored: 0 },
      rejectedWebhooks: 0,
      deliveries: { succeeded: 0, failedAttempts: 0, deadLetter: 0, inProgress: 1 },
      deliveryLatencyMs: { average: null, p95: null, sampleSize: 0 },
    });

    const wide = await request(app.getHttpServer())
      .get('/v1/metrics/overview?windowHours=48')
      .set(bearer(admin))
      .expect(200);
    const body = wide.body as {
      deliveryLatencyMs: { average: number; p95: number; sampleSize: number };
    };

    expect(wide.body).toMatchObject({
      events: { received: 5, processed: 2, failed: 1, ignored: 1 },
      rejectedWebhooks: 1,
      deliveries: { succeeded: 1, failedAttempts: 1, deadLetter: 0, inProgress: 1 },
      deliveryLatencyMs: { sampleSize: 2 },
    });
    expect(body.deliveryLatencyMs.average).toBeGreaterThanOrEqual(0);
    expect(body.deliveryLatencyMs.p95).toBeGreaterThanOrEqual(body.deliveryLatencyMs.average);
  });

  it('rejects an out-of-range window', async () => {
    const admin = await createApiKey(prisma, connection.workspaceId, ApiKeyRole.ADMIN);

    await request(app.getHttpServer())
      .get('/v1/metrics/overview?windowHours=0')
      .set(bearer(admin))
      .expect(400);
    await request(app.getHttpServer())
      .get('/v1/metrics/overview?windowHours=10000')
      .set(bearer(admin))
      .expect(400);
  });
});
