import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxTopic } from '../../src/generated/prisma/client';
import { OutboxPublisher } from '../../src/outbox/outbox-publisher';
import { QUEUES, type QueueRegistry } from '../../src/queue/queue.module';
import { QueueName } from '../../src/queue/queues';
import { createTestPool, truncateAllTables } from './support/database';
import { createWorkspace } from './support/fixtures';
import { MutableClock } from './support/mutable-clock';
import { flushTestRedis } from './support/redis';
import { createTestConfig } from './support/test-environment';
import { createTestWorker } from './support/test-worker';

describe('outbox publisher', () => {
  const clock = new MutableClock();
  let worker: TestingModule;
  let prisma: PrismaService;
  let pool: Pool;
  let queues: QueueRegistry;
  let workspaceId: string;

  beforeAll(async () => {
    worker = await createTestWorker({ clock });
    prisma = worker.get(PrismaService);
    queues = worker.get<QueueRegistry>(QUEUES);
    pool = createTestPool();
  });

  afterAll(async () => {
    await worker.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    clock.set(new Date('2026-09-15T12:00:00.000Z'));
    workspaceId = await createWorkspace(prisma);
  });

  const addMessage = (
    topic: OutboxTopic = OutboxTopic.EVENT_PROCESSING_REQUESTED,
    availableAt: Date = clock.now(),
  ) =>
    prisma.outboxMessage.create({
      data: { workspaceId, topic, aggregateId: randomUUID(), availableAt },
    });

  const publisher = () => worker.get(OutboxPublisher);

  it('publishes due messages to their queues with the outbox id as job id, then marks them published', async () => {
    const event = await addMessage(OutboxTopic.EVENT_PROCESSING_REQUESTED);
    const delivery = await addMessage(OutboxTopic.WEBHOOK_DELIVERY_REQUESTED);
    const future = await addMessage(
      OutboxTopic.EVENT_PROCESSING_REQUESTED,
      new Date(clock.now().getTime() + 60_000),
    );

    const result = await publisher().publishBatch();

    expect(result).toEqual({ claimed: 2, published: 2, failed: 0 });

    const eventJob = await queues[QueueName.EVENT_PROCESSING].getJob(event.id);
    expect(eventJob?.data).toEqual({ outboxMessageId: event.id, aggregateId: event.aggregateId });
    const deliveryJob = await queues[QueueName.WEBHOOK_DELIVERY].getJob(delivery.id);
    expect(deliveryJob?.data).toEqual({
      outboxMessageId: delivery.id,
      aggregateId: delivery.aggregateId,
    });

    const rows = await prisma.outboxMessage.findMany({ orderBy: { id: 'asc' } });
    expect(rows.find((row) => row.id === event.id)).toMatchObject({
      publishedAt: clock.now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      publishAttempts: 1,
    });
    expect(rows.find((row) => row.id === future.id)).toMatchObject({
      publishedAt: null,
      publishAttempts: 0,
    });
  });

  it('publishes a future message once it becomes due', async () => {
    const future = await addMessage(
      OutboxTopic.EVENT_PROCESSING_REQUESTED,
      new Date(clock.now().getTime() + 5_000),
    );

    expect(await publisher().publishBatch()).toMatchObject({ claimed: 0 });
    clock.advance(5_000);
    expect(await publisher().publishBatch()).toMatchObject({ published: 1 });
    expect(await queues[QueueName.EVENT_PROCESSING].getJob(future.id)).toBeDefined();
  });

  it('does not create a second job when a message is republished after a crash before it was marked', async () => {
    const message = await addMessage();
    await publisher().publishBatch();
    // Simulates a publisher that enqueued but crashed before recording publication.
    await pool.query('UPDATE outbox_messages SET published_at = NULL WHERE id = $1', [message.id]);

    await publisher().publishBatch();

    const queue = queues[QueueName.EVENT_PROCESSING];
    expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed', 'completed')).toBe(1);
  });

  it('keeps messages and reschedules them with backoff while Redis is unavailable, then publishes after recovery', async () => {
    const message = await addMessage();
    const offline = await createTestWorker({
      clock,
      config: createTestConfig({
        WORKER_AUTOSTART: 'false',
        REDIS_URL: 'redis://127.0.0.1:1',
        OUTBOX_PUBLISH_TIMEOUT_MS: '300',
        OUTBOX_RETRY_BASE_MS: '1000',
      }),
    });
    try {
      const result = await offline.get(OutboxPublisher).publishBatch();

      expect(result).toEqual({ claimed: 1, published: 0, failed: 1 });
      const stored = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(stored).toMatchObject({
        publishedAt: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        publishAttempts: 1,
      });
      expect(stored.lastError).toMatch(/timed out/);
      // Attempt 1 with base 1 s and random 0.5: delay = 500 + 0.5 * 500 = 750 ms.
      expect(stored.availableAt).toEqual(new Date(clock.now().getTime() + 750));
    } finally {
      await offline.close();
    }

    expect(await publisher().publishBatch()).toMatchObject({ claimed: 0 });
    clock.advance(750);
    expect(await publisher().publishBatch()).toEqual({ claimed: 1, published: 1, failed: 0 });
    const recovered = await prisma.outboxMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(recovered).toMatchObject({ publishAttempts: 2, lastError: null });
    expect(recovered.publishedAt).not.toBeNull();
  });

  it('never lets two concurrent publishers claim the same message', async () => {
    const messages = await Promise.all(Array.from({ length: 60 }, () => addMessage()));
    const second = await createTestWorker({
      clock,
      config: createTestConfig({ WORKER_AUTOSTART: 'false', OUTBOX_BATCH_SIZE: '40' }),
    });
    try {
      const first = worker.get(OutboxPublisher);
      const results = await Promise.all([
        first.publishBatch(),
        second.get(OutboxPublisher).publishBatch(),
        first.publishBatch(),
      ]);

      expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(60);
      expect(
        await prisma.outboxMessage.count({
          where: { publishAttempts: 1, publishedAt: { not: null } },
        }),
      ).toBe(60);
      const jobs = await queues[QueueName.EVENT_PROCESSING].getJobCountByTypes('waiting');
      expect(jobs).toBe(messages.length);
    } finally {
      await second.close();
    }
  });

  it('reclaims a message whose publisher lease expired', async () => {
    const message = await addMessage();
    await pool.query(
      `UPDATE outbox_messages SET lease_owner = 'crashed-publisher', lease_expires_at = $2 WHERE id = $1`,
      [message.id, new Date(clock.now().getTime() - 1)],
    );

    expect(await publisher().publishBatch()).toMatchObject({ claimed: 1, published: 1 });
  });

  it('leaves a message alone while another publisher still holds its lease', async () => {
    const message = await addMessage();
    await pool.query(
      `UPDATE outbox_messages SET lease_owner = 'live-publisher', lease_expires_at = $2 WHERE id = $1`,
      [message.id, new Date(clock.now().getTime() + 10_000)],
    );

    expect(await publisher().publishBatch()).toMatchObject({ claimed: 0 });
  });
});
