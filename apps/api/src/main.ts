import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { configureHttpApp } from './http/configure-http-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Body parsers are registered per route family in configureHttpApp.
    bodyParser: false,
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureHttpApp(app, config);
  await app.listen(config.http.port);
}

bootstrap().catch((error: unknown) => {
  // The structured logger may not exist yet (e.g. invalid configuration).
  process.stderr.write(`RelayForge API failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
