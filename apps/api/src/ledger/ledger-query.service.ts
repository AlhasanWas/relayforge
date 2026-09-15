import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { LedgerAccountType } from '../generated/prisma/client';
import { type Page, pageArgs, toPage } from '../http/pagination';
import {
  type AccountBalanceResponse,
  JOURNAL_INCLUDE,
  type JournalResponse,
  type ListLedgerQueryDto,
  toJournalResponse,
} from './ledger.dto';

interface BalanceRow {
  code: string;
  type: LedgerAccountType;
  currency: string;
  debits: bigint;
  credits: bigint;
}

@Injectable()
export class LedgerQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async listJournals(
    workspaceId: string,
    query: ListLedgerQueryDto,
  ): Promise<Page<JournalResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.ledgerTransaction.findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId,
        transactionId: query.transactionId,
        kind: query.kind,
      },
      include: JOURNAL_INCLUDE,
    });
    return toPage(rows, query, toJournalResponse);
  }

  /** Account balances aggregated in the database, never by loading postings into memory. */
  async balances(workspaceId: string): Promise<AccountBalanceResponse[]> {
    const rows = await this.prisma.$queryRaw<BalanceRow[]>`
      SELECT account.code,
             account.type::text AS type,
             account.currency,
             coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'DEBIT'), 0)::bigint AS debits,
             coalesce(sum(posting.amount_minor) FILTER (WHERE posting.direction = 'CREDIT'), 0)::bigint AS credits
        FROM ledger_accounts AS account
        LEFT JOIN ledger_postings AS posting ON posting.account_id = account.id
       WHERE account.workspace_id = ${workspaceId}::uuid
       GROUP BY account.id
       ORDER BY account.currency, account.code`;

    return rows.map((row) => {
      const balance =
        row.type === LedgerAccountType.ASSET ? row.debits - row.credits : row.credits - row.debits;
      return {
        code: row.code,
        type: row.type,
        currency: row.currency,
        debitsMinor: row.debits.toString(),
        creditsMinor: row.credits.toString(),
        balanceMinor: balance.toString(),
      };
    });
  }
}
