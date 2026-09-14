import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service';
import { createTestPool, truncateAllTables } from './support/database';
import { bearer, createApiKey, createWorkspaceWithAdminKey } from './support/fixtures';
import { flushTestRedis } from './support/redis';
import { createTestApp } from './support/test-app';
import { createTestConfig } from './support/test-environment';

const LIMIT = 3;

describe('rate limiting', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
  });

  describe('with Redis available', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({
        config: createTestConfig({
          RATE_LIMIT_MANAGEMENT_MAX: String(LIMIT),
          RATE_LIMIT_WINDOW_MS: '60000',
        }),
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows the limit, then answers 429 with Retry-After', async () => {
      const admin = await createWorkspaceWithAdminKey(app.get(PrismaService));
      const call = () => request(app.getHttpServer()).get('/v1/api-keys').set(bearer(admin));

      for (let attempt = 1; attempt <= LIMIT; attempt += 1) {
        const response = await call().expect(200);
        expect(response.headers['x-ratelimit-remaining']).toBe(String(LIMIT - attempt));
      }

      const limited = await call().expect(429);
      expect(limited.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    });

    it('keeps a separate budget per API key', async () => {
      const prisma = app.get(PrismaService);
      const first = await createWorkspaceWithAdminKey(prisma);
      const second = await createApiKey(prisma, first.workspaceId);
      const call = (key: typeof first) =>
        request(app.getHttpServer()).get('/v1/api-keys').set(bearer(key));

      for (let attempt = 0; attempt < LIMIT; attempt += 1) {
        await call(first).expect(200);
      }

      await call(first).expect(429);
      await call(second).expect(200);
    });

    it('never limits health probes', async () => {
      for (let attempt = 0; attempt < LIMIT + 2; attempt += 1) {
        await request(app.getHttpServer()).get('/health/live').expect(200);
      }
    });
  });

  describe('with Redis unavailable', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp({
        config: createTestConfig({
          REDIS_URL: 'redis://127.0.0.1:1',
          RATE_LIMIT_MANAGEMENT_MAX: '1',
        }),
        waitForRedis: false,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('fails open instead of turning a Redis outage into an API outage', async () => {
      const admin = await createWorkspaceWithAdminKey(app.get(PrismaService));

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await request(app.getHttpServer()).get('/v1/api-keys').set(bearer(admin)).expect(200);
      }
    });
  });
});
