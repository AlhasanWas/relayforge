import { Injectable } from '@nestjs/common';
import type { OutboxTopic, Prisma } from '../generated/prisma/client';

export interface OutboxMessageInput {
  readonly workspaceId: string;
  readonly topic: OutboxTopic;
  /** Id of the row the consumer will act on (incoming event or delivery). */
  readonly aggregateId: string;
  /** Earliest time the message may be published; used for scheduled retries. */
  readonly availableAt: Date;
}

/**
 * Writes outbox messages. There is deliberately no method that takes the root
 * client: an outbox message must be written in the same transaction as the state
 * change that requires the work, or the handoff guarantee is lost.
 */
@Injectable()
export class OutboxWriter {
  async add(tx: Prisma.TransactionClient, message: OutboxMessageInput): Promise<void> {
    await tx.outboxMessage.create({ data: message });
  }
}
