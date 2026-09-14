import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { ListRejectedAttemptsQueryDto, RejectedAttemptPageResponse } from './rejected-attempt.dto';
import { RejectedAttemptsService } from './rejected-attempts.service';

@ApiTags('Webhook ingestion')
@ApiBearerAuth()
@Controller('v1/rejected-webhook-attempts')
export class RejectedAttemptsController {
  constructor(private readonly attempts: RejectedAttemptsService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook requests rejected for this workspace’s connections' })
  @ApiOkResponse({ type: RejectedAttemptPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListRejectedAttemptsQueryDto,
  ): Promise<RejectedAttemptPageResponse> {
    return this.attempts.list(principal.workspaceId, query);
  }
}
