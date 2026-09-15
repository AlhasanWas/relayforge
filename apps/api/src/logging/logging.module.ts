import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { resolveRequestId } from './request-id';

/**
 * Log paths that must never be written. Request bodies are not logged at all;
 * these cover headers and any structured field that could carry a credential.
 */
const SENSITIVE_FIELDS = ['apiKey', 'secret', 'signingSecret', 'password', 'token'] as const;

export const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["webhook-signature"]',
  'res.headers["set-cookie"]',
  // Fields passed to `logger.info({ ... })` sit at the top level; `*.` covers one level down.
  ...SENSITIVE_FIELDS,
  ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
];

/**
 * Consumers inject `PinoLogger` and call `setContext()` in their constructor. Inside
 * an HTTP request the logger already carries `requestId`; do not add it again.
 * `@InjectPinoLogger()` is deliberately not used: it registers providers as an
 * import side effect, which makes module wiring depend on file import order.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.logLevel,
          genReqId: resolveRequestId,
          customAttributeKeys: { reqId: 'requestId' },
          // Request-scoped loggers carry only the request id, not the whole request.
          quietReqLogger: true,
          redact: { paths: REDACTED_LOG_PATHS, censor: '[REDACTED]' },
          serializers: {
            req: (req: { id: unknown; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          customLogLevel: (_req, res, error) => {
            if (error !== undefined || res.statusCode >= 500) return 'error';
            if (res.statusCode >= 400) return 'warn';
            return 'info';
          },
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/health') ?? false,
          },
        },
      }),
    }),
  ],
})
export class LoggingModule {}
