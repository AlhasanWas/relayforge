import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { OutboxTopic, type Prisma } from '../generated/prisma/client';

export interface ScheduleDeliveriesInput {
  readonly workspaceId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Prisma.InputJsonObject;
  readonly now: Date;
}

/**
 * Creates one delivery per active endpoint subscribed to the event type, each with
 * its outbox message, inside the caller's transaction.
 */
@Injectable()
export class DeliveryScheduler {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async scheduleForEvent(
    tx: Prisma.TransactionClient,
    input: ScheduleDeliveriesInput,
  ): Promise<number> {
    const endpoints = await tx.webhookEndpoint.findMany({
      where: {
        workspaceId: input.workspaceId,
        isActive: true,
        deletedAt: null,
        eventTypes: { has: input.eventType },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (endpoints.length === 0) {
      return 0;
    }

    const deliveries = await tx.webhookDelivery.createManyAndReturn({
      data: endpoints.map((endpoint) => ({
        workspaceId: input.workspaceId,
        eventId: input.eventId,
        endpointId: endpoint.id,
        payload: input.payload,
        maxAttempts: this.config.delivery.maxAttempts,
        nextAttemptAt: input.now,
      })),
      select: { id: true },
    });

    await tx.outboxMessage.createMany({
      data: deliveries.map((delivery) => ({
        workspaceId: input.workspaceId,
        topic: OutboxTopic.WEBHOOK_DELIVERY_REQUESTED,
        aggregateId: delivery.id,
        availableAt: input.now,
      })),
    });
    return deliveries.length;
  }
}
