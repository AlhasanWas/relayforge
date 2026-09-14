import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { NotFoundError } from '../errors/app-error';
import { type Page, pageArgs, toPage } from '../http/pagination';
import {
  type EventDetailResponse,
  type EventSummaryResponse,
  type ListEventsQueryDto,
  toEventDetail,
  toEventSummary,
} from './event.dto';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, query: ListEventsQueryDto): Promise<Page<EventSummaryResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.incomingEvent.findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId,
        status: query.status,
        eventType: query.eventType,
        providerConnectionId: query.providerConnectionId,
      },
      // Payloads can be large; the list view does not need them.
      omit: { payload: true },
    });
    return toPage(rows, query, toEventSummary);
  }

  async get(workspaceId: string, eventId: string): Promise<EventDetailResponse> {
    const event = await this.prisma.incomingEvent.findFirst({
      where: { id: eventId, workspaceId },
    });
    if (event === null) {
      throw new NotFoundError('Event', eventId);
    }
    return toEventDetail(event);
  }
}
