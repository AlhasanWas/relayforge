import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import {
  ListTransactionsQueryDto,
  TransactionDetailResponse,
  TransactionPageResponse,
} from './transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('v1/transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'List payment transactions, newest first' })
  @ApiOkResponse({ type: TransactionPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<TransactionPageResponse> {
    return this.transactions.list(principal.workspaceId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a transaction with its ledger journals' })
  @ApiOkResponse({ type: TransactionDetailResponse })
  @ApiNotFoundResponse()
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<TransactionDetailResponse> {
    return this.transactions.get(principal.workspaceId, id);
  }
}
