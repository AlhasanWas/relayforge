import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { backoffDelayMs } from '../common/backoff';
import { withTimeout } from '../common/with-timeout';
import { Clock } from '../clock/clock';
import { RandomSource } from '../clock/random-source';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import type { OutboxTopic } from '../generated/prisma/client';
import { QUEUES, type QueueRegistry } from '../queue/queue.module';
import { JOB_ATTEMPTS, type OutboxJobData, QUEUE_FOR_TOPIC } from '../queue/queues';
import { WorkerIdentity } from '../worker/worker-identity';

interface ClaimedMessage {
  id: string;
  topic: OutboxTopic;
  aggregateId: string;
  publishAttempts: number;
}

export interface PublishBatchResult {
  claimed: number;
  published: number;
  failed: number;
}

const MAX_ERROR_LENGTH = 500;

/**
 * Moves committed outbox messages into BullMQ.
 *
 * 1. Claim due, unpublished rows with `FOR UPDATE SKIP LOCKED` and a lease, so
 *    concurrent publishers never claim the same row.
 * 2. Enqueue with job id = outbox message id.
 * 3. Mark published only after Redis acknowledged the enqueue. On failure, release
 *    the lease and reschedule with backoff.
 *
 * If this process dies between 2 and 3, the lease expires and another publisher
 * republishes the row. BullMQ ignores a job id that still exists, and consumers
 * re-check database state, so a republished message never causes duplicate effects.
 */
@Injectable()
export class OutboxPublisher {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(QUEUES) private readonly queues: QueueRegistry,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly identity: WorkerIdentity,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxPublisher.name);
  }

  async publishBatch(): Promise<PublishBatchResult> {
    const claimed = await this.claim();
    if (claimed.length === 0) {
      return { claimed: 0, published: 0, failed: 0 };
    }

    let published = 0;
    let failed = 0;
    for (const [topic, messages] of groupByTopic(claimed)) {
      try {
        await this.enqueue(topic, messages);
        await this.markPublished(messages);
        published += messages.length;
      } catch (error: unknown) {
        await this.release(messages, error);
        failed += messages.length;
      }
    }
    return { claimed: claimed.length, published, failed };
  }

  private async claim(): Promise<ClaimedMessage[]> {
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.config.outbox.leaseMs);
    return this.prisma.$queryRaw<ClaimedMessage[]>`
      UPDATE outbox_messages AS message
         SET lease_owner = ${this.identity.id},
             lease_expires_at = ${leaseExpiresAt},
             publish_attempts = message.publish_attempts + 1
       WHERE message.id IN (
               SELECT id FROM outbox_messages
                WHERE published_at IS NULL
                  AND available_at <= ${now}
                  AND (lease_expires_at IS NULL OR lease_expires_at < ${now})
                ORDER BY available_at
                LIMIT ${this.config.outbox.batchSize}
                  FOR UPDATE SKIP LOCKED)
      RETURNING message.id,
                message.topic::text AS topic,
                message.aggregate_id AS "aggregateId",
                message.publish_attempts AS "publishAttempts"`;
  }

  private async enqueue(topic: OutboxTopic, messages: ClaimedMessage[]): Promise<void> {
    const queue = this.queues[QUEUE_FOR_TOPIC[topic]];
    const jobs = messages.map((message) => ({
      name: topic,
      data: {
        outboxMessageId: message.id,
        aggregateId: message.aggregateId,
      } satisfies OutboxJobData,
      opts: {
        jobId: message.id,
        attempts: JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { age: 3_600, count: 10_000 },
        removeOnFail: { age: 7 * 24 * 3_600 },
      },
    }));
    // BullMQ waits for a connection rather than failing while Redis is down; bound it.
    await withTimeout(queue.addBulk(jobs), this.config.outbox.publishTimeoutMs, `enqueue ${topic}`);
  }

  private async markPublished(messages: ClaimedMessage[]): Promise<void> {
    await this.prisma.outboxMessage.updateMany({
      where: { id: { in: messages.map((message) => message.id) }, leaseOwner: this.identity.id },
      data: {
        publishedAt: this.clock.now(),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });
  }

  private async release(messages: ClaimedMessage[], error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      { err: error, count: messages.length, topic: messages[0]?.topic },
      'Outbox publish failed; will retry',
    );
    const now = this.clock.now().getTime();
    await this.prisma.$transaction(
      messages.map((message) =>
        this.prisma.outboxMessage.updateMany({
          where: { id: message.id, leaseOwner: this.identity.id },
          data: {
            leaseOwner: null,
            leaseExpiresAt: null,
            lastError: reason.slice(0, MAX_ERROR_LENGTH),
            availableAt: new Date(
              now +
                backoffDelayMs(
                  message.publishAttempts,
                  { baseMs: this.config.outbox.retryBaseMs, maxMs: this.config.outbox.retryMaxMs },
                  () => this.random.next(),
                ),
            ),
          },
        }),
      ),
    );
  }
}

function groupByTopic(messages: ClaimedMessage[]): Map<OutboxTopic, ClaimedMessage[]> {
  const groups = new Map<OutboxTopic, ClaimedMessage[]>();
  for (const message of messages) {
    const group = groups.get(message.topic) ?? [];
    group.push(message);
    groups.set(message.topic, group);
  }
  return groups;
}
