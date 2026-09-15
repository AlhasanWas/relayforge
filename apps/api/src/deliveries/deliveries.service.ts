import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AuditLogService } from '../audit/audit-log.service';
import type { Principal } from '../auth/principal';
import { Clock } from '../clock/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { isUniqueViolation } from '../database/prisma-errors';
import { PrismaService } from '../database/prisma.service';
import { AppError, NotFoundError } from '../errors/app-error';
import { DeliveryStatus, OutboxTopic, type Prisma } from '../generated/prisma/client';
import { type Page, pageArgs, toPage } from '../http/pagination';
import {
  type DeliveryDetailResponse,
  type DeliverySummaryResponse,
  type ListDeliveriesQueryDto,
  type ReplayAcceptedResponse,
  toAttemptResponse,
  toDeliverySummary,
} from './delivery.dto';

const REPLAYABLE_STATUSES = new Set<DeliveryStatus>([
  DeliveryStatus.SUCCEEDED,
  DeliveryStatus.DEAD_LETTER,
]);
const ACTIVE_REPLAY_INDEX = 'webhook_deliveries_active_replay_key';

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(
    workspaceId: string,
    query: ListDeliveriesQueryDto,
  ): Promise<Page<DeliverySummaryResponse>> {
    const args = pageArgs(query);
    const rows = await this.prisma.webhookDelivery.findMany({
      ...args,
      where: {
        ...args.where,
        workspaceId,
        status: query.status,
        endpointId: query.endpointId,
        eventId: query.eventId,
      },
      omit: { payload: true },
    });
    return toPage(rows, query, toDeliverySummary);
  }

  async get(workspaceId: string, deliveryId: string): Promise<DeliveryDetailResponse> {
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId },
      include: { attempts: { orderBy: { attemptNumber: 'asc' } } },
    });
    if (delivery === null) {
      throw new NotFoundError('Delivery', deliveryId);
    }
    return Object.assign(toDeliverySummary(delivery), {
      payload: delivery.payload,
      attempts: delivery.attempts.map(toAttemptResponse),
    });
  }

  /**
   * Schedules a new delivery of the same payload to the same endpoint. History is
   * never rewritten: the original delivery and its attempts stay as they are.
   */
  async replay(
    principal: Principal,
    deliveryId: string,
    requestId: string | null,
  ): Promise<ReplayAcceptedResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const original = await tx.webhookDelivery.findFirst({
          where: { id: deliveryId, workspaceId: principal.workspaceId },
          include: { endpoint: { select: { isActive: true, deletedAt: true } } },
        });
        if (original === null) {
          throw new NotFoundError('Delivery', deliveryId);
        }
        if (!REPLAYABLE_STATUSES.has(original.status)) {
          throw new AppError(
            'DELIVERY_NOT_REPLAYABLE',
            `Only SUCCEEDED or DEAD_LETTER deliveries can be replayed; this one is ${original.status}`,
            HttpStatus.CONFLICT,
          );
        }
        if (!original.endpoint.isActive || original.endpoint.deletedAt !== null) {
          throw new AppError(
            'ENDPOINT_UNAVAILABLE',
            'The endpoint is disabled or deleted; re-enable it before replaying',
            HttpStatus.CONFLICT,
          );
        }
        await this.assertNoActiveReplay(tx, original.id);

        const now = this.clock.now();
        const replay = await tx.webhookDelivery.create({
          data: {
            workspaceId: original.workspaceId,
            eventId: original.eventId,
            endpointId: original.endpointId,
            replayOfDeliveryId: original.id,
            payload: original.payload as Prisma.InputJsonValue,
            maxAttempts: this.config.delivery.maxAttempts,
            nextAttemptAt: now,
          },
          select: { id: true },
        });
        await tx.outboxMessage.create({
          data: {
            workspaceId: original.workspaceId,
            topic: OutboxTopic.WEBHOOK_DELIVERY_REQUESTED,
            aggregateId: replay.id,
            availableAt: now,
          },
        });
        await this.audit.record(tx, {
          workspaceId: principal.workspaceId,
          actor: principal,
          action: 'delivery.replayed',
          resourceType: 'webhook_delivery',
          resourceId: original.id,
          metadata: { replayDeliveryId: replay.id, originalStatus: original.status },
          requestId,
        });
        return { deliveryId: replay.id, replayOfDeliveryId: original.id };
      });
    } catch (error: unknown) {
      // A concurrent replay of the same delivery won the race for the partial unique index.
      if (isUniqueViolation(error, ACTIVE_REPLAY_INDEX)) {
        throw replayInProgress();
      }
      throw error;
    }
  }

  private async assertNoActiveReplay(
    tx: Prisma.TransactionClient,
    deliveryId: string,
  ): Promise<void> {
    const active = await tx.webhookDelivery.count({
      where: {
        replayOfDeliveryId: deliveryId,
        status: { in: [DeliveryStatus.PENDING, DeliveryStatus.PROCESSING] },
      },
    });
    if (active > 0) {
      throw replayInProgress();
    }
  }
}

function replayInProgress(): AppError {
  return new AppError(
    'REPLAY_IN_PROGRESS',
    'A replay of this delivery is already pending or in progress',
    HttpStatus.CONFLICT,
  );
}
