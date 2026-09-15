import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Clock } from '../clock/clock';
import { RandomSource } from '../clock/random-source';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { deliveryStateUpdate, unknownAttemptRecord } from '../deliveries/delivery-records';
import { DeliveryRetryPolicy } from '../deliveries/delivery-retry-policy';
import { DeliveryStatus, OutboxTopic, type Prisma } from '../generated/prisma/client';

/** Arbitrary constant identifying the recovery sweep's advisory lock. */
export const SWEEP_LOCK_KEY = 7_402_133_901n;

export interface SweepResult {
  reclaimedLeases: number;
  requeuedEvents: number;
  requeuedDeliveries: number;
  prunedOutboxMessages: number;
}

interface ExpiredLease {
  id: string;
  workspaceId: string;
  attemptCount: number;
  maxAttempts: number;
}

/**
 * Defence in depth. The transactional outbox guarantees work is handed to BullMQ;
 * this repairs work stranded after that handoff:
 *
 * - deliveries whose worker died while holding a lease (attempt recorded as UNKNOWN);
 * - RECEIVED events and due PENDING deliveries with no pending or recent outbox
 *   message, e.g. because Redis lost the published job;
 * - published outbox rows past retention.
 *
 * One replica sweeps at a time (transaction-scoped advisory lock). Nothing here
 * needs Redis.
 */
@Injectable()
export class RecoverySweeper {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: DeliveryRetryPolicy,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RecoverySweeper.name);
  }

  /** Returns null when another replica holds the sweep lock. */
  async sweep(): Promise<SweepResult | null> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) AS acquired`;
        if (lock?.acquired !== true) {
          return null;
        }
        const now = this.clock.now();
        return {
          reclaimedLeases: await this.reclaimExpiredLeases(tx, now),
          requeuedEvents: await this.requeueStrandedEvents(tx, now),
          requeuedDeliveries: await this.requeueStrandedDeliveries(tx, now),
          prunedOutboxMessages: await this.pruneOutbox(tx, now),
        };
      },
      { timeout: 60_000 },
    );

    if (result !== null && Object.values(result).some((count) => count > 0)) {
      this.logger.info(result, 'Recovery sweep repaired work');
    }
    return result;
  }

  private async reclaimExpiredLeases(tx: Prisma.TransactionClient, now: Date): Promise<number> {
    const expired = await tx.$queryRaw<ExpiredLease[]>`
      SELECT id,
             workspace_id AS "workspaceId",
             attempt_count AS "attemptCount",
             max_attempts AS "maxAttempts"
        FROM webhook_deliveries
       WHERE status = 'PROCESSING' AND lease_expires_at < ${now}
       ORDER BY lease_expires_at
       LIMIT ${this.config.maintenance.batchSize}
         FOR UPDATE SKIP LOCKED`;

    for (const delivery of expired) {
      const next = this.policy.afterUnknownOutcome(
        delivery.attemptCount,
        delivery.maxAttempts,
        now,
        () => this.random.next(),
      );
      // Clearing the lease owner makes a late finalise by the old worker a no-op.
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: deliveryStateUpdate(next, now),
      });
      await tx.deliveryAttempt.create({
        data: unknownAttemptRecord(delivery.id, delivery.attemptCount),
      });
      if (next.status === DeliveryStatus.PENDING) {
        await tx.outboxMessage.create({
          data: {
            workspaceId: delivery.workspaceId,
            topic: OutboxTopic.WEBHOOK_DELIVERY_REQUESTED,
            aggregateId: delivery.id,
            availableAt: next.nextAttemptAt,
          },
        });
      }
      this.logger.warn(
        { deliveryId: delivery.id, attemptNumber: delivery.attemptCount, nextStatus: next.status },
        'Reclaimed expired delivery lease; attempt outcome unknown',
      );
    }
    return expired.length;
  }

  // Outbox ids created in SQL use gen_random_uuid(): outbox ordering is by
  // available_at, so these rows do not need time-ordered ids.

  private requeueStrandedEvents(tx: Prisma.TransactionClient, now: Date): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.config.maintenance.staleAfterMs);
    return tx.$executeRaw`
      INSERT INTO outbox_messages (id, workspace_id, topic, aggregate_id, available_at)
      SELECT gen_random_uuid(), event.workspace_id, 'EVENT_PROCESSING_REQUESTED', event.id, ${now}
        FROM incoming_events AS event
       WHERE event.status = 'RECEIVED'
         AND event.received_at < ${staleBefore}
         AND NOT EXISTS (
               SELECT 1 FROM outbox_messages AS message
                WHERE message.aggregate_id = event.id
                  AND (message.published_at IS NULL OR message.published_at >= ${staleBefore}))
       LIMIT ${this.config.maintenance.batchSize}`;
  }

  private requeueStrandedDeliveries(tx: Prisma.TransactionClient, now: Date): Promise<number> {
    const staleBefore = new Date(now.getTime() - this.config.maintenance.staleAfterMs);
    return tx.$executeRaw`
      INSERT INTO outbox_messages (id, workspace_id, topic, aggregate_id, available_at)
      SELECT gen_random_uuid(), delivery.workspace_id, 'WEBHOOK_DELIVERY_REQUESTED', delivery.id, ${now}
        FROM webhook_deliveries AS delivery
       WHERE delivery.status = 'PENDING'
         AND delivery.next_attempt_at < ${staleBefore}
         AND NOT EXISTS (
               SELECT 1 FROM outbox_messages AS message
                WHERE message.aggregate_id = delivery.id
                  AND (message.published_at IS NULL OR message.published_at >= ${staleBefore}))
       LIMIT ${this.config.maintenance.batchSize}`;
  }

  private pruneOutbox(tx: Prisma.TransactionClient, now: Date): Promise<number> {
    const publishedBefore = new Date(now.getTime() - this.config.maintenance.outboxRetentionMs);
    return tx.$executeRaw`
      DELETE FROM outbox_messages
       WHERE id IN (
               SELECT id FROM outbox_messages
                WHERE published_at < ${publishedBefore}
                LIMIT ${this.config.maintenance.batchSize})`;
  }
}
