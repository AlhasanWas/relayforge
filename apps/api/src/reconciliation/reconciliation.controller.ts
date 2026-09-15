import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, RequestId, RequireRole } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { ApiKeyRole } from '../generated/prisma/client';
import { ReconciliationReportResponse } from './reconciliation.dto';
import { ReconciliationService } from './reconciliation.service';

@ApiTags('Reconciliation')
@ApiBearerAuth()
@RequireRole(ApiKeyRole.ADMIN)
@Controller('v1/admin/reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Compare transactions with the ledger and report discrepancies',
    description:
      'Runs synchronously against a consistent snapshot of the caller workspace. Read-only apart from an audit entry.',
  })
  @ApiOkResponse({ type: ReconciliationReportResponse })
  run(
    @CurrentPrincipal() principal: Principal,
    @RequestId() requestId: string | null,
  ): Promise<ReconciliationReportResponse> {
    return this.reconciliation.run(principal, requestId);
  }
}
