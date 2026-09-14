import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createTestApp } from './support/test-app';
import { createTestConfig } from './support/test-environment';

describe('HTTP platform', () => {
  describe('with healthy dependencies', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createTestApp();
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports liveness without touching dependencies', async () => {
      const response = await request(app.getHttpServer()).get('/health/live').expect(200);

      expect(response.body).toEqual({ status: 'ok' });
    });

    it('reports readiness when PostgreSQL and Redis respond', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        checks: {
          database: { status: 'up', durationMs: expect.any(Number) as number },
          redis: { status: 'up', durationMs: expect.any(Number) as number },
        },
      });
    });

    it('includes uptime in the health summary', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);

      expect(response.body).toMatchObject({
        status: 'ok',
        uptimeSeconds: expect.any(Number) as number,
      });
    });

    it('renders unknown routes with the standard error envelope and request id', async () => {
      const response = await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
      const requestId = response.headers['x-request-id'];

      expect(requestId).toEqual(expect.any(String));
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Cannot GET /v1/does-not-exist', requestId },
      });
    });

    it('propagates a safe caller-supplied request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .set('x-request-id', 'req-123.abc')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('req-123.abc');
    });

    it('replaces a request id that could inject into logs', async () => {
      const response = await request(app.getHttpServer())
        .get('/health/live')
        .set('x-request-id', 'bad id\twith spaces')
        .expect(200);

      expect(response.headers['x-request-id']).not.toContain(' ');
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('does not advertise the framework', async () => {
      const response = await request(app.getHttpServer()).get('/health/live');

      expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('serves an OpenAPI document with bearer authentication and without health probes', async () => {
      const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
      const document = response.body as {
        paths: Record<string, unknown>;
        components: { securitySchemes: Record<string, unknown> };
      };

      expect(document.paths).toHaveProperty(['/v1/api-keys']);
      expect(Object.keys(document.paths).some((path) => path.startsWith('/health'))).toBe(false);
      expect(document.components.securitySchemes).toHaveProperty('bearer');
    });
  });

  describe('with Redis unavailable', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      // Port 1 is never a Redis server; connection attempts fail immediately.
      app = await createTestApp({
        config: createTestConfig({ REDIS_URL: 'redis://127.0.0.1:1' }),
        waitForRedis: false,
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('reports not ready and identifies the failing dependency', async () => {
      const response = await request(app.getHttpServer()).get('/health/ready').expect(503);

      expect(response.body).toMatchObject({
        status: 'unavailable',
        checks: { database: { status: 'up' }, redis: { status: 'down' } },
      });
    });

    it('stays live', async () => {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    });
  });
});
