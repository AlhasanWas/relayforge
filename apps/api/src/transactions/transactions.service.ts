import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotFoundError } from '../errors/app-error';
import { type Page, pageArgs, toPage } from '../http/pagination';
import { JOURNAL_INCLUDE, toJournalResponse } from '../ledger/ledger.dto';
import {
  type ListTransactionsQueryDto,
  type TransactionDetailResponse,
  type TransactionResponse,
  toTransactionResponse,
} from './transaction.dto';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    query: ListTransactionsQueryDto,
  ): Promise<Page<TransactionResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.transaction.findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId,
        status: query.status,
        providerConnectionId: query.providerConnectionId,
        externalPaymentId: query.externalPaymentId,
      },
    });
    return toPage(rows, query, toTransactionResponse);
  }

  async get(workspaceId: string, transactionId: string): Promise<TransactionDetailResponse> {
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: transactionId, workspaceId },
      include: { ledgerTransactions: { include: JOURNAL_INCLUDE, orderBy: { id: 'asc' } } },
    });
    if (transaction === null) {
      throw new NotFoundError('Transaction', transactionId);
    }
    return Object.assign(toTransactionResponse(transaction), {
      journals: transaction.ledgerTransactions.map(toJournalResponse),
    });
  }
}
