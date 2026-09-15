import type { PinoLogger } from 'nestjs-pino';

/**
 * Runs an async iteration repeatedly with a delay between runs. The iteration
 * returns the delay before the next run, so callers can drain backlogs quickly and
 * back off when idle. Iterations never overlap, and `stop()` waits for the current one.
 */
export class PollingLoop {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = true;

  constructor(
    private readonly name: string,
    private readonly iteration: () => Promise<number>,
    /** Delay used after an iteration throws. */
    private readonly errorDelayMs: number,
    private readonly logger: PinoLogger,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
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
    let delayMs = this.errorDelayMs;
    try {
      delayMs = await this.iteration();
    } catch (error: unknown) {
      this.logger.error({ err: error, loop: this.name }, 'Polling loop iteration failed');
    }
    if (!this.stopped) {
      this.schedule(delayMs);
    }
  }
}
