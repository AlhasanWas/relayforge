import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { generateWebhookSecret, verifyWebhook } from '@relayforge/shared/webhooks';
import type { Pool } from 'pg';
import request from 'supertest';
import { SecretCipher } from '../../src/crypto/secret-cipher';
import { PrismaService } from '../../src/database/prisma.service';
import { DeliveryAttemptRunner } from '../../src/deliveries/delivery-attempt.runner';
import { DeliveryConsumer } from '../../src/deliveries/delivery.consumer';
import { ApiKeyRole } from '../../src/generated/prisma/client';
import { RecoverySweeper, SWEEP_LOCK_KEY } from '../../src/maintenance/recovery-sweeper';
import { OutboxPublisher } from '../../src/outbox/outbox-publisher';
import { EventProcessingConsumer } from '../../src/processing/event-processing.consumer';
import { EventProcessor } from '../../src/processing/event-processor';
import { createTestPool, truncateAllTables } from './support/database';
import { bearer, createApiKey, createWorkspace, type TestApiKey } from './support/fixtures';
import {
  createMockPayConnection,
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

const TIMEOUT_MS = 300;
const LEASE_MS = TIMEOUT_MS + 1_000;
const MAX_ATTEMPTS = 3;

const workerConfig = (overrides: NodeJS.ProcessEnv = {}) =>
  createTestConfig({
    WORKER_AUTOSTART: 'false',
    DELIVERY_ALLOW_PRIVATE_DESTINATIONS: 'true',
    DELIVERY_TIMEOUT_MS: String(TIMEOUT_MS),
    DELIVERY_LEASE_MARGIN_MS: '1000',
    DELIVERY_MAX_ATTEMPTS: String(MAX_ATTEMPTS),
    DELIVERY_RETRY_BASE_MS: '10000',
    RECOVERY_STALE_AFTER_MS: '60000',
    OUTBOX_RETENTION_MS: '86400000',
    ...overrides,
  });

describe('webhook delivery', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let pool: Pool;
  let receiver: WebhookReceiver;
  let connection: TestConnection;
  let admin: TestApiKey;
  let endpointSecret: string;
  let endpointId: string;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    worker = await createTestWorker({ clock, config: workerConfig() });
    prisma = worker.get(PrismaService);
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
    const workspaceId = await createWorkspace(prisma);
    connection = await createMockPayConnection(app, workspaceId);
    admin = await createApiKey(prisma, workspaceId, ApiKeyRole.ADMIN);
    endpointSecret = generateWebhookSecret();
    endpointId = (
      await prisma.webhookEndpoint.create({
        data: {
          workspaceId,
          url: receiver.url,
          eventTypes: ['payment.succeeded'],
          signingSecretEncrypted: app
            .get(SecretCipher)
            .encrypt(endpointSecret, 'webhook_endpoint.signing_secret'),
        },
      })
    ).id;
  });

  const runner = () => worker.get(DeliveryAttemptRunner);
  const http = () => request(app.getHttpServer());

  /** Ingests and processes a payment, returning the resulting delivery. */
  const scheduleDelivery = async () => {
    const signed = signMockPayRequest(connection, paymentSucceeded(), { signedAt: clock.now() });
    const accepted = await http()
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .send(signed.body)
      .expect(202);
    const { eventId } = accepted.body as { eventId: string };
    await worker.get(EventProcessor).process(eventId);
    return prisma.webhookDelivery.findFirstOrThrow({ where: { eventId } });
  };

  const attemptsOf = (deliveryId: string) =>
    prisma.deliveryAttempt.findMany({ where: { deliveryId }, orderBy: { attemptNumber: 'asc' } });

  describe('attempts', () => {
    it('delivers a signed webhook with a stable id and records a successful attempt', async () => {
      const delivery = await scheduleDelivery();

      expect(await runner().attempt(delivery.id)).toBe('SUCCEEDED');

      const [received] = receiver.received;
      expect(received?.headers).toMatchObject({
        'content-type': 'application/json',
        'user-agent': 'RelayForge-Webhooks/0.1',
        'webhook-id': delivery.eventId,
        'relayforge-delivery-id': delivery.id,
        'relayforge-attempt': '1',
      });
      expect(JSON.parse(received?.body ?? '')).toEqual(delivery.payload);
      expect(
        verifyWebhook({
          secret: endpointSecret,
          headers: {
            id: received?.headers['webhook-id'] as string,
            timestamp: received?.headers['webhook-timestamp'] as string,
            signature: received?.headers['webhook-signature'] as string,
          },
          body: received?.body ?? '',
          now: clock.now(),
          toleranceSeconds: 300,
        }),
      ).toMatchObject({ valid: true });

      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        status: 'SUCCEEDED',
        deliveredAt: clock.now(),
        attemptCount: 1,
        leaseOwner: null,
        nextAttemptAt: null,
      });
      expect(await attemptsOf(delivery.id)).toEqual([
        expect.objectContaining({ attemptNumber: 1, outcome: 'SUCCESS', responseStatus: 200 }),
      ]);
    });

    it('retries a 500 response with backoff and schedules the retry in the outbox', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'respond', status: 500, body: 'upstream exploded' });

      expect(await runner().attempt(delivery.id)).toBe('RETRY_SCHEDULED');

      // Attempt 1, base 10 s, random 0.5: 5 s + 2.5 s.
      const nextAttemptAt = new Date(clock.now().getTime() + 7_500);
      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        status: 'PENDING',
        nextAttemptAt,
        attemptCount: 1,
      });
      expect(await attemptsOf(delivery.id)).toEqual([
        expect.objectContaining({
          outcome: 'RETRYABLE_FAILURE',
          responseStatus: 500,
          responseBody: 'upstream exploded',
        }),
      ]);
      expect(
        await prisma.outboxMessage.count({
          where: { aggregateId: delivery.id, availableAt: nextAttemptAt },
        }),
      ).toBe(1);

      // Not due yet: nothing is sent.
      expect(await runner().attempt(delivery.id)).toBe('NOT_CLAIMED');
      expect(receiver.received).toHaveLength(1);
    });

    it('dead-letters a 400 response immediately without retrying', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'respond', status: 400 });

      expect(await runner().attempt(delivery.id)).toBe('DEAD_LETTERED');

      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        status: 'DEAD_LETTER',
        deadLetterReason: 'NON_RETRYABLE_RESPONSE',
        deadLetteredAt: clock.now(),
      });
      expect(await attemptsOf(delivery.id)).toEqual([
        expect.objectContaining({ outcome: 'PERMANENT_FAILURE', responseStatus: 400 }),
      ]);
      expect(await prisma.outboxMessage.count({ where: { aggregateId: delivery.id } })).toBe(1);
    });

    it('retries a timeout', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'hang' });

      expect(await runner().attempt(delivery.id)).toBe('RETRY_SCHEDULED');

      expect(await attemptsOf(delivery.id)).toEqual([
        expect.objectContaining({
          outcome: 'RETRYABLE_FAILURE',
          errorCode: 'TIMEOUT',
          responseStatus: null,
        }),
      ]);
    });

    it('waits at least as long as a 429 Retry-After asks', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'respond', status: 429, headers: { 'retry-after': '120' } });

      await runner().attempt(delivery.id);

      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        nextAttemptAt: new Date(clock.now().getTime() + 120_000),
      });
    });

    it('records every attempt and dead-letters once the retry budget is spent', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith(
        { kind: 'respond', status: 503 },
        { kind: 'respond', status: 502 },
        { kind: 'respond', status: 500 },
      );

      const outcomes = [];
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        outcomes.push(await runner().attempt(delivery.id));
        clock.advance(3_600_000);
      }

      expect(outcomes).toEqual(['RETRY_SCHEDULED', 'RETRY_SCHEDULED', 'DEAD_LETTERED']);
      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        status: 'DEAD_LETTER',
        deadLetterReason: 'MAX_ATTEMPTS_EXHAUSTED',
        attemptCount: 3,
        nextAttemptAt: null,
      });
      expect(
        (await attemptsOf(delivery.id)).map((a) => [a.attemptNumber, a.responseStatus]),
      ).toEqual([
        [1, 503],
        [2, 502],
        [3, 500],
      ]);
      const webhookIds = new Set(receiver.received.map((r) => r.headers['webhook-id']));
      expect(webhookIds).toEqual(new Set([delivery.eventId]));
      expect(receiver.received.map((r) => r.headers['relayforge-attempt'])).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    it('dead-letters without sending when the endpoint was disabled after scheduling', async () => {
      const delivery = await scheduleDelivery();
      await prisma.webhookEndpoint.update({ where: { id: endpointId }, data: { isActive: false } });

      expect(await runner().attempt(delivery.id)).toBe('DEAD_LETTERED');

      expect(receiver.received).toHaveLength(0);
      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } }),
      ).toMatchObject({
        deadLetterReason: 'ENDPOINT_UNAVAILABLE',
      });
    });

    it('never sends the same attempt twice when two workers race to claim it', async () => {
      const delivery = await scheduleDelivery();

      const outcomes = await Promise.all([
        runner().attempt(delivery.id),
        runner().attempt(delivery.id),
      ]);

      expect(outcomes.sort()).toEqual(['NOT_CLAIMED', 'SUCCEEDED']);
      expect(receiver.received).toHaveLength(1);
    });

    it('refuses private destinations when SSRF protection is on', async () => {
      const protectedWorker = await createTestWorker({
        clock,
        config: workerConfig({ DELIVERY_ALLOW_PRIVATE_DESTINATIONS: 'false' }),
      });
      try {
        const delivery = await scheduleDelivery();

        expect(await protectedWorker.get(DeliveryAttemptRunner).attempt(delivery.id)).toBe(
          'DEAD_LETTERED',
        );

        expect(receiver.received).toHaveLength(0);
        expect(await attemptsOf(delivery.id)).toEqual([
          expect.objectContaining({
            outcome: 'PERMANENT_FAILURE',
            errorCode: 'BLOCKED_DESTINATION',
          }),
        ]);
      } finally {
        await protectedWorker.close();
      }
    });
  });

  describe('leases', () => {
    it('reclaims an expired lease as an UNKNOWN attempt, discards the late result, and delivers again', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'hold', status: 200 });

      // The worker sends, then stalls past its lease (for example a long GC pause).
      const stalled = runner().attempt(delivery.id);
      await receiver.waitForRequests(1);
      clock.advance(LEASE_MS + 1);
      expect(await worker.get(RecoverySweeper).sweep()).toMatchObject({ reclaimedLeases: 1 });
      receiver.release();

      expect(await stalled).toBe('LEASE_LOST');
      expect(await attemptsOf(delivery.id)).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          outcome: 'UNKNOWN',
          errorCode: 'LEASE_EXPIRED',
          durationMs: null,
        }),
      ]);
      const afterReclaim = await prisma.webhookDelivery.findUniqueOrThrow({
        where: { id: delivery.id },
      });
      expect(afterReclaim).toMatchObject({ status: 'PENDING', leaseOwner: null });

      // The receiver already has the webhook, yet RelayForge cannot know that: at-least-once.
      clock.set(afterReclaim.nextAttemptAt ?? clock.now());
      expect(await runner().attempt(delivery.id)).toBe('SUCCEEDED');
      expect(receiver.received.map((r) => r.headers['webhook-id'])).toEqual([
        delivery.eventId,
        delivery.eventId,
      ]);
      expect((await attemptsOf(delivery.id)).map((a) => a.outcome)).toEqual(['UNKNOWN', 'SUCCESS']);
    });

    it('never lets a stale worker finalise a delivery that another worker has re-claimed', async () => {
      const otherWorker = await createTestWorker({ clock, config: workerConfig() });
      try {
        const delivery = await scheduleDelivery();
        receiver.respondWith({ kind: 'hold', status: 200 }, { kind: 'hold', status: 200 });

        const stale = runner().attempt(delivery.id);
        await receiver.waitForRequests(1);
        clock.advance(LEASE_MS + 1);
        await worker.get(RecoverySweeper).sweep();
        const reclaimed = await prisma.webhookDelivery.findUniqueOrThrow({
          where: { id: delivery.id },
        });
        clock.set(reclaimed.nextAttemptAt ?? clock.now());

        const current = otherWorker.get(DeliveryAttemptRunner).attempt(delivery.id);
        await receiver.waitForRequests(2);
        receiver.release();

        expect(await stale).toBe('LEASE_LOST');
        expect(await current).toBe('SUCCEEDED');
        expect((await attemptsOf(delivery.id)).map((a) => [a.attemptNumber, a.outcome])).toEqual([
          [1, 'UNKNOWN'],
          [2, 'SUCCESS'],
        ]);
      } finally {
        await otherWorker.close();
      }
    });

    it('does not reclaim a lease that has not expired', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'hold', status: 200 });

      const inFlight = runner().attempt(delivery.id);
      await receiver.waitForRequests(1);
      expect(await worker.get(RecoverySweeper).sweep()).toMatchObject({ reclaimedLeases: 0 });
      receiver.release();

      expect(await inFlight).toBe('SUCCEEDED');
    });
  });

  describe('recovery sweep', () => {
    it('re-requests stranded work once, and prunes old published outbox rows', async () => {
      const delivery = await scheduleDelivery();
      // Pretend every outbox message was published long ago and the jobs were lost.
      await pool.query(`UPDATE outbox_messages SET published_at = $1`, [
        new Date(clock.now().getTime() - 2 * 86_400_000),
      ]);
      clock.advance(120_000);

      const first = await worker.get(RecoverySweeper).sweep();
      const second = await worker.get(RecoverySweeper).sweep();

      expect(first).toMatchObject({ requeuedDeliveries: 1, prunedOutboxMessages: 2 });
      expect(second).toMatchObject({ requeuedDeliveries: 0, requeuedEvents: 0 });
      expect(
        await prisma.outboxMessage.count({
          where: { aggregateId: delivery.id, publishedAt: null },
        }),
      ).toBe(1);
    });

    it('re-requests processing of an event whose job was lost', async () => {
      const signed = signMockPayRequest(connection, paymentSucceeded(), { signedAt: clock.now() });
      const accepted = await http()
        .post(`/v1/webhooks/${connection.ingressKey}`)
        .set(signed.headers)
        .send(signed.body)
        .expect(202);
      const { eventId } = accepted.body as { eventId: string };
      await pool.query(`UPDATE outbox_messages SET published_at = $1`, [clock.now()]);

      clock.advance(30_000);
      expect(await worker.get(RecoverySweeper).sweep()).toMatchObject({ requeuedEvents: 0 });
      clock.advance(60_000);
      expect(await worker.get(RecoverySweeper).sweep()).toMatchObject({ requeuedEvents: 1 });
      expect(
        await prisma.outboxMessage.count({ where: { aggregateId: eventId, publishedAt: null } }),
      ).toBe(1);
    });

    it('skips the sweep while another replica holds the sweep lock', async () => {
      const otherReplica = await pool.connect();
      try {
        await otherReplica.query('BEGIN');
        await otherReplica.query('SELECT pg_advisory_xact_lock($1)', [SWEEP_LOCK_KEY.toString()]);

        expect(await worker.get(RecoverySweeper).sweep()).toBeNull();
      } finally {
        await otherReplica.query('ROLLBACK');
        otherReplica.release();
      }
      expect(await worker.get(RecoverySweeper).sweep()).not.toBeNull();
    });
  });

  describe('replay', () => {
    const deadLettered = async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'respond', status: 410 });
      await runner().attempt(delivery.id);
      return delivery;
    };

    it('creates a new delivery referencing the untouched original, audits it, and delivers it', async () => {
      const original = await deadLettered();

      const response = await http()
        .post(`/v1/deliveries/${original.id}/replay`)
        .set(bearer(admin))
        .set('x-request-id', 'replay-1')
        .expect(202);
      const { deliveryId } = response.body as { deliveryId: string };

      expect(response.body).toEqual({ deliveryId, replayOfDeliveryId: original.id });
      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: original.id } }),
      ).toMatchObject({
        status: 'DEAD_LETTER',
        attemptCount: 1,
      });
      expect(await attemptsOf(original.id)).toHaveLength(1);
      expect(
        await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId } }),
      ).toMatchObject({
        status: 'PENDING',
        replayOfDeliveryId: original.id,
        eventId: original.eventId,
        payload: original.payload,
        attemptCount: 0,
      });
      expect(
        await prisma.auditLog.findFirstOrThrow({ where: { action: 'delivery.replayed' } }),
      ).toMatchObject({
        resourceId: original.id,
        actorId: admin.id,
        requestId: 'replay-1',
        metadata: { replayDeliveryId: deliveryId, originalStatus: 'DEAD_LETTER' },
      });

      expect(await runner().attempt(deliveryId)).toBe('SUCCEEDED');
      expect(receiver.received.map((r) => r.headers['webhook-id'])).toEqual([
        original.eventId,
        original.eventId,
      ]);
    });

    it('allows only one active replay at a time, even under concurrent requests', async () => {
      const original = await deadLettered();

      const responses = await Promise.all([
        http().post(`/v1/deliveries/${original.id}/replay`).set(bearer(admin)),
        http().post(`/v1/deliveries/${original.id}/replay`).set(bearer(admin)),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([202, 409]);
      const conflict = responses.find((r) => r.status === 409);
      expect(conflict?.body).toMatchObject({ error: { code: 'REPLAY_IN_PROGRESS' } });
      expect(
        await prisma.webhookDelivery.count({ where: { replayOfDeliveryId: original.id } }),
      ).toBe(1);
    });

    it('refuses to replay a delivery that is not final, or whose endpoint is gone', async () => {
      const pending = await scheduleDelivery();
      const pendingResponse = await http()
        .post(`/v1/deliveries/${pending.id}/replay`)
        .set(bearer(admin))
        .expect(409);
      expect(pendingResponse.body).toMatchObject({ error: { code: 'DELIVERY_NOT_REPLAYABLE' } });

      const original = await deadLettered();
      await prisma.webhookEndpoint.update({
        where: { id: endpointId },
        data: { deletedAt: clock.now(), isActive: false },
      });
      const goneResponse = await http()
        .post(`/v1/deliveries/${original.id}/replay`)
        .set(bearer(admin))
        .expect(409);
      expect(goneResponse.body).toMatchObject({ error: { code: 'ENDPOINT_UNAVAILABLE' } });
    });

    it('restricts replay to ADMIN keys in the same workspace', async () => {
      const original = await deadLettered();
      const member = await createApiKey(prisma, connection.workspaceId, ApiKeyRole.MEMBER);
      const outsider = await createApiKey(prisma, await createWorkspace(prisma), ApiKeyRole.ADMIN);

      await http().post(`/v1/deliveries/${original.id}/replay`).set(bearer(member)).expect(403);
      await http().post(`/v1/deliveries/${original.id}/replay`).set(bearer(outsider)).expect(404);
    });
  });

  describe('deliveries API', () => {
    it('lists dead-lettered deliveries and shows every attempt', async () => {
      const delivery = await scheduleDelivery();
      receiver.respondWith({ kind: 'respond', status: 500 }, { kind: 'respond', status: 404 });
      await runner().attempt(delivery.id);
      clock.advance(3_600_000);
      await runner().attempt(delivery.id);

      const list = await http()
        .get('/v1/deliveries?status=DEAD_LETTER')
        .set(bearer(admin))
        .expect(200);
      expect((list.body as { data: { id: string }[] }).data.map((d) => d.id)).toEqual([
        delivery.id,
      ]);

      const detail = await http()
        .get(`/v1/deliveries/${delivery.id}`)
        .set(bearer(admin))
        .expect(200);
      expect(detail.body).toMatchObject({
        status: 'DEAD_LETTER',
        deadLetterReason: 'NON_RETRYABLE_RESPONSE',
        payload: delivery.payload as object,
        attempts: [
          { attemptNumber: 1, outcome: 'RETRYABLE_FAILURE', responseStatus: 500 },
          { attemptNumber: 2, outcome: 'PERMANENT_FAILURE', responseStatus: 404 },
        ],
      });
    });
  });

  it('delivers end to end through the outbox, both queues and both consumers', async () => {
    const signed = signMockPayRequest(connection, paymentSucceeded(), { signedAt: clock.now() });
    await http()
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .send(signed.body)
      .expect(202);
    worker.get(EventProcessingConsumer).start();
    worker.get(DeliveryConsumer).start();
    const publisher = worker.get(OutboxPublisher);

    const deadline = Date.now() + 15_000;
    while (receiver.received.length === 0 && Date.now() < deadline) {
      await publisher.publishBatch();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(receiver.received).toHaveLength(1);
    let status = '';
    while (status !== 'SUCCEEDED' && Date.now() < deadline) {
      status = (await prisma.webhookDelivery.findFirstOrThrow()).status;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(status).toBe('SUCCEEDED');
  });
});
