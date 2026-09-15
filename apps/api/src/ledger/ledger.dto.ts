import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  LedgerAccountType,
  LedgerTransactionKind,
  PostingDirection,
  type Prisma,
} from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';

export class ListLedgerQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @ApiPropertyOptional({ enum: LedgerTransactionKind })
  @IsOptional()
  @IsEnum(LedgerTransactionKind)
  kind?: LedgerTransactionKind;
}

export class PostingResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'provider_clearing' })
  accountCode!: string;

  @ApiProperty({ enum: PostingDirection })
  direction!: PostingDirection;

  @ApiProperty({ example: '1999', description: 'Integer minor units, as a string' })
  amountMinor!: string;
}

export class JournalResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  transactionId!: string;

  @ApiProperty({ format: 'uuid' })
  sourceEventId!: string;

  @ApiProperty({ enum: LedgerTransactionKind })
  kind!: LedgerTransactionKind;

  @ApiProperty({ description: 'Provider payment or refund id' })
  externalReferenceId!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ type: [PostingResponse] })
  postings!: PostingResponse[];

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}

export class JournalPageResponse {
  @ApiProperty({ type: [JournalResponse] })
  data!: JournalResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class AccountBalanceResponse {
  @ApiProperty({ example: 'merchant_balance' })
  code!: string;

  @ApiProperty({ enum: LedgerAccountType })
  type!: LedgerAccountType;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: '1999' })
  debitsMinor!: string;

  @ApiProperty({ example: '0' })
  creditsMinor!: string;

  @ApiProperty({
    example: '1999',
    description:
      'Balance in the account’s normal direction: debits − credits for assets, credits − debits for liabilities',
  })
  balanceMinor!: string;
}

/** Postings are listed debits first: PostgreSQL orders enums by declaration (DEBIT, CREDIT). */
export const JOURNAL_INCLUDE = {
  postings: { include: { account: { select: { code: true } } }, orderBy: { direction: 'asc' } },
} as const satisfies Prisma.LedgerTransactionInclude;

export type JournalWithPostings = Prisma.LedgerTransactionGetPayload<{
  include: typeof JOURNAL_INCLUDE;
}>;

export function toJournalResponse(journal: JournalWithPostings): JournalResponse {
  return {
    id: journal.id,
    transactionId: journal.transactionId,
    sourceEventId: journal.sourceEventId,
    kind: journal.kind,
    externalReferenceId: journal.externalReferenceId,
    currency: journal.currency,
    postings: journal.postings.map((posting) => ({
      id: posting.id,
      accountCode: posting.account.code,
      direction: posting.direction,
      amountMinor: posting.amountMinor.toString(),
    })),
    createdAt: journal.createdAt.toISOString(),
  };
}
