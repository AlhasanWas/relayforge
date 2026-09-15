import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MOCKPAY_EVENT_TYPES } from '@relayforge/shared/providers';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import type { WebhookEndpoint } from '../generated/prisma/client';

/** Event types an endpoint can subscribe to: the types RelayForge processes. */
export const SUBSCRIBABLE_EVENT_TYPES = MOCKPAY_EVENT_TYPES;

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false };

export class CreateEndpointDto {
  @ApiProperty({ example: 'https://merchant.example/webhooks/relayforge', maxLength: 2048 })
  @IsUrl(URL_OPTIONS)
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ enum: SUBSCRIBABLE_EVENT_TYPES, isArray: true, example: ['payment.succeeded'] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(SUBSCRIBABLE_EVENT_TYPES.length)
  @IsIn(SUBSCRIBABLE_EVENT_TYPES, { each: true })
  eventTypes!: string[];
}

export class UpdateEndpointDto {
  @ApiPropertyOptional({ maxLength: 2048 })
  @IsOptional()
  @IsUrl(URL_OPTIONS)
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true, type: String })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ enum: SUBSCRIBABLE_EVENT_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @ArrayMaxSize(SUBSCRIBABLE_EVENT_TYPES.length)
  @IsIn(SUBSCRIBABLE_EVENT_TYPES, { each: true })
  eventTypes?: string[];

  @ApiPropertyOptional({ description: 'Inactive endpoints receive no new deliveries' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class EndpointResponse {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  url!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ isArray: true, enum: SUBSCRIBABLE_EVENT_TYPES })
  eventTypes!: string[];

  @ApiProperty()
  isActive!: boolean;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class CreatedEndpointResponse extends EndpointResponse {
  @ApiProperty({
    example: 'whsec_…',
    description:
      'Standard Webhooks signing secret used to sign deliveries. Shown only in this response.',
  })
  signingSecret!: string;
}

export class EndpointPageResponse {
  @ApiProperty({ type: [EndpointResponse] })
  data!: EndpointResponse[];

  @ApiPropertyOptional({ nullable: true, type: String })
  nextCursor!: string | null;
}

export function toEndpointResponse(
  endpoint: Omit<WebhookEndpoint, 'signingSecretEncrypted'>,
): EndpointResponse {
  return {
    id: endpoint.id,
    url: endpoint.url,
    description: endpoint.description,
    eventTypes: endpoint.eventTypes,
    isActive: endpoint.isActive,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}
