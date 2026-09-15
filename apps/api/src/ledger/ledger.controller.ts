import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { AccountBalanceResponse, JournalPageResponse, ListLedgerQueryDto } from './ledger.dto';
import { LedgerQueryService } from './ledger-query.service';

@ApiTags('Ledger')
@ApiBearerAuth()
@Controller('v1/ledger')
export class LedgerController {
  constructor(private readonly ledger: LedgerQueryService) {}

  @Get()
  @ApiOperation({ summary: 'List journal entries with their postings, newest first' })
  @ApiOkResponse({ type: JournalPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListLedgerQueryDto,
  ): Promise<JournalPageResponse> {
    return this.ledger.listJournals(principal.workspaceId, query);
  }

  @Get('balances')
  @ApiOperation({ summary: 'Current balance of every ledger account' })
  @ApiOkResponse({ type: [AccountBalanceResponse] })
  balances(@CurrentPrincipal() principal: Principal): Promise<AccountBalanceResponse[]> {
    return this.ledger.balances(principal.workspaceId);
  }
}
