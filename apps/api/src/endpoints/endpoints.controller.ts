import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
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
import {
  CreatedEndpointResponse,
  CreateEndpointDto,
  EndpointPageResponse,
  EndpointResponse,
  UpdateEndpointDto,
} from './endpoint.dto';
import { EndpointsService } from './endpoints.service';

@ApiTags('Endpoints')
@ApiBearerAuth()
@Controller('v1/endpoints')
export class EndpointsController {
  constructor(private readonly endpoints: EndpointsService) {}

  @Post()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({
    summary: 'Register a webhook endpoint. The signing secret is returned only once.',
  })
  @ApiCreatedResponse({ type: CreatedEndpointResponse })
  create(
    @CurrentPrincipal() principal: Principal,
    @Body() body: CreateEndpointDto,
    @RequestId() requestId: string | null,
  ): Promise<CreatedEndpointResponse> {
    return this.endpoints.create(principal, body, requestId);
  }

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints, newest first' })
  @ApiOkResponse({ type: EndpointPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: PageQueryDto,
  ): Promise<EndpointPageResponse> {
    return this.endpoints.list(principal.workspaceId, query);
  }

  @Get(':id')
  @ApiOkResponse({ type: EndpointResponse })
  @ApiNotFoundResponse()
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EndpointResponse> {
    return this.endpoints.get(principal.workspaceId, id);
  }

  @Patch(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update an endpoint. Existing deliveries keep their original payload.' })
  @ApiOkResponse({ type: EndpointResponse })
  @ApiNotFoundResponse()
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateEndpointDto,
    @RequestId() requestId: string | null,
  ): Promise<EndpointResponse> {
    return this.endpoints.update(principal, id, body, requestId);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an endpoint. Its delivery history is kept.' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse()
  remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @RequestId() requestId: string | null,
  ): Promise<void> {
    return this.endpoints.remove(principal, id, requestId);
  }
}
