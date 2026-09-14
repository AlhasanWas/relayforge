import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentPrincipal, RequestId, RequireRole } from '../auth/auth.decorators';
import type { Principal } from '../auth/principal';
import { ApiKeyRole } from '../generated/prisma/client';
import { PageQueryDto } from '../http/pagination';
import { ApiKeyPageResponse, CreateApiKeyDto, CreatedApiKeyResponse } from './api-key.dto';
import { ApiKeysService } from './api-keys.service';

@ApiTags('API keys')
@ApiBearerAuth()
@RequireRole(ApiKeyRole.ADMIN)
@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: 'Create an API key. The key is returned only once.' })
  @ApiCreatedResponse({ type: CreatedApiKeyResponse })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateApiKeyDto,
    @RequestId() requestId: string | null,
  ): Promise<CreatedApiKeyResponse> {
    return this.apiKeys.create(principal, body, requestId);
  }

  @Get()
  @ApiOperation({ summary: 'List API keys in the workspace, newest first' })
  @ApiOkResponse({ type: ApiKeyPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageQueryDto,
  ): Promise<ApiKeyPageResponse> {
    return this.apiKeys.list(principal.workspaceId, query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke an API key. Revocation is immediate and permanent.' })
  @ApiNoContentResponse({ description: 'Revoked, or already revoked' })
  @ApiNotFoundResponse({ description: 'No such key in this workspace' })
  @ApiConflictResponse({ description: 'The key is the last active ADMIN key' })
  revoke(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @RequestId() requestId: string | null,
  ): Promise<void> {
    return this.apiKeys.revoke(principal, id, requestId);
  }
}
