import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DiscrepancyType } from './discrepancies';

export class DiscrepancyResponse {
  @ApiProperty({ enum: Object.values(DiscrepancyType) })
  type!: DiscrepancyType;

  @ApiProperty()
  detail!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  transactionId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  ledgerTransactionId?: string;

  @ApiPropertyOptional({ example: 'merchant_balance' })
  accountCode?: string;

  @ApiPropertyOptional({ example: 'USD' })
  currency?: string;

  @ApiPropertyOptional({ example: '1999', description: 'Integer minor units' })
  expectedMinor?: string;

  @ApiPropertyOptional({ example: '1500', description: 'Integer minor units' })
  actualMinor?: string;
}

export class ReconciliationSummaryResponse {
  @ApiProperty()
  transactionsChecked!: number;

  @ApiProperty()
  journalsChecked!: number;

  @ApiProperty()
  discrepancies!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    example: { AMOUNT_MISMATCH: 1 },
  })
  byType!: Partial<Record<DiscrepancyType, number>>;
}

export class ReconciliationReportResponse {
  @ApiProperty({ format: 'uuid' })
  workspaceId!: string;

  @ApiProperty({ format: 'date-time' })
  ranAt!: string;

  @ApiProperty({ enum: ['CLEAN', 'DISCREPANCIES_FOUND'] })
  status!: 'CLEAN' | 'DISCREPANCIES_FOUND';

  @ApiProperty({ type: ReconciliationSummaryResponse })
  summary!: ReconciliationSummaryResponse;

  @ApiProperty({ type: [DiscrepancyResponse] })
  discrepancies!: DiscrepancyResponse[];

  @ApiProperty({ description: 'True when more discrepancies exist than were returned' })
  truncated!: boolean;
}
