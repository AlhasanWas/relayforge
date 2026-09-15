import { Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import type { Principal } from '../auth/principal';
import { Clock } from '../clock/clock';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import {
  type Discrepancy,
  DiscrepancyType,
  type TransactionLedgerRow,
  transactionDiscrepancies,
} from './discrepancies';

/** Upper bound on discrepancies returned in one report. */
export const MAX_REPORTED_DISCREPANCIES = 500;

export interface ReconciliationReport {
  workspaceId: string;
  ranAt: string;
  status: 'CLEAN' | 'DISCREPANCIES_FOUND';
  summary: {
    transactionsChecked: number;
    journalsChecked: number;
    discrepancies: number;
    byType: Partial<Record<DiscrepancyType, number>>;
  };
  discrepancies: Discrepancy[];
  /** True when more discrepancies exist than were returned. */
  truncated: boolean;
}

interface JournalRow {
  ledgerTransactionId: string;
  transactionId: string;
  currency: string;
  eventStatus: string;
  debits: bigint;
  credits: bigint;
  postings: bigint;
}

interface AccountBalanceRow {
  code: string;
  currency: string;
  expected: bigint;
  actual: bigint;
}

/**
 * Compares the mutable domain view (transactions) with the immutable ledger.
 *
 * The database already prevents unbalanced or edited journals. Reconciliation
 * exists for what constraints cannot express across rows, and for defects
 * introduced outside the application: a bug, a manual SQL change, a restore.
 * All checks read one consistent snapshot (REPEATABLE READ, read-only).
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
  ) {}

  async run(principal: Principal, requestId: string | null): Promise<ReconciliationReport> {
    const workspaceId = principal.workspaceId;
    const ranAt = this.clock.now();

    const { transactionsChecked, journalsChecked, discrepancies } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        const [counts] = await tx.$queryRaw<{ transactions: bigint; journals: bigint }[]>`
          SELECT (SELECT count(*) FROM transactions WHERE workspace_id = ${workspaceId}::uuid) AS transactions,
                 (SELECT count(*) FROM ledger_transactions WHERE workspace_id = ${workspaceId}::uuid) AS journals`;
        const found = [
          ...(await this.transactionChecks(tx, workspaceId)),
          ...(await this.journalChecks(tx, workspaceId)),
          ...(await this.accountBalanceChecks(tx, workspaceId)),
        ];
        return {
          transactionsChecked: Number(counts?.transactions ?? 0n),
          journalsChecked: Number(counts?.journals ?? 0n),
          discrepancies: found,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 60_000 },
    );

    const byType: Partial<Record<DiscrepancyType, number>> = {};
    for (const discrepancy of discrepancies) {
      byType[discrepancy.type] = (byType[discrepancy.type] ?? 0) + 1;
    }
    const report: ReconciliationReport = {
      workspaceId,
      ranAt: ranAt.toISOString(),
      status: discrepancies.length === 0 ? 'CLEAN' : 'DISCREPANCIES_FOUND',
      summary: {
        transactionsChecked,
        journalsChecked,
        discrepancies: discrepancies.length,
        byType,
      },
      discrepancies: discrepancies.slice(0, MAX_REPORTED_DISCREPANCIES),
      truncated: discrepancies.length > MAX_REPORTED_DISCREPANCIES,
    };

    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(tx, {
        workspaceId,
        actor: principal,
        action: 'reconciliation.run',
        resourceType: 'workspace',
        resourceId: workspaceId,
        metadata: { status: report.status, ...report.summary },
        requestId,
      });
    });
    return report;
  }

  private async transactionChecks(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<Discrepancy[]> {
    const rows = await tx.$queryRaw<TransactionLedgerRow[]>`
      WITH journal_amounts AS (
        SELECT journal.id,
               journal.transaction_id,
               journal.kind,
               journal.currency,
               coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'DEBIT'), 0) AS amount
          FROM ledger_transactions AS journal
          LEFT JOIN ledger_postings AS posting ON posting.ledger_transaction_id = journal.id
         WHERE journal.workspace_id = ${workspaceId}::uuid
         GROUP BY journal.id
      )
      SELECT transaction.id AS "transactionId",
             transaction.status::text AS status,
             transaction.currency,
             transaction.amount_minor AS "amountMinor",
             transaction.refunded_amount_minor AS "refundedAmountMinor",
             count(journal.id) FILTER (WHERE journal.kind = 'PAYMENT_CAPTURED') AS "captureJournals",
             coalesce(sum(journal.amount) FILTER (WHERE journal.kind = 'PAYMENT_CAPTURED'), 0)::bigint AS "capturedMinor",
             count(journal.id) FILTER (WHERE journal.kind = 'PAYMENT_REFUNDED') AS "refundJournals",
             coalesce(sum(journal.amount) FILTER (WHERE journal.kind = 'PAYMENT_REFUNDED'), 0)::bigint AS "refundedJournalMinor",
             coalesce(bool_or(journal.currency <> transaction.currency), false) AS "currencyMismatch"
        FROM transactions AS transaction
        LEFT JOIN journal_amounts AS journal ON journal.transaction_id = transaction.id
       WHERE transaction.workspace_id = ${workspaceId}::uuid
       GROUP BY transaction.id
      HAVING coalesce(bool_or(journal.currency <> transaction.currency), false)
          OR (transaction.status = 'FAILED' AND count(journal.id) > 0)
          OR (transaction.status <> 'FAILED' AND (
                count(journal.id) FILTER (WHERE journal.kind = 'PAYMENT_CAPTURED') <> 1
             OR coalesce(sum(journal.amount) FILTER (WHERE journal.kind = 'PAYMENT_CAPTURED'), 0) <> transaction.amount_minor
             OR coalesce(sum(journal.amount) FILTER (WHERE journal.kind = 'PAYMENT_REFUNDED'), 0) <> transaction.refunded_amount_minor
             OR (transaction.status = 'SUCCEEDED' AND count(journal.id) FILTER (WHERE journal.kind = 'PAYMENT_REFUNDED') > 0)))
       ORDER BY transaction.id
       LIMIT ${MAX_REPORTED_DISCREPANCIES + 1}`;
    return rows.flatMap(transactionDiscrepancies);
  }

  private async journalChecks(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<Discrepancy[]> {
    const rows = await tx.$queryRaw<JournalRow[]>`
      SELECT journal.id AS "ledgerTransactionId",
             journal.transaction_id AS "transactionId",
             journal.currency,
             event.status::text AS "eventStatus",
             coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'DEBIT'), 0)::bigint AS debits,
             coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'CREDIT'), 0)::bigint AS credits,
             count(posting.id) AS postings
        FROM ledger_transactions AS journal
        JOIN incoming_events AS event ON event.id = journal.source_event_id
        LEFT JOIN ledger_postings AS posting ON posting.ledger_transaction_id = journal.id
       WHERE journal.workspace_id = ${workspaceId}::uuid
       GROUP BY journal.id, event.status
      HAVING event.status <> 'PROCESSED'
          OR count(posting.id) < 2
          OR coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'DEBIT'), 0)
             <> coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'CREDIT'), 0)
       ORDER BY journal.id
       LIMIT ${MAX_REPORTED_DISCREPANCIES + 1}`;

    return rows.flatMap((row): Discrepancy[] => {
      const found: Discrepancy[] = [];
      const base = {
        ledgerTransactionId: row.ledgerTransactionId,
        transactionId: row.transactionId,
        currency: row.currency,
      };
      if (row.postings < 2n || row.debits !== row.credits) {
        found.push({
          ...base,
          type: DiscrepancyType.UNBALANCED_JOURNAL,
          detail: `Journal has ${row.postings} posting(s), debits ${row.debits}, credits ${row.credits}`,
          expectedMinor: row.debits.toString(),
          actualMinor: row.credits.toString(),
        });
      }
      if (row.eventStatus !== 'PROCESSED') {
        found.push({
          ...base,
          type: DiscrepancyType.ORPHAN_ENTRY,
          detail: `Journal was created by an event in status ${row.eventStatus}, not PROCESSED`,
        });
      }
      return found;
    });
  }

  /**
   * Both accounts must equal what transactions say is owed: captured minus refunded,
   * per currency. `merchant_balance` is credit-normal and `provider_clearing` debit-normal.
   */
  private async accountBalanceChecks(
    tx: Prisma.TransactionClient,
    workspaceId: string,
  ): Promise<Discrepancy[]> {
    const rows = await tx.$queryRaw<AccountBalanceRow[]>`
      WITH owed AS (
        SELECT currency, sum(amount_minor - refunded_amount_minor)::bigint AS amount
          FROM transactions
         WHERE workspace_id = ${workspaceId}::uuid AND status <> 'FAILED'
         GROUP BY currency
      ),
      balances AS (
        SELECT account.code,
               account.currency,
               coalesce(sum(
                 CASE WHEN (account.code = 'merchant_balance') = (posting.direction = 'CREDIT')
                      THEN posting.amount_minor ELSE -posting.amount_minor END), 0)::bigint AS amount
          FROM ledger_accounts AS account
          LEFT JOIN ledger_postings AS posting ON posting.account_id = account.id
         WHERE account.workspace_id = ${workspaceId}::uuid
           AND account.code IN ('merchant_balance', 'provider_clearing')
         GROUP BY account.code, account.currency
      ),
      expected AS (
        SELECT code, owed.currency, owed.amount
          FROM owed CROSS JOIN (VALUES ('merchant_balance'), ('provider_clearing')) AS codes(code)
      )
      SELECT coalesce(expected.code, balances.code) AS code,
             coalesce(expected.currency, balances.currency) AS currency,
             coalesce(expected.amount, 0)::bigint AS expected,
             coalesce(balances.amount, 0)::bigint AS actual
        FROM expected
        FULL OUTER JOIN balances
          ON balances.code = expected.code AND balances.currency = expected.currency
       WHERE coalesce(expected.amount, 0) <> coalesce(balances.amount, 0)
       ORDER BY currency, code`;

    return rows.map((row) => ({
      type: DiscrepancyType.ACCOUNT_BALANCE_MISMATCH,
      detail: `Account ${row.code} balance differs from the net of ${row.currency} transactions`,
      accountCode: row.code,
      currency: row.currency,
      expectedMinor: row.expected.toString(),
      actualMinor: row.actual.toString(),
    }));
  }
}
