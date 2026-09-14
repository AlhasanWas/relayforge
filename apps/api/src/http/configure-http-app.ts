import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config';

/**
 * HTTP application setup shared by `main.ts` and the integration tests, so tests
 * exercise exactly the middleware stack that runs in production.
 */
export function configureHttpApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: config.http.jsonBodyLimitBytes });
  app.enableShutdownHooks();
}
