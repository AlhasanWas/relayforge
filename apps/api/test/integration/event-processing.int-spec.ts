import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { generateWebhookSecret } from '@relayforge/shared/webhooks';
import type { Pool } from 'pg';
import request from 'supertest';
import { SecretCipher } from '../../src/crypto/secret-cipher';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisher } from '../../src/outbox/outbox-publisher';
import { EventProcessingConsumer } from '../../src/processing/event-processing.consumer';
import { EventProcessor } from '../../src/processing/event-processor';
import { createTestPool, truncateAllTables } from './support/database';
import { createWorkspace } from './support/fixtures';
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

const MAX_PROCESSING_ATTEMPTS = 3;

describe('event processing', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let processor: EventProcessor;
  let pool: Pool;
  let connection: TestConnection;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    worker = await createTestWorker({
      clock,
      config: createTestConfig({
        WORKER_AUTOSTART: 'false',
        EVENT_PROCESSING_MAX_ATTEMPTS: String(MAX_PROCESSING_ATTEMPTS),
        EVENT_PROCESSING_RETRY_BASE_MS: '4000',
        DELIVERY_MAX_ATTEMPTS: '6',
      }),
    });
    prisma = worker.get(PrismaService);
    processor = worker.get(EventProcessor);
    pool = createTestPool();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    clock.set(new Date('2026-09-15T12:00:00.000Z'));
    connection = await createMockPayConnection(app, await createWorkspace(prisma));
  });

  const ingest = async (event: MockPayEventBody): Promise<string> => {
    const signed = signMockPayRequest(connection, event, { signedAt: clock.now() });
    const response = await request(app.getHttpServer())
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .send(signed.body)
      .expect(202);
    return (response.body as { eventId: string }).eventId;
  };

  const createEndpoint = (
    eventTypes: string[],
    overrides: { isActive?: boolean; deletedAt?: Date | null; workspaceId?: string } = {},
  ) =>
    prisma.webhookEndpoint.create({
      data: {
        workspaceId: overrides.workspaceId ?? connection.workspaceId,
        url: 'https://customer.example/webhooks',
        eventTypes,
        signingSecretEncrypted: app
          .get(SecretCipher)
          .encrypt(generateWebhookSecret(), 'webhook_endpoint.signing_secret'),
        isActive: overrides.isActive ?? true,
        deletedAt: overrides.deletedAt ?? null,
      },
    });

  const succeeded = (paymentId: string, amount = 1999) =>
    paymentSucceeded({ data: { payment_id: paymentId, amount, currency: 'USD' } });

  const refunded = (paymentId: string, amount: number, refundId = `re_${randomUUID()}`) =>
    paymentSucceeded({
      type: 'payment.refunded',
      data: { refund_id: refundId, payment_id: paymentId, amount, currency: 'USD' },
    });

  /** Net debit balance per account code for the connection's workspace. */
  const balances = async (): Promise<Record<string, bigint>> => {
    const { rows } = await pool.query<{ code: string; net: string }>(
      `SELECT a.code,
              sum(CASE p.direction WHEN 'DEBIT' THEN p.amount_minor ELSE -p.amount_minor END) AS net
         FROM ledger_postings p JOIN ledger_accounts a ON a.id = p.account_id
        WHERE p.workspace_id = $1
        GROUP BY a.code`,
      [connection.workspaceId],
    );
    return Object.fromEntries(rows.map((row) => [row.code, BigInt(row.net)]));
  };

  describe('payment.succeeded', () => {
    it('creates the transaction, a balanced journal, and deliveries for subscribed endpoints atomically', async () => {
      const subscribed = await createEndpoint(['payment.succeeded', 'payment.refunded']);
      await createEndpoint(['payment.succeeded'], { isActive: false });
      await createEndpoint(['payment.succeeded'], { deletedAt: clock.now() });
      await createEndpoint(['payment.failed']);
      const eventId = await ingest(succeeded('pay_1'));

      expect(await processor.process(eventId)).toBe('PROCESSED');

      const event = await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } });
      expect(event).toMatchObject({
        status: 'PROCESSED',
        processedAt: clock.now(),
        processingAttempts: 1,
      });

      const transaction = await prisma.transaction.findFirstOrThrow();
      expect(transaction).toMatchObject({
        workspaceId: connection.workspaceId,
        externalPaymentId: 'pay_1',
        status: 'SUCCEEDED',
        amountMinor: 1999n,
        refundedAmountMinor: 0n,
        currency: 'USD',
        createdByEventId: eventId,
      });

      const journals = await prisma.ledgerTransaction.findMany({
        include: { postings: { include: { account: true } } },
      });
      expect(journals).toHaveLength(1);
      expect(journals[0]).toMatchObject({
        kind: 'PAYMENT_CAPTURED',
        transactionId: transaction.id,
        sourceEventId: eventId,
        externalReferenceId: 'pay_1',
      });
      expect(
        journals[0]?.postings
          .map((posting) => [posting.account.code, posting.direction, posting.amountMinor])
          .sort(),
      ).toEqual([
        ['merchant_balance', 'CREDIT', 1999n],
        ['provider_clearing', 'DEBIT', 1999n],
      ]);

      const deliveries = await prisma.webhookDelivery.findMany();
      expect(deliveries).toEqual([
        expect.objectContaining({
          endpointId: subscribed.id,
          eventId,
          status: 'PENDING',
          attemptCount: 0,
          maxAttempts: 6,
          nextAttemptAt: clock.now(),
          payload: {
            id: eventId,
            type: 'payment.succeeded',
            created_at: clock.now().toISOString(),
            data: {
              transaction: {
                id: transaction.id,
                provider_payment_id: 'pay_1',
                status: 'SUCCEEDED',
                currency: 'USD',
                amount_minor: '1999',
                refunded_amount_minor: '0',
              },
            },
          },
        }),
      ]);
      expect(
        await prisma.outboxMessage.findMany({ where: { topic: 'WEBHOOK_DELIVERY_REQUESTED' } }),
      ).toEqual([
        expect.objectContaining({ aggregateId: deliveries[0]?.id, availableAt: clock.now() }),
      ]);
    });

    it('is a no-op when the same event is processed again', async () => {
      const eventId = await ingest(succeeded('pay_1'));

      await processor.process(eventId);
      expect(await processor.process(eventId)).toBe('ALREADY_FINAL');

      expect(await prisma.transaction.count()).toBe(1);
      expect(await prisma.ledgerTransaction.count()).toBe(1);
    });

    it('creates exactly one transaction, one journal and two postings under concurrent duplicate delivery and processing', async () => {
      const event = succeeded('pay_concurrent');
      const signed = signMockPayRequest(connection, event, { signedAt: clock.now() });
      const responses = await Promise.all(
        Array.from({ length: 25 }, () =>
          request(app.getHttpServer())
            .post(`/v1/webhooks/${connection.ingressKey}`)
            .set(signed.headers)
            .send(signed.body),
        ),
      );
      expect(new Set(responses.map((response) => response.status))).toEqual(new Set([202]));
      const eventId = (responses[0]?.body as { eventId: string }).eventId;

      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () => processor.process(eventId)),
      );

      expect(outcomes.filter((outcome) => outcome === 'PROCESSED')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'ALREADY_FINAL')).toHaveLength(9);
      expect(await prisma.incomingEvent.count()).toBe(1);
      expect(await prisma.transaction.count()).toBe(1);
      expect(await prisma.ledgerTransaction.count()).toBe(1);
      expect(await prisma.ledgerPosting.count()).toBe(2);
      expect(await balances()).toEqual({ provider_clearing: 1999n, merchant_balance: -1999n });
    });

    it('leaves no partial state when the transaction fails midway', async () => {
      await createEndpoint(['payment.succeeded']);
      const eventId = await ingest(succeeded('pay_rollback'));
      await pool.query(`
        CREATE FUNCTION test_fail_delivery_insert() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'simulated failure after ledger writes'; END; $$;
        CREATE TRIGGER test_fail_delivery_insert BEFORE INSERT ON webhook_deliveries
          FOR EACH ROW EXECUTE FUNCTION test_fail_delivery_insert();`);
      try {
        await expect(processor.process(eventId)).rejects.toThrow();
      } finally {
        await pool.query(`
          DROP TRIGGER test_fail_delivery_insert ON webhook_deliveries;
          DROP FUNCTION test_fail_delivery_insert();`);
      }

      expect(await prisma.transaction.count()).toBe(0);
      expect(await prisma.ledgerTransaction.count()).toBe(0);
      expect(await prisma.ledgerPosting.count()).toBe(0);
      expect(await prisma.ledgerAccount.count()).toBe(0);
      expect(await prisma.webhookDelivery.count()).toBe(0);
      expect(
        await prisma.outboxMessage.count({ where: { topic: 'WEBHOOK_DELIVERY_REQUESTED' } }),
      ).toBe(0);
      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).toMatchObject({
        status: 'RECEIVED',
        processingAttempts: 0,
      });

      // Once the failure is gone the same event processes normally.
      expect(await processor.process(eventId)).toBe('PROCESSED');
    });

    it('rejects a second capture of the same payment under a different event id', async () => {
      await processor.process(await ingest(succeeded('pay_twice')));

      const secondId = await ingest(succeeded('pay_twice'));
      expect(await processor.process(secondId)).toBe('FAILED');

      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: secondId } }),
      ).toMatchObject({
        status: 'FAILED',
        failureReason: 'INVALID_TRANSITION',
      });
      expect(await prisma.ledgerTransaction.count()).toBe(1);
    });
  });

  describe('payment.failed', () => {
    it('records a failed transaction without touching the ledger', async () => {
      const endpoint = await createEndpoint(['payment.failed']);
      const eventId = await ingest(
        paymentSucceeded({
          type: 'payment.failed',
          data: {
            payment_id: 'pay_failed',
            amount: 500,
            currency: 'USD',
            failure_code: 'card_declined',
          },
        }),
      );

      expect(await processor.process(eventId)).toBe('PROCESSED');

      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        status: 'FAILED',
        amountMinor: 500n,
      });
      expect(await prisma.ledgerTransaction.count()).toBe(0);
      expect(await prisma.webhookDelivery.findFirstOrThrow()).toMatchObject({
        endpointId: endpoint.id,
      });
    });
  });

  describe('payment.refunded', () => {
    it('applies partial then full refunds as balanced reversals that net the ledger to zero', async () => {
      await processor.process(await ingest(succeeded('pay_refund', 1000)));

      expect(await processor.process(await ingest(refunded('pay_refund', 400)))).toBe('PROCESSED');
      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        status: 'PARTIALLY_REFUNDED',
        refundedAmountMinor: 400n,
      });

      expect(await processor.process(await ingest(refunded('pay_refund', 600)))).toBe('PROCESSED');
      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        status: 'REFUNDED',
        refundedAmountMinor: 1000n,
      });

      expect(await prisma.ledgerTransaction.count({ where: { kind: 'PAYMENT_REFUNDED' } })).toBe(2);
      expect(await balances()).toEqual({ provider_clearing: 0n, merchant_balance: 0n });
    });

    it('rejects a refund exceeding the captured amount and leaves financial state unchanged', async () => {
      await processor.process(await ingest(succeeded('pay_over', 1000)));

      const eventId = await ingest(refunded('pay_over', 1001));
      expect(await processor.process(eventId)).toBe('FAILED');

      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } }),
      ).toMatchObject({
        failureReason: 'REFUND_EXCEEDS_CAPTURED',
      });
      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        status: 'SUCCEEDED',
        refundedAmountMinor: 0n,
      });
      expect(await prisma.ledgerTransaction.count()).toBe(1);
    });

    it('rejects the same provider refund delivered under a different event id', async () => {
      await processor.process(await ingest(succeeded('pay_dup_refund', 1000)));
      await processor.process(await ingest(refunded('pay_dup_refund', 100, 're_same')));

      const duplicateId = await ingest(refunded('pay_dup_refund', 100, 're_same'));
      expect(await processor.process(duplicateId)).toBe('FAILED');

      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: duplicateId } }),
      ).toMatchObject({
        failureReason: 'DUPLICATE_REFUND',
      });
      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        refundedAmountMinor: 100n,
      });
    });

    it('waits for a payment that has not arrived yet, then applies the refund once it has', async () => {
      const refundId = await ingest(refunded('pay_late', 300));

      expect(await processor.process(refundId)).toBe('RETRY_SCHEDULED');
      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: refundId } }),
      ).toMatchObject({
        status: 'RECEIVED',
        processingAttempts: 1,
      });
      // Attempt 1, base 4 s, random 0.5: 2 s + 0.5 * 2 s = 3 s.
      const retry = await prisma.outboxMessage.findFirstOrThrow({
        where: { aggregateId: refundId, availableAt: { gt: clock.now() } },
      });
      expect(retry.availableAt).toEqual(new Date(clock.now().getTime() + 3_000));

      await processor.process(await ingest(succeeded('pay_late', 1000)));
      clock.advance(3_000);

      expect(await processor.process(refundId, retry.id)).toBe('PROCESSED');
      expect(await prisma.transaction.findFirstOrThrow()).toMatchObject({
        refundedAmountMinor: 300n,
      });
    });

    it('ignores a stale job while a newer retry is scheduled', async () => {
      const refundId = await ingest(refunded('pay_stale', 300));
      const original = await prisma.outboxMessage.findFirstOrThrow({
        where: { aggregateId: refundId },
      });
      await processor.process(refundId, original.id);

      expect(await processor.process(refundId, original.id)).toBe('SUPERSEDED');
      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: refundId } }),
      ).toMatchObject({
        processingAttempts: 1,
      });
    });

    it('fails the event after the maximum number of attempts', async () => {
      const refundId = await ingest(refunded('pay_never', 300));

      const outcomes = [];
      for (let attempt = 0; attempt < MAX_PROCESSING_ATTEMPTS; attempt += 1) {
        outcomes.push(await processor.process(refundId));
      }

      expect(outcomes).toEqual(['RETRY_SCHEDULED', 'RETRY_SCHEDULED', 'FAILED']);
      expect(
        await prisma.incomingEvent.findUniqueOrThrow({ where: { id: refundId } }),
      ).toMatchObject({
        status: 'FAILED',
        failureReason: 'TRANSACTION_NOT_FOUND',
        processingAttempts: MAX_PROCESSING_ATTEMPTS,
      });
    });
  });

  it('marks unknown event types IGNORED without deliveries', async () => {
    await createEndpoint(['payment.succeeded']);
    const eventId = await ingest(
      paymentSucceeded({ type: 'customer.created', data: { customer_id: 'cus_1' } }),
    );

    expect(await processor.process(eventId)).toBe('IGNORED');

    expect(await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({
      status: 'IGNORED',
    });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it('fails a poison event after BullMQ exhausts its attempts, and never overrides a final status', async () => {
    const poisonId = await ingest(succeeded('pay_poison'));
    const doneId = await ingest(succeeded('pay_done'));
    await processor.process(doneId);

    await processor.markFailedAfterUnexpectedErrors(poisonId);
    await processor.markFailedAfterUnexpectedErrors(doneId);

    expect(await prisma.incomingEvent.findUniqueOrThrow({ where: { id: poisonId } })).toMatchObject(
      {
        status: 'FAILED',
        failureReason: 'PROCESSING_ERROR',
      },
    );
    expect(await prisma.incomingEvent.findUniqueOrThrow({ where: { id: doneId } })).toMatchObject({
      status: 'PROCESSED',
    });
  });

  it('processes an ingested event end to end through the outbox publisher and a BullMQ worker', async () => {
    const eventId = await ingest(succeeded('pay_e2e'));
    worker.get(EventProcessingConsumer).start();

    expect(await worker.get(OutboxPublisher).publishBatch()).toMatchObject({ published: 1 });

    const deadline = Date.now() + 10_000;
    let status = 'RECEIVED';
    while (status === 'RECEIVED' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      status = (await prisma.incomingEvent.findUniqueOrThrow({ where: { id: eventId } })).status;
    }
    expect(status).toBe('PROCESSED');
    expect(await prisma.ledgerPosting.count()).toBe(2);
  });
});
