import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PollingLoop } from '../worker/polling-loop';
import { RecoverySweeper } from './recovery-sweeper';

@Injectable()
export class RecoverySweeperRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly loop: PollingLoop;

  constructor(
    sweeper: RecoverySweeper,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    logger: PinoLogger,
  ) {
    logger.setContext(RecoverySweeperRunner.name);
    const { intervalMs } = config.maintenance;
    this.loop = new PollingLoop(
      'recovery-sweeper',
      async () => {
        await sweeper.sweep();
        return intervalMs;
      },
      intervalMs,
      logger,
    );
  }

  onApplicationBootstrap(): void {
    if (this.config.worker.autostart) {
      this.loop.start();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.loop.stop();
  }
}
