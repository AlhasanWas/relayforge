/**
 * Minimal row builders over raw SQL, used to exercise database-level invariants
 * independently of application code. Each returns the inserted row's id.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type Queryable = Pool | PoolClient;

const HASH = 'a'.repeat(64);

async function insert(db: Queryable, sql: string, values: unknown[]): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`${sql} RETURNING id`, values);
  const row = rows[0];
  if (!row) throw new Error(`Insert returned no row: ${sql}`);
  return row.id;
}

export function insertWorkspace(db: Queryable): Promise<string> {
  return insert(db, 'INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
    randomUUID(),
    'Workspace',
  ]);
}

export function insertProviderDefinition(db: Queryable): Promise<string> {
  return insert(
    db,
    `INSERT INTO provider_definitions (id, slug, display_name, adapter_type)
     VALUES ($1, $2, 'MockPay', 'MOCKPAY')`,
    [randomUUID(), `mockpay-${randomBytes(4).toString('hex')}`],
  );
}

export function insertProviderConnection(
  db: Queryable,
  workspaceId: string,
  providerDefinitionId: string,
): Promise<string> {
  return insert(
    db,
    `INSERT INTO provider_connections
       (id, workspace_id, provider_definition_id, name, public_ingress_key, signing_secret_encrypted)
     VALUES ($1, $2, $3, 'MockPay', $4, 'ciphertext')`,
    [randomUUID(), workspaceId, providerDefinitionId, `ing_${randomBytes(12).toString('hex')}`],
  );
}

export interface EventRow {
  workspaceId: string;
  providerConnectionId: string;
  externalEventId?: string;
}

export function insertIncomingEvent(db: Queryable, row: EventRow): Promise<string> {
  return insert(
    db,
    `INSERT INTO incoming_events
       (id, workspace_id, provider_connection_id, external_event_id, event_type, payload, payload_hash, signature_valid)
     VALUES ($1, $2, $3, $4, 'payment.succeeded', '{}', $5, true)`,
    [
      randomUUID(),
      row.workspaceId,
      row.providerConnectionId,
      row.externalEventId ?? randomUUID(),
      HASH,
    ],
  );
}

export function insertTransaction(
  db: Queryable,
  row: { workspaceId: string; providerConnectionId: string; eventId: string; amountMinor?: number },
): Promise<string> {
  return insert(
    db,
    `INSERT INTO transactions
       (id, workspace_id, provider_connection_id, external_payment_id, status, currency, amount_minor, created_by_event_id, updated_at)
     VALUES ($1, $2, $3, $4, 'SUCCEEDED', 'USD', $5, $6, now())`,
    [
      randomUUID(),
      row.workspaceId,
      row.providerConnectionId,
      randomUUID(),
      row.amountMinor ?? 1000,
      row.eventId,
    ],
  );
}

export function insertLedgerAccount(
  db: Queryable,
  row: { workspaceId: string; code: string; type: 'ASSET' | 'LIABILITY'; currency?: string },
): Promise<string> {
  return insert(
    db,
    `INSERT INTO ledger_accounts (id, workspace_id, code, type, currency) VALUES ($1, $2, $3, $4, $5)`,
    [randomUUID(), row.workspaceId, row.code, row.type, row.currency ?? 'USD'],
  );
}

export function insertLedgerTransaction(
  db: Queryable,
  row: {
    workspaceId: string;
    transactionId: string;
    sourceEventId: string;
    externalReferenceId?: string;
  },
): Promise<string> {
  return insert(
    db,
    `INSERT INTO ledger_transactions
       (id, workspace_id, transaction_id, source_event_id, kind, external_reference_id, currency)
     VALUES ($1, $2, $3, $4, 'PAYMENT_CAPTURED', $5, 'USD')`,
    [
      randomUUID(),
      row.workspaceId,
      row.transactionId,
      row.sourceEventId,
      row.externalReferenceId ?? 'pay_1',
    ],
  );
}

export function insertLedgerPosting(
  db: Queryable,
  row: {
    workspaceId: string;
    ledgerTransactionId: string;
    accountId: string;
    direction: 'DEBIT' | 'CREDIT';
    amountMinor: number;
    currency?: string;
  },
): Promise<string> {
  return insert(
    db,
    `INSERT INTO ledger_postings
       (id, workspace_id, ledger_transaction_id, account_id, direction, amount_minor, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      row.workspaceId,
      row.ledgerTransactionId,
      row.accountId,
      row.direction,
      row.amountMinor,
      row.currency ?? 'USD',
    ],
  );
}

export function insertWebhookEndpoint(db: Queryable, workspaceId: string): Promise<string> {
  return insert(
    db,
    `INSERT INTO webhook_endpoints (id, workspace_id, url, event_types, signing_secret_encrypted, updated_at)
     VALUES ($1, $2, 'https://example.com/webhooks', ARRAY['payment.succeeded'], 'ciphertext', now())`,
    [randomUUID(), workspaceId],
  );
}

export function insertWebhookDelivery(
  db: Queryable,
  row: { workspaceId: string; eventId: string; endpointId: string; replayOfDeliveryId?: string },
): Promise<string> {
  return insert(
    db,
    `INSERT INTO webhook_deliveries
       (id, workspace_id, event_id, endpoint_id, replay_of_delivery_id, payload, max_attempts, next_attempt_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '{}', 5, now(), now())`,
    [randomUUID(), row.workspaceId, row.eventId, row.endpointId, row.replayOfDeliveryId ?? null],
  );
}
