import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { backoffDelayMs } from '../common/backoff';
import { Clock } from '../clock/clock';
import { RandomSource } from '../clock/random-source';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../database/prisma.service';
import { buildDeliveryPayload } from '../deliveries/delivery-payload';
import { DeliveryScheduler } from '../deliveries/delivery-scheduler';
import {
  IncomingEventStatus,
  LedgerTransactionKind,
  OutboxTopic,
  type IncomingEvent,
  type Prisma,
  type Transaction,
} from '../generated/prisma/client';
import { LedgerWriter } from '../ledger/ledger-writer';
import type { PaymentEvent } from '../providers/payment-event';
import { ProviderAdapterRegistry } from '../providers/provider-adapter.registry';
import { decide, type JournalRequest } from './payment-state-machine';

export type ProcessingOutcome =
  | 'PROCESSED'
  | 'IGNORED'
  | 'FAILED'
  | 'RETRY_SCHEDULED'
  /** Another run already finished this event; nothing to do. */
  | 'ALREADY_FINAL'
  /** A newer retry is scheduled for this event; this job is stale. */
  | 'SUPERSEDED'
  | 'NOT_FOUND';

type EventWithProvider = Prisma.IncomingEventGetPayload<{
  include: { providerConnection: { include: { providerDefinition: true } } };
}>;

/**
 * Applies an incoming event to financial state.
 *
 * Everything happens in one database transaction: lock the event row, decide with
 * the pure state machine, write the domain transaction, the balanced journal, the
 * deliveries and their outbox messages, and mark the event final. No network I/O
 * happens inside the transaction. A crash rolls back everything; the event stays
 * RECEIVED and is processed again.
 */
