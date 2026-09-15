import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  // SIGTERM/SIGINT close queue consumers gracefully, letting in-flight jobs finish.
  app.enableShutdownHooks();
}

bootstrap().catch((error: unknown) => {
  // The structured logger may not exist yet (e.g. invalid configuration).
  process.stderr.write(`RelayForge worker failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
