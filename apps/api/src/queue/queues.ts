import { OutboxTopic } from '../generated/prisma/client';

/** BullMQ key prefix, so RelayForge keys are recognisable in a shared Redis. */
export const QUEUE_PREFIX = 'relayforge';

export const QueueName = {
  EVENT_PROCESSING: 'event-processing',
  WEBHOOK_DELIVERY: 'webhook-delivery',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/** Every outbox topic maps to exactly one queue. */
export const QUEUE_FOR_TOPIC: Record<OutboxTopic, QueueName> = {
  [OutboxTopic.EVENT_PROCESSING_REQUESTED]: QueueName.EVENT_PROCESSING,
  [OutboxTopic.WEBHOOK_DELIVERY_REQUESTED]: QueueName.WEBHOOK_DELIVERY,
};

/**
 * Jobs carry only identifiers. Consumers load current state from PostgreSQL and
 * decide what to do, so a stale or duplicated job is harmless.
 */
export interface OutboxJobData {
  readonly outboxMessageId: string;
  readonly aggregateId: string;
}

/**
 * BullMQ-level retries cover infrastructure failures inside a job (for example a
 * dropped database connection). Business retries are scheduled in PostgreSQL.
 */
export const JOB_ATTEMPTS = 3;
