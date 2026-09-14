import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, type NextFunction, raw, type Request, type Response } from 'express';
import { Logger } from 'nestjs-pino';
import type { AppConfig } from '../config/app-config';

/** Webhook ingestion receives raw bytes: signatures are verified before any parsing. */
export const WEBHOOK_INGESTION_PATH_PREFIX = '/v1/webhooks/';

/**
 * HTTP application setup shared by `main.ts` and the integration tests, so tests
 * exercise exactly the middleware stack that runs in production. The Nest app must
 * be created with `bodyParser: false`; parsers are registered here per route family.
 */
export function configureHttpApp(app: NestExpressApplication, config: AppConfig): void {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  if (config.http.trustProxyHops > 0) {
    app.set('trust proxy', config.http.trustProxyHops);
  }

  app.use(
    WEBHOOK_INGESTION_PATH_PREFIX,
    raw({ type: () => true, limit: config.ingestion.maxBodyBytes }),
  );
  const jsonParser = json({ limit: config.http.jsonBodyLimitBytes });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (request.originalUrl.startsWith(WEBHOOK_INGESTION_PATH_PREFIX)) {
      next();
      return;
    }
    jsonParser(request, response, next);
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  if (config.http.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('RelayForge API')
        .setDescription('Webhook ingestion, transaction processing and reliable webhook delivery.')
        .setVersion('0.1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', description: 'API key (rf_...)' })
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }
}
