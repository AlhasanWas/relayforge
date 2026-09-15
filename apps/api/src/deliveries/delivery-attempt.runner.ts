import { Inject, Injectable } from '@nestjs/common';
import { createWebhookHeaders, toUnixSeconds } from '@relayforge/shared/webhooks';
import { PinoLogger } from 'nestjs-pino';
import { Clock } from '../clock/clock';
import { RandomSource } from '../clock/random-source';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { SecretCipher } from '../crypto/secret-cipher';
import { PrismaService } from '../database/prisma.service';
import {
  DeliveryStatus,
  OutboxTopic,
  type Prisma,
  type WebhookEndpoint,
} from '../generated/prisma/client';
import { OutboxWriter } from '../outbox/outbox-writer';
import { WorkerIdentity } from '../worker/worker-identity';
import { attemptRecord, deliveryStateUpdate } from './delivery-records';
import {
  type DeliveryResult,
  DeliveryRetryPolicy,
  type NextDeliveryState,
} from './delivery-retry-policy';
import { type OutboundWebhook, sendWebhook } from './webhook-http-client';

export type AttemptRunOutcome =
  | 'SUCCEEDED'
  | 'RETRY_SCHEDULED'
  | 'DEAD_LETTERED'
  /** Not due, already being attempted, or already final. Nothing was sent. */
  | 'NOT_CLAIMED'
  /** Sent, but recovery reclaimed the lease first; this worker's result was discarded. */
  | 'LEASE_LOST';

interface ClaimedDelivery {
  id: string;
  workspaceId: string;
  eventId: string;
  endpointId: string;
  attemptCount: number;
  maxAttempts: number;
  payload: unknown;
}

class LeaseLostError extends Error {}

export const WEBHOOK_USER_AGENT = 'RelayForge-Webhooks/0.1';

/**
 * Performs one delivery attempt:
 *
 * 1. Claim: a single conditional UPDATE moves a due PENDING delivery to PROCESSING,
 *    records this worker as lease owner and counts the attempt. At most one worker
 *    can hold the lease.
 * 2. Send: sign and POST outside any database transaction.
 * 3. Finalise: in one transaction, transition the delivery only if this worker still
 *    holds the lease, record the attempt, and schedule the retry in the outbox.
 *
 * If the process dies during step 2 or before step 3 commits, the lease expires and
 * recovery records the attempt as UNKNOWN and reschedules it. The receiver may
 * already have the webhook; delivery is at-least-once.
 */
