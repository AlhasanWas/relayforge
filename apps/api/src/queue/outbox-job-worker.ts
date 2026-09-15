import { type Job, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { PinoLogger } from 'nestjs-pino';
import { type OutboxJobData, QUEUE_PREFIX, type QueueName } from './queues';

export interface OutboxJobWorkerOptions<Result> {
  readonly queueName: QueueName;
  readonly redisUrl: string;
  readonly concurrency: number;
  readonly handle: (data: OutboxJobData) => Promise<Result>;
  /** Called once BullMQ has exhausted a job's attempts. Must not throw. */
  readonly onExhausted?: (data: OutboxJobData, error: Error) => Promise<void>;
  readonly logger: PinoLogger;
}

/**
 * A BullMQ worker for outbox-published jobs with RelayForge's lifecycle rules:
 * a dedicated blocking connection, structured failure logging, and a graceful
 * close that waits for in-flight jobs before disconnecting.
 */
export class OutboxJobWorker<Result> {
  private worker: Worker<OutboxJobData, Result> | undefined;
  private connection: Redis | undefined;

  constructor(private readonly options: OutboxJobWorkerOptions<Result>) {}

  start(): void {
    if (this.worker !== undefined) return;
    const { queueName, redisUrl, concurrency, handle, logger } = this.options;

    // Workers block on Redis and must keep retrying commands while reconnecting.
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.worker = new Worker<OutboxJobData, Result>(queueName, (job) => handle(job.data), {
      connection: this.connection,
      prefix: QUEUE_PREFIX,
      concurrency,
    });
    this.worker.on('failed', (job, error) => {
      void this.handleFailure(job, error);
    });
    this.worker.on('error', (error) => {
      logger.error({ err: error, queue: queueName }, 'Queue worker error');
    });
  }

  async close(): Promise<void> {
    await this.worker?.close();
    if (this.connection?.status === 'ready') {
      await this.connection.quit();
    } else {
      this.connection?.disconnect();
    }
  }

  private async handleFailure(
    job: Job<OutboxJobData, Result> | undefined,
    error: Error,
  ): Promise<void> {
    const { queueName, logger, onExhausted } = this.options;
    if (job === undefined) {
      logger.error({ err: error, queue: queueName }, 'Queue job failed');
      return;
    }
    const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    logger.error(
      {
        err: error,
        queue: queueName,
        aggregateId: job.data.aggregateId,
        outboxMessageId: job.data.outboxMessageId,
        attemptNumber: job.attemptsMade,
        exhausted,
      },
      'Queue job failed',
    );
    if (exhausted && onExhausted !== undefined) {
      await onExhausted(job.data, error);
    }
  }
}
