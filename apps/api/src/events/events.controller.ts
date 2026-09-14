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
import { EventDetailResponse, EventPageResponse, ListEventsQueryDto } from './event.dto';
import { EventsService } from './events.service';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('v1/events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'List received events, newest first' })
  @ApiOkResponse({ type: EventPageResponse })
  list(
    @CurrentPrincipal() principal: Principal,
    @Query() query: ListEventsQueryDto,
  ): Promise<EventPageResponse> {
    return this.events.list(principal.workspaceId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an event including its stored payload' })
  @ApiOkResponse({ type: EventDetailResponse })
  @ApiNotFoundResponse()
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EventDetailResponse> {
    return this.events.get(principal.workspaceId, id);
  }
}
