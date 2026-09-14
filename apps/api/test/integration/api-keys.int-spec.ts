import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Pool } from 'pg';
import request from 'supertest';
import { ApiKeysService } from '../../src/api-keys/api-keys.service';
import { generateApiKey } from '../../src/auth/api-key';
import { PrismaService } from '../../src/database/prisma.service';
import { ApiKeyRole } from '../../src/generated/prisma/client';
import { createTestPool, truncateAllTables } from './support/database';
import {
  bearer,
  createApiKey,
  createWorkspaceWithAdminKey,
  type TestApiKey,
} from './support/fixtures';
import { flushTestRedis } from './support/redis';
import { createTestApp } from './support/test-app';

describe('API keys', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pool: Pool;
  let admin: TestApiKey;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    pool = createTestPool();
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    admin = await createWorkspaceWithAdminKey(prisma);
  });

  const http = () => request(app.getHttpServer());

  const countActiveAdmins = (workspaceId: string) =>
    prisma.apiKey.count({ where: { workspaceId, role: ApiKeyRole.ADMIN, revokedAt: null } });

  describe('authentication', () => {
    it('rejects requests without an API key', async () => {
      const response = await http().get('/v1/api-keys').expect(401);

      expect(response.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    });

    it.each([
      ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
      ['a malformed key', 'Bearer not-a-relayforge-key'],
      ['a well-formed key that does not exist', `Bearer ${generateApiKey().key}`],
    ])('rejects %s', async (_label, authorization) => {
      await http().get('/v1/api-keys').set('Authorization', authorization).expect(401);
    });

    it('records when a key was last used', async () => {
      await http().get('/v1/api-keys').set(bearer(admin)).expect(200);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: admin.id } });
      expect(stored.lastUsedAt).toBeInstanceOf(Date);
    });

    it('forbids MEMBER keys from managing API keys', async () => {
      const member = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.MEMBER);

      const response = await http().get('/v1/api-keys').set(bearer(member)).expect(403);
      expect(response.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });
  });

  describe('POST /v1/api-keys', () => {
    it('creates a key, returns the secret once and stores only its hash', async () => {
      const response = await http()
        .post('/v1/api-keys')
        .set(bearer(admin))
        .send({ name: 'CI deploy', role: 'MEMBER' })
        .expect(201);

      const body = response.body as { id: string; key: string; prefix: string };
      expect(body).toMatchObject({ name: 'CI deploy', role: 'MEMBER', revokedAt: null });
      expect(body.key.startsWith(`${body.prefix}_`)).toBe(true);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored.keyHash).not.toContain(body.key);
      expect(JSON.stringify(stored)).not.toContain(body.key);

      // The new key authenticates immediately (as MEMBER, so it is authorised but forbidden here).
      await http().get('/v1/api-keys').set('Authorization', `Bearer ${body.key}`).expect(403);
    });

    it('never exposes the secret or hash when listing keys', async () => {
      const created = await http()
        .post('/v1/api-keys')
        .set(bearer(admin))
        .send({ name: 'Listed', role: 'ADMIN' })
        .expect(201);

      const list = await http().get('/v1/api-keys').set(bearer(admin)).expect(200);
      const serialized = JSON.stringify(list.body);

      expect(serialized).not.toContain((created.body as { key: string }).key);
      expect(serialized).not.toContain('keyHash');
      expect((list.body as { data: unknown[] }).data).toHaveLength(2);
    });

    it('audits creation without recording the secret', async () => {
      const created = await http()
        .post('/v1/api-keys')
        .set(bearer(admin))
        .set('x-request-id', 'create-key-1')
        .send({ name: 'Audited', role: 'MEMBER' })
        .expect(201);
      const body = created.body as { id: string; key: string };

      const entries = await prisma.auditLog.findMany({ where: { action: 'api_key.created' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        workspaceId: admin.workspaceId,
        actorType: 'API_KEY',
        actorId: admin.id,
        resourceId: body.id,
        requestId: 'create-key-1',
      });
      expect(JSON.stringify(entries[0])).not.toContain(body.key);
    });

    it.each([
      ['an unknown role', { name: 'x', role: 'OWNER' }],
      ['a missing name', { role: 'MEMBER' }],
      ['an unexpected property', { name: 'x', role: 'MEMBER', workspaceId: 'someone-else' }],
    ])('rejects %s', async (_label, payload) => {
      const response = await http()
        .post('/v1/api-keys')
        .set(bearer(admin))
        .send(payload)
        .expect(400);

      expect(response.body).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
      expect(await prisma.apiKey.count()).toBe(1);
    });
  });

  describe('GET /v1/api-keys', () => {
    it('paginates newest first with a cursor', async () => {
      for (let index = 0; index < 4; index += 1) {
        await createApiKey(prisma, admin.workspaceId, ApiKeyRole.MEMBER);
      }

      const first = await http().get('/v1/api-keys?limit=2').set(bearer(admin)).expect(200);
      const firstPage = first.body as { data: { id: string }[]; nextCursor: string };
      const second = await http()
        .get(`/v1/api-keys?limit=2&cursor=${firstPage.nextCursor}`)
        .set(bearer(admin))
        .expect(200);
      const third = await http()
        .get(`/v1/api-keys?limit=2&cursor=${(second.body as { nextCursor: string }).nextCursor}`)
        .set(bearer(admin))
        .expect(200);

      const ids = [first, second, third].flatMap((page) =>
        (page.body as { data: { id: string }[] }).data.map((key) => key.id),
      );
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5);
      expect([...ids].sort().reverse()).toEqual(ids);
      expect((third.body as { nextCursor: string | null }).nextCursor).toBeNull();
    });

    it('only lists keys of the caller workspace', async () => {
      await createWorkspaceWithAdminKey(prisma);

      const response = await http().get('/v1/api-keys').set(bearer(admin)).expect(200);

      expect((response.body as { data: { id: string }[] }).data.map((key) => key.id)).toEqual([
        admin.id,
      ]);
    });
  });

  describe('DELETE /v1/api-keys/:id', () => {
    it('revokes a key so it is rejected on the very next request', async () => {
      const member = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.MEMBER);
      // Authenticated but not authorised for this route: proves the key is currently valid.
      await http().get('/v1/api-keys').set(bearer(member)).expect(403);

      await http().delete(`/v1/api-keys/${member.id}`).set(bearer(admin)).expect(204);

      const response = await http().get('/v1/api-keys').set(bearer(member)).expect(401);
      expect(response.body).toMatchObject({
        error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key' },
      });
    });

    it('is idempotent and audits the revocation once', async () => {
      const member = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.MEMBER);

      await http().delete(`/v1/api-keys/${member.id}`).set(bearer(admin)).expect(204);
      await http().delete(`/v1/api-keys/${member.id}`).set(bearer(admin)).expect(204);

      expect(await prisma.auditLog.count({ where: { action: 'api_key.revoked' } })).toBe(1);
    });

    it('returns 404 for a key in another workspace and leaves it untouched', async () => {
      const foreign = await createWorkspaceWithAdminKey(prisma);

      await http().delete(`/v1/api-keys/${foreign.id}`).set(bearer(admin)).expect(404);

      const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(stored.revokedAt).toBeNull();
    });

    it('refuses to revoke the last active ADMIN key', async () => {
      const response = await http()
        .delete(`/v1/api-keys/${admin.id}`)
        .set(bearer(admin))
        .expect(409);

      expect(response.body).toMatchObject({ error: { code: 'LAST_ADMIN_KEY' } });
    });

    it('keeps one ADMIN key when two admins revoke each other concurrently over HTTP', async () => {
      const otherAdmin = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.ADMIN);

      const responses = await Promise.all([
        http().delete(`/v1/api-keys/${otherAdmin.id}`).set(bearer(admin)),
        http().delete(`/v1/api-keys/${admin.id}`).set(bearer(otherAdmin)),
      ]);

      // The loser either authenticates after its own key was revoked (401) or loses
      // the revocation race inside the locked section (409). Both are correct.
      const statuses = responses.map((response) => response.status).sort();
      expect(statuses[0]).toBe(204);
      expect([401, 409]).toContain(statuses[1]);
      expect(await countActiveAdmins(admin.workspaceId)).toBe(1);
    });

    it('serialises concurrent revocations of the last two ADMIN keys in the locked section', async () => {
      // Bypasses authentication so both calls are guaranteed to reach the locked
      // section, exercising the FOR UPDATE path on every run.
      const otherAdmin = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.ADMIN);
      const service = app.get(ApiKeysService);
      const principal = (key: TestApiKey) => ({
        apiKeyId: key.id,
        workspaceId: key.workspaceId,
        role: key.role,
      });

      const outcomes = await Promise.allSettled([
        service.revoke(principal(admin), otherAdmin.id, null),
        service.revoke(principal(otherAdmin), admin.id, null),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejected?.reason).toMatchObject({ code: 'LAST_ADMIN_KEY' });
      expect(await countActiveAdmins(admin.workspaceId)).toBe(1);
      expect(await prisma.auditLog.count({ where: { action: 'api_key.revoked' } })).toBe(1);
    });

    it('rejects a malformed id', async () => {
      await http().delete('/v1/api-keys/not-a-uuid').set(bearer(admin)).expect(400);
    });
  });
});
