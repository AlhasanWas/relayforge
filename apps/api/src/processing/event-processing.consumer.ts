import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type OutboxJobData, QUEUE_PREFIX, QueueName } from '../queue/queues';
import { EventProcessor, type ProcessingOutcome } from './event-processor';

/** Consumes event-processing jobs published from the outbox. */
@Injectable()
export class EventProcessingConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private worker: Worker<OutboxJobData, ProcessingOutcome> | undefined;
  private connection: Redis | undefined;

  constructor(
    private readonly processor: EventProcessor,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EventProcessingConsumer.name);
  }

  onApplicationBootstrap(): void {
    if (this.config.worker.autostart) {
      this.start();
    }
  }

  start(): void {
    if (this.worker !== undefined) {
      return;
    }
    // Workers block on Redis and must retry commands indefinitely while reconnecting.
    this.connection = new Redis(this.config.redis.url, { maxRetriesPerRequest: null });
    this.worker = new Worker<OutboxJobData, ProcessingOutcome>(
      QueueName.EVENT_PROCESSING,
      (job) => this.processor.process(job.data.aggregateId, job.data.outboxMessageId),
      {
        connection: this.connection,
        prefix: QUEUE_PREFIX,
        concurrency: this.config.eventProcessing.concurrency,
      },
    );
    this.worker.on('failed', (job, error) => {
      void this.handleFailure(job, error);
    });
    this.worker.on('error', (error) => {
      this.logger.error({ err: error }, 'Event processing worker error');
    });
  }

  async onApplicationShutdown(): Promise<void> {
    // Waits for in-flight jobs to finish before disconnecting.
    await this.worker?.close();
    if (this.connection?.status === 'ready') {
      await this.connection.quit();
    } else {
      this.connection?.disconnect();
    }
  }

  private async handleFailure(
    job: Job<OutboxJobData, ProcessingOutcome> | undefined,
    error: Error,
  ): Promise<void> {
    if (job === undefined) {
      this.logger.error({ err: error }, 'Event processing job failed');
      return;
    }
    const eventId = job.data.aggregateId;
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.error(
      { err: error, correlationId: eventId, eventId, attemptNumber: job.attemptsMade, exhausted },
      'Event processing job failed',
    );
    if (!exhausted) {
      return;
    }
    try {
      await this.processor.markFailedAfterUnexpectedErrors(eventId);
    } catch (markError: unknown) {
      // The event stays RECEIVED; recovery will request processing again later.
      this.logger.error(
        { err: markError, correlationId: eventId, eventId },
        'Could not mark event FAILED after exhausted retries',
      );
    }
  }
}
