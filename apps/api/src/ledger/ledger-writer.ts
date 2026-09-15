import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import type { JournalRequest } from '../processing/payment-state-machine';
import { buildPostings, LEDGER_ACCOUNTS, type LedgerAccountCode } from './postings';

export interface RecordJournalInput {
  readonly workspaceId: string;
  readonly transactionId: string;
  readonly sourceEventId: string;
  readonly journal: JournalRequest;
}

/**
 * Appends balanced journals to the double-entry ledger. Must run inside the same
 * transaction as the domain change it records, and not inside a savepoint: the
 * database only accepts postings written in the transaction that created their journal.
 */
@Injectable()
export class LedgerWriter {
  async record(tx: Prisma.TransactionClient, input: RecordJournalInput): Promise<string> {
    const { workspaceId, journal } = input;
    const lines = buildPostings(journal.kind, journal.amountMinor);
    const accountIds = await this.ensureAccounts(tx, workspaceId, journal.currency);

    const ledgerTransaction = await tx.ledgerTransaction.create({
      data: {
        workspaceId,
        transactionId: input.transactionId,
        sourceEventId: input.sourceEventId,
        kind: journal.kind,
        externalReferenceId: journal.externalReferenceId,
        currency: journal.currency,
      },
      select: { id: true },
    });

    await tx.ledgerPosting.createMany({
      data: lines.map((line) => ({
        workspaceId,
        ledgerTransactionId: ledgerTransaction.id,
        accountId: accountIds[line.account],
        direction: line.direction,
        amountMinor: line.amountMinor,
        currency: journal.currency,
      })),
    });

    return ledgerTransaction.id;
  }

  /** Creates the workspace's accounts for a currency on first use. Safe under concurrency. */
  private async ensureAccounts(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    currency: string,
  ): Promise<Record<LedgerAccountCode, string>> {
    const codes = Object.keys(LEDGER_ACCOUNTS) as LedgerAccountCode[];
    await tx.ledgerAccount.createMany({
      data: codes.map((code) => ({ workspaceId, code, type: LEDGER_ACCOUNTS[code], currency })),
      skipDuplicates: true,
    });
    const accounts = await tx.ledgerAccount.findMany({
      where: { workspaceId, currency, code: { in: codes } },
      select: { id: true, code: true },
    });
    const byCode = new Map(accounts.map((account) => [account.code, account.id]));
    return {
      provider_clearing: requireAccount(byCode, 'provider_clearing'),
      merchant_balance: requireAccount(byCode, 'merchant_balance'),
    };
  }
}

function requireAccount(accounts: Map<string, string>, code: LedgerAccountCode): string {
  const id = accounts.get(code);
  if (id === undefined) {
    throw new Error(`Ledger account ${code} was not created`);
  }
  return id;
}
