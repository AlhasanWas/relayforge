import { HttpStatus, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { Clock } from '../clock/clock';
import { SecretCipher } from '../crypto/secret-cipher';
import { PrismaService } from '../database/prisma.service';
import { AppError } from '../errors/app-error';
import {
  OutboxTopic,
  type Prisma,
  type ProviderConnection,
  type ProviderDefinition,
  type RejectionReason,
} from '../generated/prisma/client';
import { OutboxWriter } from '../outbox/outbox-writer';
import type { AcceptedProviderEvent, ProviderAdapter } from '../providers/provider-adapter';
import { ProviderAdapterRegistry } from '../providers/provider-adapter.registry';
import {
  type IncomingWebhook,
  isJsonContentType,
  rejectionMetadata,
  sha256Hex,
} from './incoming-webhook';
import { isWellFormedIngressKey } from './ingress-key';
import { RejectedAttemptRecorder } from './rejected-attempt.recorder';

export interface IngestionResult {
  eventId: string;
  /** True when this exact event had already been received; nothing new was stored. */
  duplicate: boolean;
}

type ConnectionWithDefinition = ProviderConnection & { providerDefinition: ProviderDefinition };

type PersistOutcome =
  | { kind: 'accepted'; eventId: string }
  | { kind: 'duplicate'; eventId: string }
  | { kind: 'conflict'; existingEventId: string };

/**
 * Receives signed provider webhooks.
 *
 * Order matters: resolve the connection, verify the signature over the raw bytes,
 * then validate the payload, then store the event and its outbox message in one
 * transaction. Nothing unauthenticated reaches the events table, and nothing in
 * the request path depends on Redis.
 */
@Injectable()
export class WebhookIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: ProviderAdapterRegistry,
    private readonly cipher: SecretCipher,
    private readonly outbox: OutboxWriter,
    private readonly rejections: RejectedAttemptRecorder,
    private readonly clock: Clock,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WebhookIngestionService.name);
  }

  async ingest(webhook: IncomingWebhook): Promise<IngestionResult> {
    const connection = await this.resolveConnection(webhook.ingressKey);
    const adapter = this.adapters.get(connection.providerDefinition.adapterType);
    const reject = (reason: RejectionReason, extra?: Prisma.InputJsonObject) =>
      this.rejections.record(
        {
          workspaceId: connection.workspaceId,
          providerConnectionId: connection.id,
          webhook,
          metadata: rejectionMetadata(webhook, adapter.diagnosticHeaderNames, extra),
        },
        reason,
      );

    if (!connection.enabled || !connection.providerDefinition.enabled) {
      await reject('CONNECTION_DISABLED');
      throw ingressNotFound();
    }

    const verification = adapter.verifier.verify({
      rawBody: webhook.rawBody,
      headers: webhook.headers,
      secret: this.cipher.decrypt(
        connection.signingSecretEncrypted,
        'provider_connection.signing_secret',
      ),
      now: this.clock.now(),
      toleranceSeconds: connection.timestampToleranceSec,
    });
    if (!verification.valid) {
      await reject(verification.reason);
      throw new AppError(
        'SIGNATURE_VERIFICATION_FAILED',
        'Webhook signature verification failed',
        HttpStatus.UNAUTHORIZED,
        { reason: verification.reason },
      );
    }

    const event = await this.parsePayload(webhook, adapter, verification.messageId, reject);
    const payloadHash = sha256Hex(webhook.rawBody);
    const outcome = await this.persist(connection, event, payloadHash);

    const logFields = {
      workspaceId: connection.workspaceId,
      providerConnectionId: connection.id,
      externalEventId: event.externalEventId,
      eventType: event.eventType,
    };

    switch (outcome.kind) {
      case 'accepted':
        this.logger.info({ ...logFields, eventId: outcome.eventId }, 'Webhook event accepted');
        return { eventId: outcome.eventId, duplicate: false };
      case 'duplicate':
        this.logger.info({ ...logFields, eventId: outcome.eventId }, 'Duplicate webhook event');
        return { eventId: outcome.eventId, duplicate: true };
      case 'conflict':
        await reject('PAYLOAD_CONFLICT', {
          externalEventId: event.externalEventId,
          existingEventId: outcome.existingEventId,
        });
        throw new AppError(
          'EVENT_PAYLOAD_CONFLICT',
          'An event with this id was already received with a different payload',
          HttpStatus.CONFLICT,
          { externalEventId: event.externalEventId },
        );
    }
  }

  private async resolveConnection(ingressKey: string): Promise<ConnectionWithDefinition> {
    const connection = isWellFormedIngressKey(ingressKey)
      ? await this.prisma.providerConnection.findUnique({
          where: { publicIngressKey: ingressKey },
          include: { providerDefinition: true },
        })
      : null;
    if (connection === null) {
      // Unattributable requests are logged but not persisted: storing them would give
      // anyone on the internet a free write path into the database.
      this.logger.info({ ingressKey: ingressKey.slice(0, 64) }, 'Webhook for unknown ingress key');
      throw ingressNotFound();
    }
    return connection;
  }

  private async parsePayload(
    webhook: IncomingWebhook,
    adapter: ProviderAdapter,
    signedMessageId: string | null,
    reject: (reason: RejectionReason, extra?: Prisma.InputJsonObject) => Promise<void>,
  ): Promise<AcceptedProviderEvent> {
    const contentType = webhook.headers['content-type'];
    if (!isJsonContentType(contentType)) {
      await reject('INVALID_PAYLOAD', {
        issues: [{ path: '', message: 'content-type must be application/json' }],
      });
      throw new AppError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Webhook content-type must be application/json',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    const parsed = adapter.parsePayload(webhook.rawBody, signedMessageId);
    if (!parsed.ok) {
      const issues = parsed.issues.slice(0, 20);
      await reject('INVALID_PAYLOAD', { issues: issues.map((issue) => ({ ...issue })) });
      throw new AppError(
        'INVALID_PAYLOAD',
        'Webhook payload failed validation',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues,
      );
    }
    return parsed.event;
  }

  /**
   * Idempotent insert. `INSERT … ON CONFLICT DO NOTHING` on
   * (provider_connection_id, external_event_id) makes concurrent duplicates safe:
   * a racing insert waits for the winner to commit, then inserts nothing and reads
   * the committed row. There is no check-then-insert window.
   */
  private persist(
    connection: ConnectionWithDefinition,
    event: AcceptedProviderEvent,
    payloadHash: string,
  ): Promise<PersistOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const receivedAt = this.clock.now();
      const [inserted] = await tx.incomingEvent.createManyAndReturn({
        data: [
          {
            workspaceId: connection.workspaceId,
            providerConnectionId: connection.id,
            externalEventId: event.externalEventId,
            eventType: event.eventType,
            payload: event.payload as Prisma.InputJsonObject,
            payloadHash,
            signatureValid: true,
            receivedAt,
          },
        ],
        skipDuplicates: true,
        select: { id: true },
      });

      if (inserted !== undefined) {
        await this.outbox.add(tx, {
          workspaceId: connection.workspaceId,
          topic: OutboxTopic.EVENT_PROCESSING_REQUESTED,
          aggregateId: inserted.id,
          availableAt: receivedAt,
        });
        return { kind: 'accepted', eventId: inserted.id };
      }

      const existing = await tx.incomingEvent.findUniqueOrThrow({
        where: {
          providerConnectionId_externalEventId: {
            providerConnectionId: connection.id,
            externalEventId: event.externalEventId,
          },
        },
        select: { id: true, payloadHash: true },
      });
      return existing.payloadHash === payloadHash
        ? { kind: 'duplicate', eventId: existing.id }
        : { kind: 'conflict', existingEventId: existing.id };
    });
  }
}

function ingressNotFound(): AppError {
  return new AppError(
    'INGRESS_NOT_FOUND',
    'No webhook ingress exists for this URL',
    HttpStatus.NOT_FOUND,
  );
}
