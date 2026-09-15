import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { PrismaService } from '../../src/database/prisma.service';
import { ApiKeyRole } from '../../src/generated/prisma/client';
import { EventProcessor } from '../../src/processing/event-processor';
import { createTestPool, inTransaction, truncateAllTables } from './support/database';
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

interface Report {
  status: string;
  summary: { transactionsChecked: number; journalsChecked: number; discrepancies: number };
  discrepancies: {
    type: string;
    transactionId?: string;
    ledgerTransactionId?: string;
    accountCode?: string;
    expectedMinor?: string;
    actualMinor?: string;
  }[];
}

describe('reconciliation', () => {
  const clock = new MutableClock();
  let app: NestExpressApplication;
  let worker: TestingModule;
  let prisma: PrismaService;
  let pool: Pool;
  let connection: TestConnection;
  let admin: TestApiKey;
  let paymentIds: Record<'refunded' | 'succeeded' | 'failed', string>;

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

  const ingestAndProcess = async (target: TestConnection, event: MockPayEventBody) => {
    const signed = signMockPayRequest(target, event, { signedAt: clock.now() });
    const response = await request(app.getHttpServer())
      .post(`/v1/webhooks/${target.ingressKey}`)
      .set(signed.headers)
      .send(signed.body)
      .expect(202);
    await worker.get(EventProcessor).process((response.body as { eventId: string }).eventId);
  };

  const pay = (paymentId: string, amount: number) =>
    paymentSucceeded({ data: { payment_id: paymentId, amount, currency: 'USD' } });

  beforeEach(async () => {
    await truncateAllTables(pool);
    await flushTestRedis();
    const workspaceId = await createWorkspace(prisma);
    connection = await createMockPayConnection(app, workspaceId);
    admin = await createApiKey(prisma, workspaceId, ApiKeyRole.ADMIN);

    await ingestAndProcess(connection, pay('pay_refunded', 1000));
    await ingestAndProcess(
      connection,
      paymentSucceeded({
        type: 'payment.refunded',
        data: { refund_id: 're_1', payment_id: 'pay_refunded', amount: 300, currency: 'USD' },
      }),
    );
    await ingestAndProcess(connection, pay('pay_succeeded', 500));
    await ingestAndProcess(
      connection,
      paymentSucceeded({
        type: 'payment.failed',
        data: { payment_id: 'pay_failed', amount: 700, currency: 'USD', failure_code: 'declined' },
      }),
    );

    const transactions = await prisma.transaction.findMany();
    const idOf = (externalPaymentId: string) =>
      transactions.find((transaction) => transaction.externalPaymentId === externalPaymentId)?.id ??
      '';
    paymentIds = {
      refunded: idOf('pay_refunded'),
      succeeded: idOf('pay_succeeded'),
      failed: idOf('pay_failed'),
    };
  });

  const run = async (key: TestApiKey = admin): Promise<Report> => {
    const response = await request(app.getHttpServer())
      .post('/v1/admin/reconciliation/run')
      .set(bearer(key))
      .expect(200);
    return response.body as Report;
  };

  /** Inserts a balanced journal directly, as a buggy script with database access would. */
  const insertJournal = async (
    client: PoolClient,
    input: {
      transactionId: string;
      kind: 'PAYMENT_CAPTURED' | 'PAYMENT_REFUNDED';
      amount: number;
      sourceEventStatus?: string;
    },
  ): Promise<string> => {
    const {
      rows: [event],
    } = await client.query<{ id: string }>(
      `INSERT INTO incoming_events
         (id, workspace_id, provider_connection_id, external_event_id, event_type, payload, payload_hash,
          signature_valid, status, processed_at, failure_reason)
       VALUES (gen_random_uuid(), $1, $2, $3, 'payment.refunded', '{}', $4, true, $5, now(), $6)
       RETURNING id`,
      [
        connection.workspaceId,
        connection.id,
        `evt_manual_${randomUUID()}`,
        'f'.repeat(64),
        input.sourceEventStatus ?? 'PROCESSED',
        input.sourceEventStatus === 'FAILED' ? 'MANUAL' : null,
      ],
    );
    const {
      rows: [journal],
    } = await client.query<{ id: string }>(
      `INSERT INTO ledger_transactions
         (id, workspace_id, transaction_id, source_event_id, kind, external_reference_id, currency)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'USD')
       RETURNING id`,
      [
        connection.workspaceId,
        input.transactionId,
        event?.id,
        input.kind,
        `manual_${randomUUID()}`,
      ],
    );
    const accounts = await client.query<{ id: string; code: string }>(
      `SELECT id, code FROM ledger_accounts WHERE workspace_id = $1 AND currency = 'USD'`,
      [connection.workspaceId],
    );
    const account = (code: string) => accounts.rows.find((row) => row.code === code)?.id;
    const [debit, credit] =
      input.kind === 'PAYMENT_CAPTURED'
        ? ['provider_clearing', 'merchant_balance']
        : ['merchant_balance', 'provider_clearing'];
    for (const [code, direction] of [
      [debit, 'DEBIT'],
      [credit, 'CREDIT'],
    ] as const) {
      await client.query(
        `INSERT INTO ledger_postings (id, workspace_id, ledger_transaction_id, account_id, direction, amount_minor, currency)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'USD')`,
        [connection.workspaceId, journal?.id, account(code), direction, input.amount],
      );
    }
    return journal?.id ?? '';
  };

  it('reports a clean ledger and audits the run', async () => {
    const report = await run();

    expect(report).toMatchObject({
      status: 'CLEAN',
      summary: { transactionsChecked: 3, journalsChecked: 3, discrepancies: 0 },
      discrepancies: [],
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: 'reconciliation.run' } }),
    ).toMatchObject({
      actorId: admin.id,
      metadata: expect.objectContaining({ status: 'CLEAN', discrepancies: 0 }) as object,
    });
  });

  it('detects a refunded amount that the ledger does not support', async () => {
    await pool.query(
      `UPDATE transactions SET status = 'PARTIALLY_REFUNDED', refunded_amount_minor = 200 WHERE id = $1`,
      [paymentIds.succeeded],
    );

    const report = await run();

    expect(report.status).toBe('DISCREPANCIES_FOUND');
    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'AMOUNT_MISMATCH',
          transactionId: paymentIds.succeeded,
          expectedMinor: '200',
          actualMinor: '0',
        }),
        expect.objectContaining({
          type: 'ACCOUNT_BALANCE_MISMATCH',
          accountCode: 'merchant_balance',
          expectedMinor: '1000',
          actualMinor: '1200',
        }),
      ]),
    );
  });

  it('detects a captured payment with no ledger entry', async () => {
    const {
      rows: [orphanEvent],
    } = await pool.query<{ id: string }>(
      `INSERT INTO incoming_events
         (id, workspace_id, provider_connection_id, external_event_id, event_type, payload, payload_hash, signature_valid)
       VALUES (gen_random_uuid(), $1, $2, 'evt_manual', 'payment.succeeded', '{}', $3, true) RETURNING id`,
      [connection.workspaceId, connection.id, 'e'.repeat(64)],
    );
    const {
      rows: [inserted],
    } = await pool.query<{ id: string }>(
      `INSERT INTO transactions
         (id, workspace_id, provider_connection_id, external_payment_id, status, currency, amount_minor, created_by_event_id, updated_at)
       VALUES (gen_random_uuid(), $1, $2, 'pay_without_journal', 'SUCCEEDED', 'USD', 900, $3, now()) RETURNING id`,
      [connection.workspaceId, connection.id, orphanEvent?.id],
    );

    const report = await run();

    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'MISSING_LEDGER_ENTRY',
          transactionId: inserted?.id,
          expectedMinor: '900',
          actualMinor: '0',
        }),
      ]),
    );
  });

  it('detects a transaction amount that differs from its capture journal', async () => {
    await pool.query(`ALTER TABLE transactions DISABLE TRIGGER transactions_guard`);
    try {
      await pool.query(`UPDATE transactions SET amount_minor = 600 WHERE id = $1`, [
        paymentIds.succeeded,
      ]);
    } finally {
      await pool.query(`ALTER TABLE transactions ENABLE TRIGGER transactions_guard`);
    }

    const report = await run();

    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'AMOUNT_MISMATCH',
          transactionId: paymentIds.succeeded,
          expectedMinor: '600',
          actualMinor: '500',
        }),
      ]),
    );
  });

  it('detects an unexpected reversal on a transaction that records no refund', async () => {
    await inTransaction(pool, (client) =>
      insertJournal(client, {
        transactionId: paymentIds.succeeded,
        kind: 'PAYMENT_REFUNDED',
        amount: 100,
      }),
    );

    const report = await run();

    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'UNEXPECTED_REVERSAL',
          transactionId: paymentIds.succeeded,
          actualMinor: '100',
        }),
        expect.objectContaining({
          type: 'ACCOUNT_BALANCE_MISMATCH',
          accountCode: 'provider_clearing',
        }),
      ]),
    );
  });

  it('detects orphan entries: journals on a failed payment and journals from unprocessed events', async () => {
    await inTransaction(pool, (client) =>
      insertJournal(client, {
        transactionId: paymentIds.failed,
        kind: 'PAYMENT_CAPTURED',
        amount: 700,
      }),
    );
    const fromFailedEvent = await inTransaction(pool, (client) =>
      insertJournal(client, {
        transactionId: paymentIds.refunded,
        kind: 'PAYMENT_REFUNDED',
        amount: 50,
        sourceEventStatus: 'FAILED',
      }),
    );

    const report = await run();

    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ORPHAN_ENTRY', transactionId: paymentIds.failed }),
        expect.objectContaining({ type: 'ORPHAN_ENTRY', ledgerTransactionId: fromFailedEvent }),
      ]),
    );
  });

  /** Simulates someone with table-owner rights bypassing the deferred balance triggers. */
  const withBalanceTriggersDisabled = async <T>(work: () => Promise<T>): Promise<T> => {
    await pool.query(`
      ALTER TABLE ledger_postings DISABLE TRIGGER ledger_postings_balanced;
      ALTER TABLE ledger_transactions DISABLE TRIGGER ledger_transactions_balanced;`);
    try {
      return await work();
    } finally {
      await pool.query(`
        ALTER TABLE ledger_postings ENABLE TRIGGER ledger_postings_balanced;
        ALTER TABLE ledger_transactions ENABLE TRIGGER ledger_transactions_balanced;`);
    }
  };

  it('detects an unbalanced journal committed while the balance triggers were bypassed', async () => {
    const journalId = await withBalanceTriggersDisabled(() =>
      inTransaction(pool, async (client) => {
        const id = await insertJournal(client, {
          transactionId: paymentIds.refunded,
          kind: 'PAYMENT_REFUNDED',
          amount: 10,
        });
        // An extra debit in the journal's own transaction leaves it unbalanced.
        await client.query(
          `INSERT INTO ledger_postings (id, workspace_id, ledger_transaction_id, account_id, direction, amount_minor, currency)
           SELECT gen_random_uuid(), workspace_id, ledger_transaction_id, account_id, 'DEBIT', 5, 'USD'
             FROM ledger_postings WHERE ledger_transaction_id = $1 LIMIT 1`,
          [id],
        );
        return id;
      }),
    );

    const report = await run();

    expect(report.discrepancies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'UNBALANCED_JOURNAL', ledgerTransactionId: journalId }),
      ]),
    );
  });

  it('only reconciles the caller workspace', async () => {
    const other = await createMockPayConnection(app, await createWorkspace(prisma));
    await ingestAndProcess(other, pay('pay_other', 400));
    await pool.query(
      `UPDATE transactions SET status = 'REFUNDED', refunded_amount_minor = 400 WHERE provider_connection_id = $1`,
      [other.id],
    );

    expect((await run()).status).toBe('CLEAN');
  });

  it('is restricted to ADMIN keys', async () => {
    const member = await createApiKey(prisma, connection.workspaceId, ApiKeyRole.MEMBER);

    await request(app.getHttpServer())
      .post('/v1/admin/reconciliation/run')
      .set(bearer(member))
      .expect(403);
  });
});
