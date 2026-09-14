import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../database/prisma.service';
import type { Prisma, RejectionReason } from '../generated/prisma/client';
import { type IncomingWebhook, sha256Hex } from './incoming-webhook';

export interface RejectionContext {
  readonly workspaceId: string;
  readonly providerConnectionId: string;
  readonly webhook: IncomingWebhook;
  readonly metadata: Prisma.InputJsonObject;
}

/**
 * Persists rejected webhook requests as immutable security records.
 *
 * Rejections are recorded outside any business transaction and never participate
 * in event idempotency: a forged request cannot reserve an external event id.
 */
@Injectable()
export class RejectedAttemptRecorder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RejectedAttemptRecorder.name);
  }

  async record(context: RejectionContext, reason: RejectionReason): Promise<void> {
    const logFields = {
      workspaceId: context.workspaceId,
      providerConnectionId: context.providerConnectionId,
      reason,
    };
    this.logger.warn(logFields, 'Webhook rejected');

    try {
      await this.prisma.rejectedWebhookAttempt.create({
        data: {
          workspaceId: context.workspaceId,
          providerConnectionId: context.providerConnectionId,
          reason,
          payloadHash: sha256Hex(context.webhook.rawBody),
          bodyBytes: context.webhook.rawBody.length,
          requestId: context.webhook.requestId ?? 'unknown',
          sourceIp: context.webhook.sourceIp,
          metadata: context.metadata,
        },
      });
    } catch (error: unknown) {
      // The request is rejected either way; losing the security record must be
      // visible to operators but must not turn a 4xx into a 500.
      this.logger.error({ ...logFields, err: error }, 'Failed to record rejected webhook attempt');
    }
  }
}
