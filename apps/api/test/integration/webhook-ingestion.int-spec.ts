import type { NestExpressApplication } from '@nestjs/platform-express';
import { generateWebhookSecret } from '@relayforge/shared/webhooks';
import type { Pool } from 'pg';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service';
import { createTestPool, truncateAllTables } from './support/database';
import { createApiKey, createWorkspace } from './support/fixtures';
import {
  createMockPayConnection,
  paymentSucceeded,
  type SignedRequest,
  signMockPayRequest,
  type TestConnection,
} from './support/mockpay';
import { MutableClock } from './support/mutable-clock';
import { flushTestRedis } from './support/redis';
import { createTestApp } from './support/test-app';
import { createTestConfig } from './support/test-environment';

describe('webhook ingestion', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pool: Pool;
  let connection: TestConnection;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    prisma = app.get(PrismaService);
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    clock.set(new Date('2026-09-15T12:00:00.000Z'));
    connection = await createMockPayConnection(app, await createWorkspace(prisma));
  });

  const send = (signed: SignedRequest, target: TestConnection = connection) =>
    request(app.getHttpServer())
      .post(`/v1/webhooks/${target.ingressKey}`)
      .set(signed.headers)
      .send(signed.body);

  const signed = (
    event = paymentSucceeded(),
    options: { secret?: string; messageId?: string } = {},
  ) => signMockPayRequest(connection, event, { signedAt: clock.now(), ...options });

  const counts = async () => ({
    events: await prisma.incomingEvent.count(),
    outbox: await prisma.outboxMessage.count(),
    rejected: await prisma.rejectedWebhookAttempt.count(),
  });

  describe('accepted webhooks', () => {
    it('stores a validly signed event and its outbox message atomically, then returns 202', async () => {
      const event = paymentSucceeded();

      const response = await send(signed(event)).expect(202);

      const { eventId } = response.body as { eventId: string };
      expect(response.body).toEqual({ eventId, duplicate: false });

      const stored = await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(stored).toMatchObject({
        workspaceId: connection.workspaceId,
        providerConnectionId: connection.id,
        externalEventId: event.id,
        eventType: 'payment.succeeded',
        payload: event,
        signatureValid: true,
        status: 'RECEIVED',
        receivedAt: clock.now(),
      });
      expect(stored.payloadHash).toMatch(/^[0-9a-f]{64}$/);

      const outbox = await prisma.outboxMessage.findMany();
      expect(outbox).toEqual([
        expect.objectContaining({
          workspaceId: connection.workspaceId,
          topic: 'EVENT_PROCESSING_REQUESTED',
          aggregateId: eventId,
          availableAt: clock.now(),
          publishedAt: null,
        }),
      ]);
    });

    it('accepts a validly signed event of an unknown type, so providers do not retry it', async () => {
      const response = await send(
        signed(paymentSucceeded({ type: 'customer.created', data: { customer_id: 'cus_1' } })),
      ).expect(202);

      const stored = await prisma.incomingEvent.findUniqueOrThrow({
        where: { id: (response.body as { eventId: string }).eventId },
      });
      expect(stored.eventType).toBe('customer.created');
    });

    it('treats a byte-identical redelivery as a duplicate with the same response status', async () => {
      const webhook = signed();

      const first = await send(webhook).expect(202);
      const second = await send(webhook).expect(202);

      expect(second.body).toEqual({
        eventId: (first.body as { eventId: string }).eventId,
        duplicate: true,
      });
      expect(await counts()).toEqual({ events: 1, outbox: 1, rejected: 0 });
    });

    it('stores exactly one event and one outbox message under 25 concurrent identical requests', async () => {
      const webhook = signed();

      const responses = await Promise.all(Array.from({ length: 25 }, () => send(webhook)));

      expect(responses.map((response) => response.status)).toEqual(Array(25).fill(202));
      const bodies = responses.map(
        (response) => response.body as { eventId: string; duplicate: boolean },
      );
      expect(new Set(bodies.map((body) => body.eventId)).size).toBe(1);
      expect(bodies.filter((body) => !body.duplicate)).toHaveLength(1);
      expect(await counts()).toEqual({ events: 1, outbox: 1, rejected: 0 });
    });

    it('keeps idempotency per connection: two workspaces may receive the same external id', async () => {
      const otherConnection = await createMockPayConnection(app, await createWorkspace(prisma));
      const event = paymentSucceeded();

      await send(signed(event)).expect(202);
      await send(
        signMockPayRequest(otherConnection, event, { signedAt: clock.now() }),
        otherConnection,
      ).expect(202);

      expect(await prisma.incomingEvent.count({ where: { externalEventId: event.id } })).toBe(2);
    });

    it('does not persist an event when its outbox message cannot be written', async () => {
      await pool.query(`
        CREATE FUNCTION test_fail_outbox_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated outbox failure'; END; $$;
        CREATE TRIGGER test_fail_outbox_insert BEFORE INSERT ON outbox_messages
          FOR EACH ROW EXECUTE FUNCTION test_fail_outbox_insert();`);
      try {
        const response = await send(signed()).expect(500);

        expect(response.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
        expect(await counts()).toEqual({ events: 0, outbox: 0, rejected: 0 });
      } finally {
        await pool.query(`
          DROP TRIGGER test_fail_outbox_insert ON outbox_messages;
          DROP FUNCTION test_fail_outbox_insert();`);
      }
    });
  });

  describe('rejected webhooks', () => {
    const rejectedAttempts = () => prisma.rejectedWebhookAttempt.findMany();

    it('rejects an invalid signature, stores no event, and records a safe security record', async () => {
      const webhook = signed(paymentSucceeded(), { secret: generateWebhookSecret() });

      const response = await send(webhook).set('x-request-id', 'forged-1').expect(401);

      expect(response.body).toMatchObject({
        error: { code: 'SIGNATURE_VERIFICATION_FAILED', details: { reason: 'INVALID_SIGNATURE' } },
      });
      expect(await counts()).toEqual({ events: 0, outbox: 0, rejected: 1 });

      const [attempt] = await rejectedAttempts();
      expect(attempt).toMatchObject({
        workspaceId: connection.workspaceId,
        providerConnectionId: connection.id,
        reason: 'INVALID_SIGNATURE',
        requestId: 'forged-1',
        bodyBytes: Buffer.byteLength(webhook.body),
      });
      const serialized = JSON.stringify(attempt);
      expect(serialized).not.toContain(webhook.headers['webhook-signature']);
      expect(serialized).not.toContain(webhook.body);
    });

    it('rejects a stale timestamp even when the signature is authentic', async () => {
      const webhook = signed();
      clock.advance(301_000);

      const response = await send(webhook).expect(401);

      expect(response.body).toMatchObject({
        error: { details: { reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' } },
      });
      expect((await rejectedAttempts())[0]?.reason).toBe('TIMESTAMP_OUTSIDE_TOLERANCE');
    });

    it('accepts an old timestamp when the connection disables the tolerance check', async () => {
      const lenient = await createMockPayConnection(app, connection.workspaceId, {
        timestampToleranceSec: null,
      });
      const webhook = signMockPayRequest(lenient, paymentSucceeded(), { signedAt: clock.now() });
      clock.advance(86_400_000);

      await send(webhook, lenient).expect(202);
    });

    it('rejects a request without signature headers', async () => {
      const webhook = signed();

      await request(app.getHttpServer())
        .post(`/v1/webhooks/${connection.ingressKey}`)
        .set('content-type', 'application/json')
        .send(webhook.body)
        .expect(401);

      expect((await rejectedAttempts())[0]?.reason).toBe('MISSING_SIGNATURE_HEADERS');
    });

    it('does not let a forged request reserve an event id ahead of the genuine event', async () => {
      const genuine = paymentSucceeded();
      const forged = { ...genuine, data: { ...genuine.data, amount: 999_999 } };

      await send(signed(forged, { secret: generateWebhookSecret() })).expect(401);
      const response = await send(signed(genuine)).expect(202);

      expect(response.body).toMatchObject({ duplicate: false });
      const stored = await prisma.incomingEvent.findFirstOrThrow({
        where: { externalEventId: genuine.id },
      });
      expect(stored.payload).toEqual(genuine);
    });

    it('rejects the same event id with a different payload as a conflict and keeps the original', async () => {
      const original = paymentSucceeded();
      const altered = { ...original, data: { ...original.data, amount: 1 } };

      await send(signed(original)).expect(202);
      const response = await send(signed(altered)).expect(409);

      expect(response.body).toMatchObject({ error: { code: 'EVENT_PAYLOAD_CONFLICT' } });
      const stored = await prisma.incomingEvent.findFirstOrThrow({
        where: { externalEventId: original.id },
      });
      expect(stored.payload).toEqual(original);
      expect((await rejectedAttempts())[0]?.reason).toBe('PAYLOAD_CONFLICT');
    });

    it('rejects an authenticated but schema-invalid payload with issue paths and no values', async () => {
      const invalid = paymentSucceeded({
        data: { payment_id: 'pay_1', amount: -5, currency: 'USD' },
      });

      const response = await send(signed(invalid)).expect(422);

      expect(response.body).toMatchObject({
        error: {
          code: 'INVALID_PAYLOAD',
          details: [expect.objectContaining({ path: 'data.amount' })],
        },
      });
      const [attempt] = await rejectedAttempts();
      expect(attempt?.reason).toBe('INVALID_PAYLOAD');
      expect(JSON.stringify(attempt?.metadata)).not.toContain('-5');
    });

    it('rejects authenticated bytes that are not JSON', async () => {
      const webhook = signMockPayRequest(connection, '{"id": "evt_raw", ', {
        signedAt: clock.now(),
        messageId: 'evt_raw',
      });

      await send(webhook).expect(422);
      expect((await rejectedAttempts())[0]?.reason).toBe('INVALID_PAYLOAD');
    });

    it('rejects an event whose id differs from the signed webhook-id', async () => {
      await send(signed(paymentSucceeded(), { messageId: 'evt_something_else' })).expect(422);
    });

    it('rejects a non-JSON content type after verifying the signature', async () => {
      const webhook = signed();

      await send({
        ...webhook,
        headers: { ...webhook.headers, 'content-type': 'text/plain' },
      }).expect(415);
      expect(await counts()).toMatchObject({ events: 0, rejected: 1 });
    });

    it('answers 404 for an unknown ingress key and records nothing', async () => {
      const unknown = { ...connection, ingressKey: `ing_${'x'.repeat(24)}` };

      await send(signed(), unknown).expect(404);
      await send(signed(), { ...connection, ingressKey: 'not-even-well-formed' }).expect(404);

      expect(await counts()).toEqual({ events: 0, outbox: 0, rejected: 0 });
    });

    it('answers 404 for a disabled connection and records the attempt', async () => {
      const disabled = await createMockPayConnection(app, connection.workspaceId, {
        enabled: false,
      });

      await send(
        signMockPayRequest(disabled, paymentSucceeded(), { signedAt: clock.now() }),
        disabled,
      ).expect(404);

      expect((await rejectedAttempts())[0]).toMatchObject({
        providerConnectionId: disabled.id,
        reason: 'CONNECTION_DISABLED',
      });
    });
  });

  describe('events and rejected attempts API', () => {
    it('lists and reads events only within the caller workspace', async () => {
      const apiKey = await createApiKey(prisma, connection.workspaceId, 'MEMBER');
      const outsider = await createApiKey(prisma, await createWorkspace(prisma), 'ADMIN');
      const accepted = await send(signed()).expect(202);
      const { eventId } = accepted.body as { eventId: string };

      const list = await request(app.getHttpServer())
        .get('/v1/events?status=RECEIVED')
        .set('Authorization', `Bearer ${apiKey.key}`)
        .expect(200);
      expect((list.body as { data: { id: string }[] }).data.map((event) => event.id)).toEqual([
        eventId,
      ]);
      expect(JSON.stringify(list.body)).not.toContain('"payload"');

      const detail = await request(app.getHttpServer())
        .get(`/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${apiKey.key}`)
        .expect(200);
      expect(detail.body).toMatchObject({
        id: eventId,
        status: 'RECEIVED',
        payload: expect.any(Object) as unknown,
      });

      await request(app.getHttpServer())
        .get(`/v1/events/${eventId}`)
        .set('Authorization', `Bearer ${outsider.key}`)
        .expect(404);
    });

    it('lists rejected attempts and provider connections without exposing secrets', async () => {
      const apiKey = await createApiKey(prisma, connection.workspaceId, 'MEMBER');
      await send(signed(paymentSucceeded(), { secret: generateWebhookSecret() })).expect(401);

      const rejected = await request(app.getHttpServer())
        .get('/v1/rejected-webhook-attempts?reason=INVALID_SIGNATURE')
        .set('Authorization', `Bearer ${apiKey.key}`)
        .expect(200);
      expect((rejected.body as { data: unknown[] }).data).toHaveLength(1);

      const connections = await request(app.getHttpServer())
        .get('/v1/provider-connections')
        .set('Authorization', `Bearer ${apiKey.key}`)
        .expect(200);
      expect(connections.body).toMatchObject({
        data: [
          {
            id: connection.id,
            publicIngressKey: connection.ingressKey,
            ingressPath: `/v1/webhooks/${connection.ingressKey}`,
            provider: { slug: 'mockpay' },
          },
        ],
      });
      const serialized = JSON.stringify(connections.body);
      expect(serialized).not.toContain(connection.secret);
      expect(serialized).not.toContain('signingSecret');
    });
  });
});

describe('webhook ingestion limits', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let pool: Pool;
  let connection: TestConnection;

  beforeAll(async () => {
    app = await createTestApp({
      clock,
      config: createTestConfig({
        INGESTION_MAX_BODY_BYTES: '2048',
        RATE_LIMIT_INGESTION_MAX: '3',
        HTTP_TRUST_PROXY_HOPS: '1',
      }),
    });
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    connection = await createMockPayConnection(app, await createWorkspace(app.get(PrismaService)));
  });

  const send = (signed: SignedRequest, forwardedFor = '198.51.100.7') =>
    request(app.getHttpServer())
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .set('x-forwarded-for', forwardedFor)
      .send(signed.body);

  it('rejects a body larger than the ingestion limit with 413', async () => {
    const oversized = paymentSucceeded({
      data: { payment_id: 'p', amount: 1, currency: 'USD', note: 'x'.repeat(4096) },
    });

    const response = await send(
      signMockPayRequest(connection, oversized, { signedAt: clock.now() }),
    ).expect(413);

    expect(response.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('rate limits per ingress key and client IP', async () => {
    const next = () =>
      signMockPayRequest(connection, paymentSucceeded(), { signedAt: clock.now() });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await send(next()).expect(202);
    }
    const limited = await send(next()).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();

    // Another client IP behind the trusted proxy has its own budget.
    await send(next(), '198.51.100.8').expect(202);
  });

  it('records the client IP from the trusted proxy header on rejected attempts', async () => {
    await send(
      signMockPayRequest(connection, paymentSucceeded(), {
        signedAt: clock.now(),
        secret: generateWebhookSecret(),
      }),
      '203.0.113.50',
    ).expect(401);

    const attempt = await app.get(PrismaService).rejectedWebhookAttempt.findFirstOrThrow();
    expect(attempt.sourceIp).toBe('203.0.113.50');
  });
});
