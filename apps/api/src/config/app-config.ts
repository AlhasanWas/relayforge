import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const ENCRYPTION_KEY_BYTES = 32;

const encryptionKeySchema = z
  .base64({ error: 'must be base64 encoded' })
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === ENCRYPTION_KEY_BYTES, {
    error: `must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes`,
  });

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HTTP_JSON_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(102_400),
  SWAGGER_ENABLED: z.stringbool().default(true),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  ENCRYPTION_KEY: encryptionKeySchema,
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MANAGEMENT_MAX: z.coerce.number().int().positive().default(300),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly http: {
    readonly port: number;
    readonly jsonBodyLimitBytes: number;
    readonly swaggerEnabled: boolean;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly redis: {
    readonly url: string;
  };
  readonly security: {
    /** AES-256-GCM key for secrets that must be recoverable (signing secrets). */
    readonly encryptionKey: Buffer;
  };
  readonly rateLimit: {
    readonly windowMs: number;
    /** Requests allowed per API key per window across the management API. */
    readonly managementMax: number;
  };
  readonly health: {
    readonly checkTimeoutMs: number;
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');

export class ConfigValidationError extends Error {
  constructor(details: string) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    throw new ConfigValidationError(z.prettifyError(parsed.error));
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    http: {
      port: env.HTTP_PORT,
      jsonBodyLimitBytes: env.HTTP_JSON_BODY_LIMIT_BYTES,
      swaggerEnabled: env.SWAGGER_ENABLED,
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    redis: {
      url: env.REDIS_URL,
    },
    security: {
      encryptionKey: env.ENCRYPTION_KEY,
    },
    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      managementMax: env.RATE_LIMIT_MANAGEMENT_MAX,
    },
    health: {
      checkTimeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
    },
  };
}
