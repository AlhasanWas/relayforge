import type { NestExpressApplication } from '@nestjs/platform-express';
import { decodeWebhookSecret } from '@relayforge/shared/webhooks';
import type { Pool } from 'pg';
import request from 'supertest';
import { SecretCipher } from '../../src/crypto/secret-cipher';
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
import { createTestConfig } from './support/test-environment';

describe('webhook endpoints API', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let pool: Pool;
  let admin: TestApiKey;

  beforeAll(async () => {
    app = await createTestApp({ config: createTestConfig({ ENDPOINT_ALLOW_HTTP: 'false' }) });
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

  const createEndpoint = (body: Record<string, unknown> = {}, key: TestApiKey = admin) =>
    http()
      .post('/v1/endpoints')
      .set(bearer(key))
      .send({ url: 'https://merchant.example/hooks', eventTypes: ['payment.succeeded'], ...body });

  it('creates an endpoint, returns its signing secret once, and stores it encrypted', async () => {
    const response = await createEndpoint({ description: 'Primary' }).expect(201);
    const body = response.body as { id: string; signingSecret: string };

    expect(response.body).toMatchObject({
      url: 'https://merchant.example/hooks',
      description: 'Primary',
      eventTypes: ['payment.succeeded'],
      isActive: true,
    });
    expect(decodeWebhookSecret(body.signingSecret)).toHaveLength(32);

    const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: body.id } });
    expect(stored.signingSecretEncrypted).not.toContain(body.signingSecret);
    expect(
      app
        .get(SecretCipher)
        .decrypt(stored.signingSecretEncrypted, 'webhook_endpoint.signing_secret'),
    ).toBe(body.signingSecret);

    const fetched = await http().get(`/v1/endpoints/${body.id}`).set(bearer(admin)).expect(200);
    expect(JSON.stringify(fetched.body)).not.toContain(body.signingSecret);
    expect(
      await prisma.auditLog.count({ where: { action: 'endpoint.created', resourceId: body.id } }),
    ).toBe(1);
  });

  it.each([
    [
      'plain http when http is not allowed',
      { url: 'http://merchant.example/hooks' },
      'INVALID_ENDPOINT_URL',
    ],
    [
      'credentials in the URL',
      { url: 'https://user:pw@merchant.example/hooks' },
      'INVALID_ENDPOINT_URL',
    ],
    ['a malformed URL', { url: 'not a url' }, 'VALIDATION_FAILED'],
    ['an empty event type list', { eventTypes: [] }, 'VALIDATION_FAILED'],
    ['an unsupported event type', { eventTypes: ['customer.created'] }, 'VALIDATION_FAILED'],
    [
      'duplicate event types',
      { eventTypes: ['payment.failed', 'payment.failed'] },
      'VALIDATION_FAILED',
    ],
  ])('rejects %s', async (_label, body, code) => {
    const response = await createEndpoint(body).expect(400);

    expect(response.body).toMatchObject({ error: { code } });
    expect(await prisma.webhookEndpoint.count()).toBe(0);
  });

  it('lets MEMBER keys read endpoints but not change them', async () => {
    const member = await createApiKey(prisma, admin.workspaceId, ApiKeyRole.MEMBER);
    const created = await createEndpoint().expect(201);
    const { id } = created.body as { id: string };

    await http().get('/v1/endpoints').set(bearer(member)).expect(200);
    await createEndpoint({}, member).expect(403);
    await http()
      .patch(`/v1/endpoints/${id}`)
      .set(bearer(member))
      .send({ isActive: false })
      .expect(403);
    await http().delete(`/v1/endpoints/${id}`).set(bearer(member)).expect(403);
  });

  it('updates an endpoint and audits the changed fields only', async () => {
    const { id } = (await createEndpoint().expect(201)).body as { id: string };

    const response = await http()
      .patch(`/v1/endpoints/${id}`)
      .set(bearer(admin))
      .send({ eventTypes: ['payment.succeeded', 'payment.refunded'], isActive: false })
      .expect(200);

    expect(response.body).toMatchObject({
      eventTypes: ['payment.succeeded', 'payment.refunded'],
      isActive: false,
    });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'endpoint.updated' } });
    expect(audit.metadata).toEqual({ changedFields: ['eventTypes', 'isActive'] });
  });

  it('soft-deletes an endpoint: hidden from the API, kept in the database', async () => {
    const { id } = (await createEndpoint().expect(201)).body as { id: string };

    await http().delete(`/v1/endpoints/${id}`).set(bearer(admin)).expect(204);

    await http().get(`/v1/endpoints/${id}`).set(bearer(admin)).expect(404);
    await http().delete(`/v1/endpoints/${id}`).set(bearer(admin)).expect(404);
    const list = await http().get('/v1/endpoints').set(bearer(admin)).expect(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(0);
    expect(await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).toMatchObject({
      isActive: false,
      deletedAt: expect.any(Date) as Date,
    });
  });

  it('hides endpoints of other workspaces', async () => {
    const outsider = await createWorkspaceWithAdminKey(prisma);
    const { id } = (await createEndpoint().expect(201)).body as { id: string };

    await http().get(`/v1/endpoints/${id}`).set(bearer(outsider)).expect(404);
    await http()
      .patch(`/v1/endpoints/${id}`)
      .set(bearer(outsider))
      .send({ isActive: false })
      .expect(404);
    await http().delete(`/v1/endpoints/${id}`).set(bearer(outsider)).expect(404);
  });
});
