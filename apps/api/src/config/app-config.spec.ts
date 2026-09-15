import { RetryableStatusCodes } from '../deliveries/retryable-status-codes';
import { ConfigValidationError, loadConfig } from './app-config';

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/relayforge',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY,
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(REQUIRED);

    expect(config).toEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      http: { port: 3000, jsonBodyLimitBytes: 102_400, swaggerEnabled: true, trustProxyHops: 0 },
      ingestion: { maxBodyBytes: 1_048_576 },
      database: { url: REQUIRED.DATABASE_URL, poolMax: 10 },
      redis: { url: REQUIRED.REDIS_URL },
      security: { encryptionKey: Buffer.alloc(32, 7) },
      rateLimit: { windowMs: 60_000, managementMax: 300, ingestionMax: 1_200 },
      worker: { autostart: true },
      outbox: {
        pollIntervalMs: 500,
        batchSize: 100,
        leaseMs: 30_000,
        publishTimeoutMs: 5_000,
        retryBaseMs: 1_000,
        retryMaxMs: 60_000,
      },
      eventProcessing: {
        concurrency: 5,
        maxAttempts: 10,
        retryBaseMs: 5_000,
        retryMaxMs: 600_000,
      },
      delivery: {
        maxAttempts: 8,
        concurrency: 10,
        timeoutMs: 10_000,
        leaseMs: 60_000,
        retryBaseMs: 10_000,
        retryMaxMs: 3_600_000,
        retryableStatusCodes: expect.any(RetryableStatusCodes) as RetryableStatusCodes,
        responseBodyMaxBytes: 2_048,
        allowPrivateDestinations: false,
      },
      maintenance: {
        intervalMs: 30_000,
        batchSize: 500,
        staleAfterMs: 300_000,
        outboxRetentionMs: 604_800_000,
      },
      endpoints: { allowHttp: false },
      health: { checkTimeoutMs: 2_000 },
    });
  });

  it('coerces numeric and boolean settings from strings', () => {
    const config = loadConfig({
      ...REQUIRED,
      HTTP_PORT: '8080',
      DATABASE_POOL_MAX: '25',
      SWAGGER_ENABLED: 'false',
    });

    expect(config.http.port).toBe(8080);
    expect(config.database.poolMax).toBe(25);
    expect(config.http.swaggerEnabled).toBe(false);
  });

  it('fails fast when required settings are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
  });

  it.each([
    ['a non-postgres database URL', { DATABASE_URL: 'mysql://localhost/db' }],
    ['a non-redis URL', { REDIS_URL: 'http://localhost:6379' }],
    ['an out-of-range port', { HTTP_PORT: '70000' }],
    ['an unknown log level', { LOG_LEVEL: 'verbose' }],
    ['an encryption key that is not base64', { ENCRYPTION_KEY: 'not base64!' }],
    [
      'an encryption key of the wrong length',
      { ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') },
    ],
    ['an ambiguous boolean', { SWAGGER_ENABLED: 'maybe' }],
    ['an invalid retryable status list', { DELIVERY_RETRYABLE_STATUS_CODES: '200,5xx' }],
  ])('rejects %s', (_label, override) => {
    expect(() => loadConfig({ ...REQUIRED, ...override })).toThrow(ConfigValidationError);
  });

  it('names the offending setting without echoing secret values', () => {
    const secretLookingValue = Buffer.alloc(16, 1).toString('base64');

    let message = '';
    try {
      loadConfig({ ...REQUIRED, ENCRYPTION_KEY: secretLookingValue });
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toContain('ENCRYPTION_KEY');
    expect(message).not.toContain(secretLookingValue);
  });
});