@Injectable()
export class DeliveryAttemptRunner {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipher,
    private readonly outbox: OutboxWriter,
    private readonly policy: DeliveryRetryPolicy,
    private readonly identity: WorkerIdentity,
    private readonly clock: Clock,
    private readonly random: RandomSource,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DeliveryAttemptRunner.name);
  }

  async attempt(deliveryId: string): Promise<AttemptRunOutcome> {
    const claimed = await this.claim(deliveryId);
    if (claimed === undefined) {
      return 'NOT_CLAIMED';
    }

    const endpoint = await this.prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id: claimed.endpointId },
    });
    const startedAt = this.clock.now();
    const startedAtMs = performance.now();
    const result: DeliveryResult =
      endpoint.isActive && endpoint.deletedAt === null
        ? await sendWebhook(this.buildWebhook(claimed, endpoint, startedAt), {
            timeoutMs: this.config.delivery.timeoutMs,
            maxResponseBytes: this.config.delivery.responseBodyMaxBytes,
            allowPrivateDestinations: this.config.delivery.allowPrivateDestinations,
          })
        : { kind: 'endpoint-unavailable' };
    const durationMs = Math.round(performance.now() - startedAtMs);

    return this.finalise(claimed, result, startedAt, durationMs);
  }

  private async claim(deliveryId: string): Promise<ClaimedDelivery | undefined> {
    const now = this.clock.now();
    const leaseExpiresAt = new Date(now.getTime() + this.config.delivery.leaseMs);
    const [claimed] = await this.prisma.$queryRaw<ClaimedDelivery[]>`
      UPDATE webhook_deliveries
         SET status = 'PROCESSING',
             lease_owner = ${this.identity.id},
             lease_expires_at = ${leaseExpiresAt},
             attempt_count = attempt_count + 1,
             updated_at = ${now}
       WHERE id = ${deliveryId}::uuid
         AND status = 'PENDING'
         AND next_attempt_at <= ${now}
      RETURNING id,
                workspace_id AS "workspaceId",
                event_id AS "eventId",
                endpoint_id AS "endpointId",
                attempt_count AS "attemptCount",
                max_attempts AS "maxAttempts",
                payload`;
    return claimed;
  }

  private buildWebhook(
    delivery: ClaimedDelivery,
    endpoint: WebhookEndpoint,
    signedAt: Date,
  ): OutboundWebhook {
    const body = JSON.stringify(delivery.payload);
    return {
      url: endpoint.url,
      body,
      headers: {
        'content-type': 'application/json',
        'user-agent': WEBHOOK_USER_AGENT,
        // webhook-id is the event id: stable across retries and replays, so receivers
        // can deduplicate at-least-once delivery.
        ...createWebhookHeaders({
          secret: this.cipher.decrypt(
            endpoint.signingSecretEncrypted,
            'webhook_endpoint.signing_secret',
          ),
          messageId: delivery.eventId,
          timestamp: toUnixSeconds(signedAt),
          body,
        }),
        'relayforge-delivery-id': delivery.id,
        'relayforge-attempt': String(delivery.attemptCount),
      },
    };
  }

  private async finalise(
    delivery: ClaimedDelivery,
    result: DeliveryResult,
    startedAt: Date,
    durationMs: number,
  ): Promise<AttemptRunOutcome> {
    const now = this.clock.now();
    const verdict = this.policy.classify(result, now);
    const next = this.policy.nextState(
      verdict,
      delivery.attemptCount,
      delivery.maxAttempts,
      now,
      () => this.random.next(),
    );
    const logFields = {
      correlationId: delivery.eventId,
      eventId: delivery.eventId,
      deliveryId: delivery.id,
      workspaceId: delivery.workspaceId,
      attemptNumber: delivery.attemptCount,
      outcome: verdict.outcome,
      responseStatus: result.kind === 'response' ? result.status : undefined,
      durationMs,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        await this.applyNextState(tx, delivery, next, now);
        await tx.deliveryAttempt.create({
          data: attemptRecord({
            deliveryId: delivery.id,
            attemptNumber: delivery.attemptCount,
            outcome: verdict.outcome,
            result,
            startedAt,
            durationMs,
            timeoutMs: this.config.delivery.timeoutMs,
          }),
        });
      });
    } catch (error: unknown) {
      if (error instanceof LeaseLostError) {
        this.logger.warn(
          logFields,
          'Delivery lease lost before the attempt was recorded; result discarded',
        );
        return 'LEASE_LOST';
      }
      throw error;
    }

    this.logger.info({ ...logFields, nextStatus: next.status }, 'Delivery attempt recorded');
    switch (next.status) {
      case DeliveryStatus.SUCCEEDED:
        return 'SUCCEEDED';
      case DeliveryStatus.PENDING:
        return 'RETRY_SCHEDULED';
      case DeliveryStatus.DEAD_LETTER:
        return 'DEAD_LETTERED';
    }
  }

  /** Transitions the delivery only while this worker still holds its lease. */
  private async applyNextState(
    tx: Prisma.TransactionClient,
    delivery: ClaimedDelivery,
    next: NextDeliveryState,
    now: Date,
  ): Promise<void> {
    const updated = await tx.webhookDelivery.updateMany({
      where: {
        id: delivery.id,
        status: DeliveryStatus.PROCESSING,
        leaseOwner: this.identity.id,
      },
      data: deliveryStateUpdate(next, now),
    });
    if (updated.count === 0) {
      throw new LeaseLostError();
    }
    if (next.status === DeliveryStatus.PENDING) {
      await this.outbox.add(tx, {
        workspaceId: delivery.workspaceId,
        topic: OutboxTopic.WEBHOOK_DELIVERY_REQUESTED,
        aggregateId: delivery.id,
        availableAt: next.nextAttemptAt,
      });
    }
  }
}
