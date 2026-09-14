import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { PageQueryDto } from '../http/pagination';
import { ProviderConnectionPageResponse } from './provider-connection.dto';
import { ProviderConnectionsService } from './provider-connections.service';

@ApiTags('Provider connections')
@ApiBearerAuth()
@Controller('v1/provider-connections')
export class ProviderConnectionsController {
  constructor(private readonly connections: ProviderConnectionsService) {}

  @Get()
  @ApiOperation({ summary: 'List provider connections and their ingress URLs' })
  @ApiOkResponse({ type: ProviderConnectionPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageQueryDto,
  ): Promise<ProviderConnectionPageResponse> {
    return this.connections.list(principal.workspaceId, query);
  }
}
