import { Injectable } from '@nestjs/common';
import { parseMockPayEvent, parseMockPayEventValue } from '@relayforge/shared/providers';
import { WEBHOOK_HEADERS } from '@relayforge/shared/webhooks';
import { ProviderAdapterType } from '../generated/prisma/client';
import type { NormalizedEvent } from './payment-event';
import type { ProviderAdapter, ProviderPayloadResult } from './provider-adapter';
import { StandardWebhooksVerifier } from './standard-webhooks.verifier';

@Injectable()
export class MockPayAdapter implements ProviderAdapter {
  readonly type = ProviderAdapterType.MOCKPAY;
  readonly verifier = new StandardWebhooksVerifier();
  readonly diagnosticHeaderNames = [WEBHOOK_HEADERS.id, WEBHOOK_HEADERS.timestamp] as const;

  parsePayload(rawBody: Buffer, signedMessageId: string | null): ProviderPayloadResult {
    const parsed = parseMockPayEvent(rawBody);
    if (!parsed.ok) {
      return { ok: false, issues: parsed.issues };
    }
    // The signature covers the webhook-id header, not a field inside the body, so
    // the two must agree or a signed request could claim a different event id.
    if (parsed.event.id !== signedMessageId) {
      return {
        ok: false,
        issues: [{ path: 'id', message: 'must equal the signed webhook-id header' }],
      };
    }
    return {
      ok: true,
      event: {
        externalEventId: parsed.event.id,
        eventType: parsed.event.type,
        payload: parsed.json,
      },
    };
  }

  normalizeEvent(payload: unknown): NormalizedEvent {
    const parsed = parseMockPayEventValue(payload);
    if (!parsed.ok) {
      return { kind: 'invalid', issues: parsed.issues };
    }
    const { event } = parsed;
    if (!event.known) {
      return { kind: 'unsupported' };
    }
    switch (event.type) {
      case 'payment.succeeded':
        return {
          kind: 'payment',
          event: {
            type: event.type,
            paymentId: event.data.payment_id,
            amountMinor: BigInt(event.data.amount),
            currency: event.data.currency,
          },
        };
      case 'payment.failed':
        return {
          kind: 'payment',
          event: {
            type: event.type,
            paymentId: event.data.payment_id,
            amountMinor: BigInt(event.data.amount),
            currency: event.data.currency,
            failureCode: event.data.failure_code,
          },
        };
      case 'payment.refunded':
        return {
          kind: 'payment',
          event: {
            type: event.type,
            paymentId: event.data.payment_id,
            refundId: event.data.refund_id,
            amountMinor: BigInt(event.data.amount),
            currency: event.data.currency,
          },
        };
    }
  }
}
