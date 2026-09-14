import { ConfigValidationError, loadConfig } from './app-config';

const REQUIRED = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/relayforge',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadConfig', () => {
  it('applies defaults for optional settings', () => {
    const config = loadConfig(REQUIRED);

    expect(config).toEqual({
      nodeEnv: 'development',
      logLevel: 'info',
      http: { port: 3000, jsonBodyLimitBytes: 102_400 },
      database: { url: REQUIRED.DATABASE_URL, poolMax: 10 },
      redis: { url: REQUIRED.REDIS_URL },
      health: { checkTimeoutMs: 2_000 },
    });
  });

  it('coerces numeric settings from strings', () => {
    const config = loadConfig({ ...REQUIRED, HTTP_PORT: '8080', DATABASE_POOL_MAX: '25' });

    expect(config.http.port).toBe(8080);
    expect(config.database.poolMax).toBe(25);
  });

  it('fails fast when required settings are missing', () => {
    expect(() => loadConfig({})).toThrow(ConfigValidationError);
  });

  it.each([
    ['a non-postgres database URL', { DATABASE_URL: 'mysql://localhost/db' }],
    ['a non-redis URL', { REDIS_URL: 'http://localhost:6379' }],
    ['an out-of-range port', { HTTP_PORT: '70000' }],
    ['an unknown log level', { LOG_LEVEL: 'verbose' }],
  ])('rejects %s', (_label, override) => {
    expect(() => loadConfig({ ...REQUIRED, ...override })).toThrow(ConfigValidationError);
  });

  it('names the offending setting in the error message', () => {
    expect(() => loadConfig({ REDIS_URL: REQUIRED.REDIS_URL })).toThrow(/DATABASE_URL/);
  });
});
