import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HTTP_JSON_BODY_LIMIT_BYTES: z.coerce.number().int().positive().default(102_400),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  HEALTH_CHECK_TIMEOUT_MS: z.coerce.number().int().positive().default(2_000),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly http: {
    readonly port: number;
    readonly jsonBodyLimitBytes: number;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly redis: {
    readonly url: string;
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
    },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    redis: {
      url: env.REDIS_URL,
    },
    health: {
      checkTimeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
    },
  };
}
