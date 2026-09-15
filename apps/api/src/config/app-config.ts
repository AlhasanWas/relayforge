import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const ENCRYPTION_KEY_BYTES = 32;

const encryptionKeySchema = z
  .base64({ error: 'must be base64 encoded' })
  .transform((value) => Buffer.from(value, 'base64'))
  .refine((key) => key.length === ENCRYPTION_KEY_BYTES, {
    error: `must decode to exactly ${ENCRYPTION_KEY_BYTES} bytes`,
  });

const positiveInt = () => z.coerce.number().int().positive();

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  HTTP_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  HTTP_JSON_BODY_LIMIT_BYTES: positiveInt().default(102_400),
  HTTP_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  SWAGGER_ENABLED: z.stringbool().default(true),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: positiveInt().default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  ENCRYPTION_KEY: encryptionKeySchema,

  INGESTION_MAX_BODY_BYTES: positiveInt().default(1_048_576),
  RATE_LIMIT_WINDOW_MS: positiveInt().default(60_000),
  RATE_LIMIT_MANAGEMENT_MAX: positiveInt().default(300),
  RATE_LIMIT_INGESTION_MAX: positiveInt().default(1_200),

  WORKER_AUTOSTART: z.stringbool().default(true),
  OUTBOX_POLL_INTERVAL_MS: positiveInt().default(500),
  OUTBOX_BATCH_SIZE: positiveInt().max(1_000).default(100),
  OUTBOX_LEASE_MS: positiveInt().default(30_000),
  OUTBOX_PUBLISH_TIMEOUT_MS: positiveInt().default(5_000),
  OUTBOX_RETRY_BASE_MS: positiveInt().default(1_000),
  OUTBOX_RETRY_MAX_MS: positiveInt().default(60_000),

  EVENT_PROCESSING_CONCURRENCY: positiveInt().max(100).default(5),
  EVENT_PROCESSING_MAX_ATTEMPTS: positiveInt().default(10),
  EVENT_PROCESSING_RETRY_BASE_MS: positiveInt().default(5_000),
  EVENT_PROCESSING_RETRY_MAX_MS: positiveInt().default(600_000),

  DELIVERY_MAX_ATTEMPTS: positiveInt().max(50).default(8),
  ENDPOINT_ALLOW_HTTP: z.stringbool().default(false),

  HEALTH_CHECK_TIMEOUT_MS: positiveInt().default(2_000),
});

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly http: {
    readonly port: number;
    readonly jsonBodyLimitBytes: number;
    readonly swaggerEnabled: boolean;
    /**
     * Number of reverse proxies in front of the API whose X-Forwarded-For entries are
     * trusted for the client IP. 0 (default) trusts none and uses the socket address.
     */
    readonly trustProxyHops: number;
  };
  readonly ingestion: {
    readonly maxBodyBytes: number;
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
    /** Requests allowed per ingress key and client IP per window. */
    readonly ingestionMax: number;
  };
  readonly worker: {
    /** Start queue consumers and the outbox publisher on boot. Tests drive them manually. */
    readonly autostart: boolean;
  };
  readonly outbox: {
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    /** How long a publisher owns claimed rows before another may reclaim them. */
    readonly leaseMs: number;
    readonly publishTimeoutMs: number;
    readonly retryBaseMs: number;
    readonly retryMaxMs: number;
  };
  readonly eventProcessing: {
    readonly concurrency: number;
    /** Processing runs allowed while waiting for a dependency before the event is FAILED. */
    readonly maxAttempts: number;
    readonly retryBaseMs: number;
    readonly retryMaxMs: number;
  };
  readonly delivery: {
    /** Snapshotted onto each delivery when it is created. */
    readonly maxAttempts: number;
  };
  readonly endpoints: {
    /** Allow plain-http endpoint URLs (local development only). */
    readonly allowHttp: boolean;
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
      trustProxyHops: env.HTTP_TRUST_PROXY_HOPS,
    },
    ingestion: {
      maxBodyBytes: env.INGESTION_MAX_BODY_BYTES,
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
      ingestionMax: env.RATE_LIMIT_INGESTION_MAX,
    },
    worker: {
      autostart: env.WORKER_AUTOSTART,
    },
    outbox: {
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      leaseMs: env.OUTBOX_LEASE_MS,
      publishTimeoutMs: env.OUTBOX_PUBLISH_TIMEOUT_MS,
      retryBaseMs: env.OUTBOX_RETRY_BASE_MS,
      retryMaxMs: env.OUTBOX_RETRY_MAX_MS,
    },
    eventProcessing: {
      concurrency: env.EVENT_PROCESSING_CONCURRENCY,
      maxAttempts: env.EVENT_PROCESSING_MAX_ATTEMPTS,
      retryBaseMs: env.EVENT_PROCESSING_RETRY_BASE_MS,
      retryMaxMs: env.EVENT_PROCESSING_RETRY_MAX_MS,
    },
    delivery: {
      maxAttempts: env.DELIVERY_MAX_ATTEMPTS,
    },
    endpoints: {
      allowHttp: env.ENDPOINT_ALLOW_HTTP,
    },
    health: {
      checkTimeoutMs: env.HEALTH_CHECK_TIMEOUT_MS,
    },
  };
}
