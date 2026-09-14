import { Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/auth.decorators';
import { requestIdOf } from '../logging/request-id';
import { RateLimitPolicy } from '../rate-limit/rate-limit-policy';
import { WebhookIngestionService } from './webhook-ingestion.service';

class IngestionAcceptedResponse {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ description: 'True if this exact event was already received' })
  duplicate!: boolean;
}

/**
 * Provider-facing endpoint. Authenticated by the webhook signature, not an API key.
 * The raw request body is captured by a dedicated body parser (see configureHttpApp).
 */
@ApiTags('Webhook ingestion')
@Public()
@RateLimitPolicy('ingestion')
@Controller('v1/webhooks')
export class WebhookIngestionController {
  constructor(private readonly ingestion: WebhookIngestionService) {}

  @Post(':publicIngressKey')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Receive a signed provider webhook',
    description:
      'Duplicates of an already received event also return 202, so retries by the provider are idempotent.',
  })
  @ApiAcceptedResponse({ type: IngestionAcceptedResponse })
  @ApiUnauthorizedResponse({ description: 'Signature missing, invalid or outside tolerance' })
  @ApiNotFoundResponse({ description: 'Unknown or disabled ingress key' })
  @ApiConflictResponse({ description: 'Same event id already received with a different payload' })
  @ApiUnprocessableEntityResponse({ description: 'Authenticated but invalid payload' })
  receive(
    @Param('publicIngressKey') ingressKey: string,
    @Req() request: Request,
  ): Promise<IngestionAcceptedResponse> {
    return this.ingestion.ingest({
      ingressKey,
      rawBody: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
      headers: request.headers,
      requestId: requestIdOf(request),
      sourceIp: request.ip ?? null,
    });
  }
}
