import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OutboxJobWorker } from '../queue/outbox-job-worker';
import { QueueName } from '../queue/queues';
import { type AttemptRunOutcome, DeliveryAttemptRunner } from './delivery-attempt.runner';

/**
 * Consumes webhook-delivery jobs. If a job keeps failing on infrastructure errors,
 * no special handling is needed: the delivery is either still PENDING (recovery
 * requeues it) or PROCESSING with a lease (recovery reclaims it when the lease expires).
 */
@Injectable()
export class DeliveryConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly worker: OutboxJobWorker<AttemptRunOutcome>;

  constructor(
    runner: DeliveryAttemptRunner,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: PinoLogger,
  ) {
    logger.setContext(DeliveryConsumer.name);
    this.worker = new OutboxJobWorker({
      queueName: QueueName.WEBHOOK_DELIVERY,
      redisUrl: config.redis.url,
      concurrency: config.delivery.concurrency,
      handle: (data) => runner.attempt(data.aggregateId),
      logger,
    });
  }

  onApplicationBootstrap(): void {
    if (this.config.worker.autostart) {
      this.start();
    }
  }

  start(): void {
    this.worker.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
  }
}
