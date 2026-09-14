import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { type RejectedWebhookAttempt, RejectionReason } from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';

export class ListRejectedAttemptsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: RejectionReason })
  @IsOptional()
  @IsEnum(RejectionReason)
  reason?: RejectionReason;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  providerConnectionId?: string;
}

export class RejectedAttemptResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  providerConnectionId!: string;

  @ApiProperty({ enum: RejectionReason })
  reason!: RejectionReason;

  @ApiProperty({ description: 'SHA-256 of the rejected body; the body itself is not stored' })
  payloadHash!: string;

  @ApiProperty()
  bodyBytes!: number;

  @ApiProperty()
  requestId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceIp!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true })
  metadata!: unknown;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;
}

export class RejectedAttemptPageResponse {
  @ApiProperty({ type: [RejectedAttemptResponse] })
  data!: RejectedAttemptResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export function toRejectedAttemptResponse(
  attempt: RejectedWebhookAttempt,
): RejectedAttemptResponse {
  return {
    id: attempt.id,
    providerConnectionId: attempt.providerConnectionId,
    reason: attempt.reason,
    payloadHash: attempt.payloadHash,
    bodyBytes: attempt.bodyBytes,
    requestId: attempt.requestId,
    sourceIp: attempt.sourceIp,
    metadata: attempt.metadata,
    receivedAt: attempt.receivedAt.toISOString(),
  };
}
