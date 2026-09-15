import type { IncomingEvent, Prisma, Transaction } from '../generated/prisma/client';

/**
 * The body RelayForge sends to customer endpoints: provider-neutral, and
 * snapshotted on the delivery row when the event is processed, so every retry and
 * replay sends identical bytes. Amounts are strings to avoid float precision loss.
 */
export function buildDeliveryPayload(
  event: Pick<IncomingEvent, 'id' | 'eventType' | 'receivedAt'>,
  transaction: Transaction,
): Prisma.InputJsonObject {
  return {
    id: event.id,
    type: event.eventType,
    created_at: event.receivedAt.toISOString(),
    data: {
      transaction: {
        id: transaction.id,
        provider_payment_id: transaction.externalPaymentId,
        status: transaction.status,
        currency: transaction.currency,
        amount_minor: transaction.amountMinor.toString(),
        refunded_amount_minor: transaction.refundedAmountMinor.toString(),
      },
    },
  };
}
