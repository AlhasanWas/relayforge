import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service';
import { ApiKeyRole } from '../../src/generated/prisma/client';
import { EventProcessor } from '../../src/processing/event-processor';
import { createTestPool, truncateAllTables } from './support/database';
import { bearer, createApiKey, createWorkspace, type TestApiKey } from './support/fixtures';
import {
  createMockPayConnection,
  type MockPayEventBody,
  paymentSucceeded,
  signMockPayRequest,
  type TestConnection,
} from './support/mockpay';
import { MutableClock } from './support/mutable-clock';
import { flushTestRedis } from './support/redis';
import { createTestApp } from './support/test-app';
import { createTestWorker } from './support/test-worker';

describe('transactions and ledger API', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let pool: Pool;
  let connection: TestConnection;
  let member: TestApiKey;

  beforeAll(async () => {
    app = await createTestApp({ clock });
    worker = await createTestWorker({ clock });
    prisma = app.get(PrismaService);
    pool = createTestPool();
  });

  afterAll(async () => {
    await worker.close();
    await app.close();
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    const workspaceId = await createWorkspace(prisma);
    connection = await createMockPayConnection(app, workspaceId);
    member = await createApiKey(prisma, workspaceId, ApiKeyRole.MEMBER);
  });

  const http = () => request(app.getHttpServer());

  const ingestAndProcess = async (event: MockPayEventBody): Promise<void> => {
    const signed = signMockPayRequest(connection, event, { signedAt: clock.now() });
    const response = await http()
      .post(`/v1/webhooks/${connection.ingressKey}`)
      .set(signed.headers)
      .send(signed.body)
      .expect(202);
    await worker.get(EventProcessor).process((response.body as { eventId: string }).eventId);
  };

  beforeEach(async () => {
    await ingestAndProcess(
      paymentSucceeded({ data: { payment_id: 'pay_api', amount: 2500, currency: 'USD' } }),
    );
    await ingestAndProcess(
      paymentSucceeded({
        type: 'payment.refunded',
        data: { refund_id: 're_api', payment_id: 'pay_api', amount: 1000, currency: 'USD' },
      }),
    );
  });

  it('lists transactions with amounts as strings', async () => {
    const response = await http()
      .get('/v1/transactions?status=PARTIALLY_REFUNDED')
      .set(bearer(member))
      .expect(200);

    expect(response.body).toMatchObject({
      data: [
        {
          externalPaymentId: 'pay_api',
          status: 'PARTIALLY_REFUNDED',
          currency: 'USD',
          amountMinor: '2500',
          refundedAmountMinor: '1000',
        },
      ],
      nextCursor: null,
    });
  });

  it('finds a transaction by the provider’s payment id', async () => {
    await ingestAndProcess(
      paymentSucceeded({ data: { payment_id: 'pay_other', amount: 700, currency: 'USD' } }),
    );

    const response = await http()
      .get('/v1/transactions?externalPaymentId=pay_other')
      .set(bearer(member))
      .expect(200);

    expect(response.body).toMatchObject({
      data: [{ externalPaymentId: 'pay_other', amountMinor: '700' }],
      nextCursor: null,
    });
    expect((response.body as { data: unknown[] }).data).toHaveLength(1);
  });

  it('returns a transaction with its balanced journals', async () => {
    const list = await http().get('/v1/transactions').set(bearer(member)).expect(200);
    const [transaction] = (list.body as { data: { id: string }[] }).data;

    const response = await http()
      .get(`/v1/transactions/${transaction?.id ?? ''}`)
      .set(bearer(member))
      .expect(200);

    expect(response.body).toMatchObject({
      journals: [
        {
          kind: 'PAYMENT_CAPTURED',
          externalReferenceId: 'pay_api',
          postings: [
            { accountCode: 'provider_clearing', direction: 'DEBIT', amountMinor: '2500' },
            { accountCode: 'merchant_balance', direction: 'CREDIT', amountMinor: '2500' },
          ],
        },
        {
          kind: 'PAYMENT_REFUNDED',
          externalReferenceId: 're_api',
          postings: [
            { accountCode: 'merchant_balance', direction: 'DEBIT', amountMinor: '1000' },
            { accountCode: 'provider_clearing', direction: 'CREDIT', amountMinor: '1000' },
          ],
        },
      ],
    });
  });

  it('lists journals and filters them by kind', async () => {
    const all = await http().get('/v1/ledger').set(bearer(member)).expect(200);
    const refunds = await http()
      .get('/v1/ledger?kind=PAYMENT_REFUNDED')
      .set(bearer(member))
      .expect(200);

    expect((all.body as { data: unknown[] }).data).toHaveLength(2);
    expect(
      (refunds.body as { data: { kind: string }[] }).data.map((journal) => journal.kind),
    ).toEqual(['PAYMENT_REFUNDED']);
  });

  it('reports account balances in each account’s normal direction', async () => {
    const response = await http().get('/v1/ledger/balances').set(bearer(member)).expect(200);

    expect(response.body).toEqual([
      {
        code: 'merchant_balance',
        type: 'LIABILITY',
        currency: 'USD',
        debitsMinor: '1000',
        creditsMinor: '2500',
        balanceMinor: '1500',
      },
      {
        code: 'provider_clearing',
        type: 'ASSET',
        currency: 'USD',
        debitsMinor: '2500',
        creditsMinor: '1000',
        balanceMinor: '1500',
      },
    ]);
  });

  it('hides another workspace’s financial data', async () => {
    const outsider = await createApiKey(prisma, await createWorkspace(prisma), ApiKeyRole.ADMIN);
    const transaction = await prisma.transaction.findFirstOrThrow();

    await http().get(`/v1/transactions/${transaction.id}`).set(bearer(outsider)).expect(404);
    expect((await http().get('/v1/ledger').set(bearer(outsider)).expect(200)).body).toEqual({
      data: [],
      nextCursor: null,
    });
    expect(
      (await http().get('/v1/ledger/balances').set(bearer(outsider)).expect(200)).body,
    ).toEqual([]);
  });
});
