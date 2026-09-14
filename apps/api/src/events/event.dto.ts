import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { type IncomingEvent, IncomingEventStatus } from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';

export class ListEventsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: IncomingEventStatus })
  @IsOptional()
  @IsEnum(IncomingEventStatus)
  status?: IncomingEventStatus;

  @ApiPropertyOptional({ example: 'payment.succeeded' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  providerConnectionId?: string;
}

export class EventSummaryResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  providerConnectionId!: string;

  @ApiProperty({ description: 'The provider’s event id; unique per provider connection' })
  externalEventId!: string;

  @ApiProperty({ example: 'payment.succeeded' })
  eventType!: string;

  @ApiProperty({ enum: IncomingEventStatus })
  status!: IncomingEventStatus;

  @ApiProperty({ description: 'SHA-256 of the raw request body' })
  payloadHash!: string;

  @ApiProperty()
  signatureValid!: boolean;

  @ApiProperty()
  processingAttempts!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  receivedAt!: string;

  @ApiPropertyOptional({ format: 'date-time', nullable: true, type: String })
  processedAt!: string | null;
}

export class EventDetailResponse extends EventSummaryResponse {
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The received body' })
  payload!: unknown;
}

export class EventPageResponse {
  @ApiProperty({ type: [EventSummaryResponse] })
  data!: EventSummaryResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export function toEventSummary(event: Omit<IncomingEvent, 'payload'>): EventSummaryResponse {
  return {
    id: event.id,
    providerConnectionId: event.providerConnectionId,
    externalEventId: event.externalEventId,
    eventType: event.eventType,
    status: event.status,
    payloadHash: event.payloadHash,
    signatureValid: event.signatureValid,
    processingAttempts: event.processingAttempts,
    failureReason: event.failureReason,
    receivedAt: event.receivedAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

export function toEventDetail(event: IncomingEvent): EventDetailResponse {
  return Object.assign(toEventSummary(event), { payload: event.payload });
}
