import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { type Transaction, TransactionStatus } from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';
import { JournalResponse } from '../ledger/ledger.dto';

export class ListTransactionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: TransactionStatus })
  @IsOptional()
  @IsEnum(TransactionStatus)
  status?: TransactionStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  providerConnectionId?: string;
}

export class TransactionResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  providerConnectionId!: string;

  @ApiProperty({ description: 'The provider’s payment id' })
  externalPaymentId!: string;

  @ApiProperty({ enum: TransactionStatus })
  status!: TransactionStatus;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '1999', description: 'Integer minor units, as a string' })
  amountMinor!: string;

  @ApiProperty({ example: '0' })
  refundedAmountMinor!: string;

  @ApiProperty({ format: 'uuid' })
  createdByEventId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class TransactionDetailResponse extends TransactionResponse {
  @ApiProperty({ type: [JournalResponse], description: 'Ledger journals for this transaction' })
  journals!: JournalResponse[];
}

export class TransactionPageResponse {
  @ApiProperty({ type: [TransactionResponse] })
  data!: TransactionResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export function toTransactionResponse(transaction: Transaction): TransactionResponse {
  return {
    id: transaction.id,
    providerConnectionId: transaction.providerConnectionId,
    externalPaymentId: transaction.externalPaymentId,
    status: transaction.status,
    currency: transaction.currency,
    amountMinor: transaction.amountMinor.toString(),
    refundedAmountMinor: transaction.refundedAmountMinor.toString(),
    createdByEventId: transaction.createdByEventId,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
  };
}
