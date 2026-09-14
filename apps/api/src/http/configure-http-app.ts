import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
