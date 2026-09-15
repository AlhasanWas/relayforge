import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, RequestId, RequireRole } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { ApiKeyRole } from '../generated/prisma/client';
import {
  DeliveryDetailResponse,
  DeliveryPageResponse,
  ListDeliveriesQueryDto,
  ReplayAcceptedResponse,
} from './delivery.dto';
import { DeliveriesService } from './deliveries.service';

@ApiTags('Deliveries')
@ApiBearerAuth()
@Controller('v1/deliveries')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List webhook deliveries, newest first (filter status=DEAD_LETTER for the dead-letter queue)',
  })
  @ApiOkResponse({ type: DeliveryPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListDeliveriesQueryDto,
  ): Promise<DeliveryPageResponse> {
    return this.deliveries.list(principal.workspaceId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a delivery with its payload and every recorded attempt' })
  @ApiOkResponse({ type: DeliveryDetailResponse })
  @ApiNotFoundResponse()
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DeliveryDetailResponse> {
    return this.deliveries.get(principal.workspaceId, id);
  }

  @Post(':id/replay')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Replay a delivery',
    description:
      'Creates a new delivery of the same payload with the same webhook-id. The original delivery and its attempts are never modified.',
  })
  @ApiAcceptedResponse({ type: ReplayAcceptedResponse })
  @ApiNotFoundResponse()
  @ApiConflictResponse({
    description: 'Not in a final state, endpoint unavailable, or a replay is already active',
  })
  replay(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @RequestId() requestId: string | null,
  ): Promise<ReplayAcceptedResponse> {
    return this.deliveries.replay(principal, id, requestId);
  }
}