@Injectable()
export class EventProcessor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly ledger: LedgerWriter,
    private readonly deliveries: DeliveryScheduler,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EventProcessor.name);
  }

  /**
   * @param outboxMessageId The message that requested this run, when known. Used to
   *   detect stale jobs superseded by a newer scheduled retry.
   */
  async process(eventId: string, outboxMessageId?: string): Promise<ProcessingOutcome> {
    const startedAt = performance.now();
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialises concurrent runs for the same event; the loser sees a final status.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM incoming_events WHERE id = ${eventId}::uuid FOR UPDATE`;
      if (locked.length === 0) {
        return 'NOT_FOUND';
      }

      const event = await tx.incomingEvent.findUniqueOrThrow({
        where: { id: eventId },
        include: { providerConnection: { include: { providerDefinition: true } } },
      });
      if (event.status !== IncomingEventStatus.RECEIVED) {
        return 'ALREADY_FINAL';
      }
      const now = this.clock.now();
      if (await this.isSuperseded(tx, eventId, outboxMessageId, now)) {
        return 'SUPERSEDED';
      }

      const adapter = this.adapters.get(event.providerConnection.providerDefinition.adapterType);
      const normalized = adapter.normalizeEvent(event.payload);
      switch (normalized.kind) {
        case 'unsupported':
          await this.finish(tx, event, now, IncomingEventStatus.IGNORED);
          return 'IGNORED';
        case 'invalid':
          await this.fail(tx, event, now, 'INVALID_STORED_PAYLOAD');
          return 'FAILED';
        case 'payment':
          return this.applyPayment(tx, event, normalized.event, now);
      }
    });

    this.logger.info(
      {
        correlationId: eventId,
        eventId,
        outcome,
        durationMs: Math.round(performance.now() - startedAt),
      },
      'Event processing finished',
    );
    return outcome;
  }

  /**
   * Called when BullMQ has exhausted its attempts because processing kept throwing
   * (for example a persistent database error). Bounds a poison event: it becomes
   * FAILED instead of being retried forever by recovery.
   */
  async markFailedAfterUnexpectedErrors(eventId: string): Promise<void> {
    const now = this.clock.now();
    const updated = await this.prisma.incomingEvent.updateMany({
      where: { id: eventId, status: IncomingEventStatus.RECEIVED },
      data: {
        status: IncomingEventStatus.FAILED,
        failureReason: 'PROCESSING_ERROR',
        processedAt: now,
        processingAttempts: { increment: 1 },
      },
    });
    if (updated.count > 0) {
      this.logger.error(
        { correlationId: eventId, eventId },
        'Event marked FAILED after repeated processing errors',
      );
    }
  }

  private async applyPayment(
    tx: Prisma.TransactionClient,
    event: EventWithProvider,
    payment: PaymentEvent,
    now: Date,
  ): Promise<ProcessingOutcome> {
    // Different events for the same payment (a success and a refund, or two
    // refunds) serialise here, so they never race to create or update the transaction.
    await tx.$queryRaw`
      SELECT 1 AS locked
        FROM (SELECT pg_advisory_xact_lock(
                hashtextextended(${event.providerConnectionId}::text || ':' || ${payment.paymentId}::text, 0)
              )) AS advisory`;

    const existing = await tx.transaction.findUnique({
      where: {
        providerConnectionId_externalPaymentId: {
          providerConnectionId: event.providerConnectionId,
          externalPaymentId: payment.paymentId,
        },
      },
    });
    const refundAlreadyRecorded =
      payment.type === 'payment.refunded' &&
      existing !== null &&
      (await tx.ledgerTransaction.count({
        where: {
          transactionId: existing.id,
          kind: LedgerTransactionKind.PAYMENT_REFUNDED,
          externalReferenceId: payment.refundId,
        },
      })) > 0;

    const decision = decide(existing, payment, { refundAlreadyRecorded });
    switch (decision.outcome) {
      case 'create': {
        const transaction = await tx.transaction.create({
          data: {
            workspaceId: event.workspaceId,
            providerConnectionId: event.providerConnectionId,
            externalPaymentId: payment.paymentId,
            status: decision.status,
            currency: payment.currency,
            amountMinor: payment.amountMinor,
            createdByEventId: event.id,
          },
        });
        return this.complete(tx, event, transaction, decision.journal, now);
      }
      case 'update': {
        if (existing === null) {
          throw new Error('State machine returned an update without an existing transaction');
        }
        const transaction = await tx.transaction.update({
          where: { id: existing.id },
          data: { status: decision.status, refundedAmountMinor: decision.refundedAmountMinor },
        });
        return this.complete(tx, event, transaction, decision.journal, now);
      }
      case 'no-change':
        await this.finish(tx, event, now, IncomingEventStatus.PROCESSED);
        return 'PROCESSED';
      case 'retry-later':
        return this.scheduleRetry(tx, event, decision.reason, now);
      case 'reject':
        await this.fail(tx, event, now, decision.reason);
        return 'FAILED';
    }
  }

  private async complete(
    tx: Prisma.TransactionClient,
    event: IncomingEvent,
    transaction: Transaction,
    journal: JournalRequest | null,
    now: Date,
  ): Promise<ProcessingOutcome> {
    if (journal !== null) {
      await this.ledger.record(tx, {
        workspaceId: event.workspaceId,
        transactionId: transaction.id,
        sourceEventId: event.id,
        journal,
      });
    }
    await this.deliveries.scheduleForEvent(tx, {
      workspaceId: event.workspaceId,
      eventId: event.id,
      eventType: event.eventType,
      payload: buildDeliveryPayload(event, transaction),
      now,
    });
    await this.finish(tx, event, now, IncomingEventStatus.PROCESSED);
    return 'PROCESSED';
  }

  private async scheduleRetry(
    tx: Prisma.TransactionClient,
    event: IncomingEvent,
    reason: string,
    now: Date,
  ): Promise<ProcessingOutcome> {
    const attempts = event.processingAttempts + 1;
    if (attempts >= this.config.eventProcessing.maxAttempts) {
      await this.fail(tx, event, now, reason);
      return 'FAILED';
    }
    const delayMs = backoffDelayMs(
      attempts,
      {
        baseMs: this.config.eventProcessing.retryBaseMs,
        maxMs: this.config.eventProcessing.retryMaxMs,
      },
      () => this.random.next(),
    );
    await tx.incomingEvent.update({
      where: { id: event.id },
      data: { processingAttempts: attempts },
    });
    await tx.outboxMessage.create({
      data: {
        workspaceId: event.workspaceId,
        topic: OutboxTopic.EVENT_PROCESSING_REQUESTED,
        aggregateId: event.id,
        availableAt: new Date(now.getTime() + delayMs),
      },
    });
    return 'RETRY_SCHEDULED';
  }

  private async isSuperseded(
    tx: Prisma.TransactionClient,
    eventId: string,
    outboxMessageId: string | undefined,
    now: Date,
  ): Promise<boolean> {
    if (outboxMessageId === undefined) {
      return false;
    }
    const newerRetries = await tx.outboxMessage.count({
      where: {
        aggregateId: eventId,
        topic: OutboxTopic.EVENT_PROCESSING_REQUESTED,
        publishedAt: null,
        availableAt: { gt: now },
        id: { not: outboxMessageId },
      },
    });
    return newerRetries > 0;
  }

  private async finish(
    tx: Prisma.TransactionClient,
    event: IncomingEvent,
    now: Date,
    status: typeof IncomingEventStatus.PROCESSED | typeof IncomingEventStatus.IGNORED,
  ): Promise<void> {
    await tx.incomingEvent.update({
      where: { id: event.id },
      data: { status, processedAt: now, processingAttempts: { increment: 1 } },
    });
  }

  private async fail(
    tx: Prisma.TransactionClient,
    event: IncomingEvent,
    now: Date,
    reason: string,
  ): Promise<void> {
    this.logger.warn(
      { correlationId: event.id, eventId: event.id, workspaceId: event.workspaceId, reason },
      'Event processing rejected',
    );
    await tx.incomingEvent.update({
      where: { id: event.id },
      data: {
        status: IncomingEventStatus.FAILED,
        failureReason: reason,
        processedAt: now,
        processingAttempts: { increment: 1 },
      },
    });
  }
}
