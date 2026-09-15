import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import {
  AttemptOutcome,
  DeadLetterReason,
  type DeliveryAttempt,
  DeliveryStatus,
  type WebhookDelivery,
} from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';

export class ListDeliveriesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: DeliveryStatus })
  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  endpointId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  eventId?: string;
}

export class DeliverySummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Also sent as the webhook-id header' })
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  endpointId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, type: String })
  replayOfDeliveryId!: string | null;

  @ApiProperty({ enum: DeliveryStatus })
  status!: DeliveryStatus;

  @ApiProperty()
  attemptCount!: number;

  @ApiProperty()
  maxAttempts!: number;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  nextAttemptAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  deliveredAt!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  deadLetteredAt!: string | null;

  @ApiPropertyOptional({ enum: DeadLetterReason, nullable: true })
  deadLetterReason!: DeadLetterReason | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DeliveryAttemptResponse {
  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty({
    enum: AttemptOutcome,
    description: 'UNKNOWN: the worker lost its lease; the receiver may or may not have the webhook',
  })
  outcome!: AttemptOutcome;

  @ApiPropertyOptional({ nullable: true, type: Number })
  responseStatus!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  errorCode!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  errorMessage!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String, description: 'First bytes of the response' })
  responseBody!: string | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  durationMs!: number | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  startedAt!: string | null;

  @ApiProperty({ format: 'date-time' })
  recordedAt!: string;
}

export class DeliveryDetailResponse extends DeliverySummaryResponse {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The body sent on every attempt',
  })
  payload!: unknown;

  @ApiProperty({ type: [DeliveryAttemptResponse] })
  attempts!: DeliveryAttemptResponse[];
}

export class DeliveryPageResponse {
  @ApiProperty({ type: [DeliverySummaryResponse] })
  data!: DeliverySummaryResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export class ReplayAcceptedResponse {
  @ApiProperty({ format: 'uuid', description: 'The new delivery' })
  deliveryId!: string;

  @ApiProperty({ format: 'uuid' })
  replayOfDeliveryId!: string;
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toDeliverySummary(
  delivery: Omit<WebhookDelivery, 'payload'>,
): DeliverySummaryResponse {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    replayOfDeliveryId: delivery.replayOfDeliveryId,
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    maxAttempts: delivery.maxAttempts,
    nextAttemptAt: iso(delivery.nextAttemptAt),
    deliveredAt: iso(delivery.deliveredAt),
    deadLetteredAt: iso(delivery.deadLetteredAt),
    deadLetterReason: delivery.deadLetterReason,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

export function toAttemptResponse(attempt: DeliveryAttempt): DeliveryAttemptResponse {
  return {
    attemptNumber: attempt.attemptNumber,
    outcome: attempt.outcome,
    responseStatus: attempt.responseStatus,
    errorCode: attempt.errorCode,
    errorMessage: attempt.errorMessage,
    responseBody: attempt.responseBody,
    durationMs: attempt.durationMs,
    startedAt: iso(attempt.startedAt),
    recordedAt: attempt.recordedAt.toISOString(),
  };
}
