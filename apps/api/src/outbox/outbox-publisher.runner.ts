import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OutboxPublisher } from './outbox-publisher';

/**
 * Polls the outbox in the worker process. A full batch is followed immediately by
 * another poll so a backlog drains without waiting for the interval. Safe to run
 * in any number of replicas: claims use SKIP LOCKED and leases.
 */
@Injectable()
export class OutboxPublisherRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly publisher: OutboxPublisher,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxPublisherRunner.name);
  }

  onApplicationBootstrap(): void {
    if (this.config.worker.autostart) {
      this.schedule(0);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    let nextDelayMs = this.config.outbox.pollIntervalMs;
    try {
      const result = await this.publisher.publishBatch();
      if (result.claimed === this.config.outbox.batchSize && result.failed === 0) {
        nextDelayMs = 0;
      }
    } catch (error: unknown) {
      // Typically the database is unreachable. Nothing was claimed, so nothing is lost.
      this.logger.error({ err: error }, 'Outbox publisher iteration failed');
    }
    if (!this.stopped) {
      this.schedule(nextDelayMs);
    }
  }
}
