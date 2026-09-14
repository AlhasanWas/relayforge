/**
 * Proves that critical invariants are enforced by PostgreSQL itself, not only by
 * application code. Every write here bypasses the application and uses raw SQL.
 */
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  createTestPool,
  expectSqlState,
  inTransaction,
  SqlState,
  truncateAllTables,
} from './support/database';
import {
  insertIncomingEvent,
  insertLedgerAccount,
  insertLedgerPosting,
  insertLedgerTransaction,
  insertProviderConnection,
  insertProviderDefinition,
  insertTransaction,
  insertWebhookDelivery,
  insertWebhookEndpoint,
  insertWorkspace,
} from './support/sql-fixtures';

interface Tenant {
  workspaceId: string;
  providerDefinitionId: string;
  providerConnectionId: string;
}

describe('database invariants', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAllTables(pool);
  });

  async function createTenant(providerDefinitionId?: string): Promise<Tenant> {
    const workspaceId = await insertWorkspace(pool);
    const definitionId = providerDefinitionId ?? (await insertProviderDefinition(pool));
    const providerConnectionId = await insertProviderConnection(pool, workspaceId, definitionId);
    return { workspaceId, providerDefinitionId: definitionId, providerConnectionId };
  }

  describe('incoming_events', () => {
    it('allows one event per external id per provider connection', async () => {
      const tenant = await createTenant();
      await insertIncomingEvent(pool, { ...tenant, externalEventId: 'evt_1' });

      await expectSqlState(
        insertIncomingEvent(pool, { ...tenant, externalEventId: 'evt_1' }),
        SqlState.UNIQUE_VIOLATION,
      );
    });

    it('scopes idempotency to the connection, so two workspaces can receive the same external id', async () => {
      const first = await createTenant();
      const second = await createTenant(first.providerDefinitionId);

      await insertIncomingEvent(pool, { ...first, externalEventId: 'evt_shared' });
      await expect(
        insertIncomingEvent(pool, { ...second, externalEventId: 'evt_shared' }),
      ).resolves.toEqual(expect.any(String));
    });

    it('rejects an event whose connection belongs to another workspace', async () => {
      const owner = await createTenant();
      const otherWorkspaceId = await insertWorkspace(pool);

      await expectSqlState(
        insertIncomingEvent(pool, {
          workspaceId: otherWorkspaceId,
          providerConnectionId: owner.providerConnectionId,
        }),
        SqlState.FOREIGN_KEY_VIOLATION,
      );
    });

    it('rejects events without a valid signature', async () => {
      const tenant = await createTenant();

      await expectSqlState(
        pool.query(
          `INSERT INTO incoming_events
             (id, workspace_id, provider_connection_id, external_event_id, event_type, payload, payload_hash, signature_valid)
           VALUES ($1, $2, $3, 'evt_forged', 'payment.succeeded', '{}', $4, false)`,
          [randomUUID(), tenant.workspaceId, tenant.providerConnectionId, 'b'.repeat(64)],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('keeps the stored payload immutable', async () => {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);

      await expectSqlState(
        pool.query(`UPDATE incoming_events SET payload = '{"amount": 1}' WHERE id = $1`, [eventId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('allows RECEIVED to move to a final status once, then freezes the status', async () => {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);

      await pool.query(
        `UPDATE incoming_events SET status = 'PROCESSED', processed_at = now() WHERE id = $1`,
        [eventId],
      );

      await expectSqlState(
        pool.query(
          `UPDATE incoming_events SET status = 'RECEIVED', processed_at = NULL WHERE id = $1`,
          [eventId],
        ),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('requires processed_at for final statuses and failure_reason for FAILED', async () => {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);

      await expectSqlState(
        pool.query(`UPDATE incoming_events SET status = 'PROCESSED' WHERE id = $1`, [eventId]),
        SqlState.CHECK_VIOLATION,
      );
      await expectSqlState(
        pool.query(
          `UPDATE incoming_events SET status = 'FAILED', processed_at = now() WHERE id = $1`,
          [eventId],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('never deletes events', async () => {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);

      await expectSqlState(
        pool.query('DELETE FROM incoming_events WHERE id = $1', [eventId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });
  });

  describe('append-only security and audit records', () => {
    it('rejects updates and deletes of rejected webhook attempts', async () => {
      const tenant = await createTenant();
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO rejected_webhook_attempts
           (id, workspace_id, provider_connection_id, reason, payload_hash, body_bytes, request_id, metadata)
         VALUES ($1, $2, $3, 'INVALID_SIGNATURE', $4, 10, 'req-1', '{}')
         RETURNING id`,
        [randomUUID(), tenant.workspaceId, tenant.providerConnectionId, 'c'.repeat(64)],
      );
      const attemptId = rows[0]?.id;

      await expectSqlState(
        pool.query(
          `UPDATE rejected_webhook_attempts SET reason = 'INVALID_PAYLOAD' WHERE id = $1`,
          [attemptId],
        ),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM rejected_webhook_attempts WHERE id = $1', [attemptId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('rejects updates of audit log entries', async () => {
      const workspaceId = await insertWorkspace(pool);
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO audit_logs (id, workspace_id, actor_type, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, 'SYSTEM', 'delivery.replayed', 'delivery', 'd_1', '{}')
         RETURNING id`,
        [randomUUID(), workspaceId],
      );

      await expectSqlState(
        pool.query(`UPDATE audit_logs SET action = 'nothing.happened' WHERE id = $1`, [
          rows[0]?.id,
        ]),
        SqlState.RESTRICT_VIOLATION,
      );
    });
  });

  describe('api_keys', () => {
    async function insertApiKey(workspaceId: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO api_keys (id, workspace_id, name, role, prefix, key_hash)
         VALUES ($1, $2, 'ci', 'ADMIN', $3, $4)
         RETURNING id`,
        [randomUUID(), workspaceId, `rf_${randomUUID().slice(0, 8)}`, 'd'.repeat(64)],
      );
      const id = rows[0]?.id;
      if (!id) throw new Error('api key insert failed');
      return id;
    }

    it('makes revocation permanent', async () => {
      const keyId = await insertApiKey(await insertWorkspace(pool));
      await pool.query('UPDATE api_keys SET revoked_at = now() WHERE id = $1', [keyId]);

      await expectSqlState(
        pool.query('UPDATE api_keys SET revoked_at = NULL WHERE id = $1', [keyId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('keeps the key hash immutable and never deletes keys', async () => {
      const keyId = await insertApiKey(await insertWorkspace(pool));

      await expectSqlState(
        pool.query('UPDATE api_keys SET key_hash = $2 WHERE id = $1', [keyId, 'e'.repeat(64)]),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM api_keys WHERE id = $1', [keyId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });
  });

  describe('transactions', () => {
    async function createTransaction(): Promise<string> {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);
      return insertTransaction(pool, { ...tenant, eventId, amountMinor: 1000 });
    }

    it('never refunds more than the captured amount', async () => {
      const transactionId = await createTransaction();

      await expectSqlState(
        pool.query(
          `UPDATE transactions SET status = 'REFUNDED', refunded_amount_minor = 1001 WHERE id = $1`,
          [transactionId],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('keeps status consistent with the refunded amount', async () => {
      const transactionId = await createTransaction();

      await expectSqlState(
        pool.query(
          `UPDATE transactions SET status = 'REFUNDED', refunded_amount_minor = 400 WHERE id = $1`,
          [transactionId],
        ),
        SqlState.CHECK_VIOLATION,
      );
      await expect(
        pool.query(
          `UPDATE transactions SET status = 'PARTIALLY_REFUNDED', refunded_amount_minor = 400 WHERE id = $1`,
          [transactionId],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    });

    it('keeps amount and currency immutable and never deletes transactions', async () => {
      const transactionId = await createTransaction();

      await expectSqlState(
        pool.query('UPDATE transactions SET amount_minor = 5 WHERE id = $1', [transactionId]),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM transactions WHERE id = $1', [transactionId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });
  });

  describe('double-entry ledger', () => {
    interface LedgerContext {
      workspaceId: string;
      transactionId: string;
      clearingAccountId: string;
      merchantAccountId: string;
      newSourceEventId: () => Promise<string>;
    }

    async function createLedgerContext(): Promise<LedgerContext> {
      const tenant = await createTenant();
      const eventId = await insertIncomingEvent(pool, tenant);
      const transactionId = await insertTransaction(pool, { ...tenant, eventId });
      return {
        workspaceId: tenant.workspaceId,
        transactionId,
        clearingAccountId: await insertLedgerAccount(pool, {
          workspaceId: tenant.workspaceId,
          code: 'provider_clearing',
          type: 'ASSET',
        }),
        merchantAccountId: await insertLedgerAccount(pool, {
          workspaceId: tenant.workspaceId,
          code: 'merchant_balance',
          type: 'LIABILITY',
        }),
        newSourceEventId: () => insertIncomingEvent(pool, tenant),
      };
    }

    async function writeJournal(
      client: PoolClient,
      ctx: LedgerContext,
      postings: { accountId: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: number }[],
      externalReferenceId = 'pay_1',
    ): Promise<string> {
      const ledgerTransactionId = await insertLedgerTransaction(client, {
        workspaceId: ctx.workspaceId,
        transactionId: ctx.transactionId,
        sourceEventId: await ctx.newSourceEventId(),
        externalReferenceId,
      });
      for (const posting of postings) {
        await insertLedgerPosting(client, {
          workspaceId: ctx.workspaceId,
          ledgerTransactionId,
          ...posting,
        });
      }
      return ledgerTransactionId;
    }

    function balanced(ctx: LedgerContext, amountMinor = 1000) {
      return [
        { accountId: ctx.clearingAccountId, direction: 'DEBIT' as const, amountMinor },
        { accountId: ctx.merchantAccountId, direction: 'CREDIT' as const, amountMinor },
      ];
    }

    async function countJournals(): Promise<number> {
      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*) FROM ledger_transactions',
      );
      return Number(rows[0]?.count);
    }

    it('commits a balanced journal', async () => {
      const ctx = await createLedgerContext();

      const journalId = await inTransaction(pool, (client) =>
        writeJournal(client, ctx, balanced(ctx)),
      );

      const { rows } = await pool.query<{ debits: string; credits: string }>(
        `SELECT sum(amount_minor) FILTER (WHERE direction = 'DEBIT') AS debits,
                sum(amount_minor) FILTER (WHERE direction = 'CREDIT') AS credits
           FROM ledger_postings WHERE ledger_transaction_id = $1`,
        [journalId],
      );
      expect(rows[0]).toEqual({ debits: '1000', credits: '1000' });
    });

    it('rejects an unbalanced journal at COMMIT and persists nothing', async () => {
      const ctx = await createLedgerContext();

      await expectSqlState(
        inTransaction(pool, (client) =>
          writeJournal(client, ctx, [
            { accountId: ctx.clearingAccountId, direction: 'DEBIT', amountMinor: 1000 },
            { accountId: ctx.merchantAccountId, direction: 'CREDIT', amountMinor: 999 },
          ]),
        ),
        SqlState.CHECK_VIOLATION,
      );
      expect(await countJournals()).toBe(0);
    });

    it('rejects a journal with a single posting', async () => {
      const ctx = await createLedgerContext();

      await expectSqlState(
        inTransaction(pool, (client) =>
          writeJournal(client, ctx, [
            { accountId: ctx.clearingAccountId, direction: 'DEBIT', amountMinor: 1000 },
          ]),
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('rejects a journal with no postings', async () => {
      const ctx = await createLedgerContext();

      await expectSqlState(
        inTransaction(pool, (client) => writeJournal(client, ctx, [])),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('rejects even a balanced pair of postings appended to an already committed journal', async () => {
      const ctx = await createLedgerContext();
      const journalId = await inTransaction(pool, (client) =>
        writeJournal(client, ctx, balanced(ctx)),
      );

      await expectSqlState(
        inTransaction(pool, async (client) => {
          await insertLedgerPosting(client, {
            workspaceId: ctx.workspaceId,
            ledgerTransactionId: journalId,
            accountId: ctx.clearingAccountId,
            direction: 'DEBIT',
            amountMinor: 50,
          });
          await insertLedgerPosting(client, {
            workspaceId: ctx.workspaceId,
            ledgerTransactionId: journalId,
            accountId: ctx.merchantAccountId,
            direction: 'CREDIT',
            amountMinor: 50,
          });
        }),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('rejects a posting whose currency differs from its account', async () => {
      const ctx = await createLedgerContext();
      const euroAccountId = await insertLedgerAccount(pool, {
        workspaceId: ctx.workspaceId,
        code: 'merchant_balance',
        type: 'LIABILITY',
        currency: 'EUR',
      });

      await expectSqlState(
        inTransaction(pool, (client) =>
          writeJournal(client, ctx, [
            { accountId: ctx.clearingAccountId, direction: 'DEBIT', amountMinor: 1000 },
            { accountId: euroAccountId, direction: 'CREDIT', amountMinor: 1000 },
          ]),
        ),
        SqlState.FOREIGN_KEY_VIOLATION,
      );
    });

    it('rejects non-positive posting amounts', async () => {
      const ctx = await createLedgerContext();

      await expectSqlState(
        inTransaction(pool, (client) => writeJournal(client, ctx, balanced(ctx, 0))),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('never records the same provider reference twice for a transaction', async () => {
      const ctx = await createLedgerContext();
      await inTransaction(pool, (client) => writeJournal(client, ctx, balanced(ctx), 'pay_dup'));

      await expectSqlState(
        inTransaction(pool, (client) => writeJournal(client, ctx, balanced(ctx), 'pay_dup')),
        SqlState.UNIQUE_VIOLATION,
      );
    });

    it('makes journals and postings append-only', async () => {
      const ctx = await createLedgerContext();
      const journalId = await inTransaction(pool, (client) =>
        writeJournal(client, ctx, balanced(ctx)),
      );

      await expectSqlState(
        pool.query('UPDATE ledger_postings SET amount_minor = 1 WHERE ledger_transaction_id = $1', [
          journalId,
        ]),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM ledger_postings WHERE ledger_transaction_id = $1', [journalId]),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM ledger_transactions WHERE id = $1', [journalId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });
  });

  describe('webhook deliveries', () => {
    interface DeliveryContext {
      workspaceId: string;
      eventId: string;
      endpointId: string;
    }

    async function createDeliveryContext(): Promise<DeliveryContext> {
      const tenant = await createTenant();
      return {
        workspaceId: tenant.workspaceId,
        eventId: await insertIncomingEvent(pool, tenant),
        endpointId: await insertWebhookEndpoint(pool, tenant.workspaceId),
      };
    }

    function markSucceeded(deliveryId: string) {
      return pool.query(
        `UPDATE webhook_deliveries SET status = 'SUCCEEDED', delivered_at = now() WHERE id = $1`,
        [deliveryId],
      );
    }

    it('allows one original delivery per event and endpoint', async () => {
      const ctx = await createDeliveryContext();
      await insertWebhookDelivery(pool, ctx);

      await expectSqlState(insertWebhookDelivery(pool, ctx), SqlState.UNIQUE_VIOLATION);
    });

    it('allows replays alongside the original, but only one active replay at a time', async () => {
      const ctx = await createDeliveryContext();
      const originalId = await insertWebhookDelivery(pool, ctx);
      const firstReplayId = await insertWebhookDelivery(pool, {
        ...ctx,
        replayOfDeliveryId: originalId,
      });

      await expectSqlState(
        insertWebhookDelivery(pool, { ...ctx, replayOfDeliveryId: originalId }),
        SqlState.UNIQUE_VIOLATION,
      );

      await markSucceeded(firstReplayId);
      await expect(
        insertWebhookDelivery(pool, { ...ctx, replayOfDeliveryId: originalId }),
      ).resolves.toEqual(expect.any(String));
    });

    it('rejects a delivery for an endpoint in another workspace', async () => {
      const ctx = await createDeliveryContext();
      const foreignEndpointId = await insertWebhookEndpoint(pool, await insertWorkspace(pool));

      await expectSqlState(
        insertWebhookDelivery(pool, { ...ctx, endpointId: foreignEndpointId }),
        SqlState.FOREIGN_KEY_VIOLATION,
      );
    });

    it('requires a lease while PROCESSING and no lease otherwise', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);

      await expectSqlState(
        pool.query(`UPDATE webhook_deliveries SET status = 'PROCESSING' WHERE id = $1`, [
          deliveryId,
        ]),
        SqlState.CHECK_VIOLATION,
      );
      await expectSqlState(
        pool.query(
          `UPDATE webhook_deliveries SET lease_owner = 'worker-1', lease_expires_at = now() WHERE id = $1`,
          [deliveryId],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('requires evidence for terminal states', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);

      await expectSqlState(
        pool.query(`UPDATE webhook_deliveries SET status = 'SUCCEEDED' WHERE id = $1`, [
          deliveryId,
        ]),
        SqlState.CHECK_VIOLATION,
      );
      await expectSqlState(
        pool.query(
          `UPDATE webhook_deliveries SET status = 'DEAD_LETTER', dead_lettered_at = now() WHERE id = $1`,
          [deliveryId],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });

    it('freezes deliveries in a terminal state', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);
      await markSucceeded(deliveryId);

      await expectSqlState(
        pool.query(
          `UPDATE webhook_deliveries SET status = 'PENDING', delivered_at = NULL WHERE id = $1`,
          [deliveryId],
        ),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('never exceeds the attempt budget and never deletes deliveries', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);

      await expectSqlState(
        pool.query('UPDATE webhook_deliveries SET attempt_count = 6 WHERE id = $1', [deliveryId]),
        SqlState.CHECK_VIOLATION,
      );
      await expectSqlState(
        pool.query('DELETE FROM webhook_deliveries WHERE id = $1', [deliveryId]),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('records each attempt number once, immutably', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);
      const insertAttempt = (attemptNumber: number, outcome: string, durationMs: number | null) =>
        pool.query(
          `INSERT INTO delivery_attempts (id, delivery_id, attempt_number, outcome, duration_ms)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), deliveryId, attemptNumber, outcome, durationMs],
        );

      await insertAttempt(1, 'RETRYABLE_FAILURE', 120);

      await expectSqlState(insertAttempt(1, 'SUCCESS', 80), SqlState.UNIQUE_VIOLATION);
      await expectSqlState(
        pool.query(`UPDATE delivery_attempts SET outcome = 'SUCCESS' WHERE delivery_id = $1`, [
          deliveryId,
        ]),
        SqlState.RESTRICT_VIOLATION,
      );
    });

    it('does not let an UNKNOWN attempt claim a measured duration', async () => {
      const ctx = await createDeliveryContext();
      const deliveryId = await insertWebhookDelivery(pool, ctx);

      await expectSqlState(
        pool.query(
          `INSERT INTO delivery_attempts (id, delivery_id, attempt_number, outcome, duration_ms)
           VALUES ($1, $2, 1, 'UNKNOWN', 250)`,
          [randomUUID(), deliveryId],
        ),
        SqlState.CHECK_VIOLATION,
      );
    });
  });

  describe('webhook_endpoints', () => {
    it('only soft-deletes endpoints and requires at least one event type', async () => {
      const endpointId = await insertWebhookEndpoint(pool, await insertWorkspace(pool));

      await expectSqlState(
        pool.query('DELETE FROM webhook_endpoints WHERE id = $1', [endpointId]),
        SqlState.RESTRICT_VIOLATION,
      );
      await expectSqlState(
        pool.query(`UPDATE webhook_endpoints SET event_types = '{}' WHERE id = $1`, [endpointId]),
        SqlState.CHECK_VIOLATION,
      );
    });
  });

  describe('outbox_messages', () => {
    it('requires lease owner and expiry together, and no lease once published', async () => {
      const workspaceId = await insertWorkspace(pool);
      const insertMessage = (
        leaseOwner: string | null,
        leaseExpiresAt: Date | null,
        publishedAt: Date | null,
      ) =>
        pool.query(
          `INSERT INTO outbox_messages
             (id, workspace_id, topic, aggregate_id, available_at, lease_owner, lease_expires_at, published_at)
           VALUES ($1, $2, 'EVENT_PROCESSING_REQUESTED', $3, now(), $4, $5, $6)`,
          [randomUUID(), workspaceId, randomUUID(), leaseOwner, leaseExpiresAt, publishedAt],
        );

      await expectSqlState(insertMessage('publisher-1', null, null), SqlState.CHECK_VIOLATION);
      await expectSqlState(
        insertMessage('publisher-1', new Date(), new Date()),
        SqlState.CHECK_VIOLATION,
      );
    });
  });
});
