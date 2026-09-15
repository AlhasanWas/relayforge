import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { type MetricsOverview, MetricsService } from './metrics.service';

export class MetricsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 720, default: 24 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  windowHours?: number;
}

class MetricsOverviewResponse implements MetricsOverview {
  @ApiProperty({
    example: { from: '2026-09-14T12:00:00.000Z', to: '2026-09-15T12:00:00.000Z', hours: 24 },
  })
  window!: MetricsOverview['window'];

  @ApiProperty({ example: { received: 120, processed: 118, failed: 1, ignored: 1 } })
  events!: MetricsOverview['events'];

  @ApiProperty({ example: 3 })
  rejectedWebhooks!: number;

  @ApiProperty({ example: { succeeded: 230, failedAttempts: 12, deadLetter: 2, inProgress: 4 } })
  deliveries!: MetricsOverview['deliveries'];

  @ApiProperty({
    example: { average: 84, p95: 310, sampleSize: 242 },
    description: 'HTTP round-trip time of delivery attempts in the window',
  })
  deliveryLatencyMs!: MetricsOverview['deliveryLatencyMs'];
}

@ApiTags('Metrics')
@ApiBearerAuth()
@Controller('v1/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Operational metrics for the workspace over a time window' })
  @ApiOkResponse({ type: MetricsOverviewResponse })
  overview(
    @CurrentPrincipal() principal: Principal,
    @Query() query: MetricsQueryDto,
  ): Promise<MetricsOverviewResponse> {
    return this.metrics.overview(principal.workspaceId, query.windowHours ?? 24);
  }
}
