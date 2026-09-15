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
import { EventProcessor, type ProcessingOutcome } from './event-processor';

/** Consumes event-processing jobs published from the outbox. */
@Injectable()
export class EventProcessingConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly worker: OutboxJobWorker<ProcessingOutcome>;

  constructor(
    processor: EventProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: PinoLogger,
  ) {
    logger.setContext(EventProcessingConsumer.name);
    this.worker = new OutboxJobWorker({
      queueName: QueueName.EVENT_PROCESSING,
      redisUrl: config.redis.url,
      concurrency: config.eventProcessing.concurrency,
      handle: (data) => processor.process(data.aggregateId, data.outboxMessageId),
      onExhausted: async ({ aggregateId }) => {
        try {
          await processor.markFailedAfterUnexpectedErrors(aggregateId);
        } catch (error: unknown) {
          // The event stays RECEIVED; recovery will request processing again later.
          logger.error(
            { err: error, correlationId: aggregateId, eventId: aggregateId },
            'Could not mark event FAILED after exhausted retries',
          );
        }
      },
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
