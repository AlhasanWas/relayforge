import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { QUEUE_PREFIX, QueueName } from './queues';

export const QUEUES = Symbol('QUEUES');
const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');

export type QueueRegistry = Readonly<Record<QueueName, Queue>>;

/**
 * Producer-side queues used by the outbox publisher. The producer connection does
 * not buffer commands while Redis is down, so a failed publish surfaces quickly
 * and the outbox row is retried later.
 */
@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Redis =>
        new Redis(config.redis.url, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          disconnectTimeout: 500,
        }),
    },
    {
      provide: QUEUES,
      inject: [QUEUE_CONNECTION],
      useFactory: (connection: Redis): QueueRegistry => {
        const queue = (name: QueueName) => new Queue(name, { connection, prefix: QUEUE_PREFIX });
        return {
          [QueueName.EVENT_PROCESSING]: queue(QueueName.EVENT_PROCESSING),
          [QueueName.WEBHOOK_DELIVERY]: queue(QueueName.WEBHOOK_DELIVERY),
        };
      },
    },
  ],
  exports: [QUEUES],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(
    @Inject(QUEUES) private readonly queues: QueueRegistry,
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(Object.values(this.queues).map((queue) => queue.close()));
    // BullMQ never closes a connection instance it was given; its creator must.
    if (this.connection.status === 'ready') {
      await this.connection.quit();
    } else {
      this.connection.disconnect();
    }
  }
}
