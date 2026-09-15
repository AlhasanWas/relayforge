import type { PayloadIssue } from '@relayforge/shared/providers';

/**
 * Provider-neutral payment facts. Processing and the ledger depend only on these,
 * never on a provider's payload format. Amounts are integer minor units.
 */
export type PaymentEvent =
  | {
      readonly type: 'payment.succeeded';
      readonly paymentId: string;
      readonly amountMinor: bigint;
      readonly currency: string;
    }
  | {
      readonly type: 'payment.failed';
      readonly paymentId: string;
      readonly amountMinor: bigint;
      readonly currency: string;
      readonly failureCode: string;
    }
  | {
      readonly type: 'payment.refunded';
      readonly paymentId: string;
      readonly refundId: string;
      readonly amountMinor: bigint;
      readonly currency: string;
    };

/** What a stored provider payload means to RelayForge. */
export type NormalizedEvent =
  | { readonly kind: 'payment'; readonly event: PaymentEvent }
  /** Authentic and well-formed, but not an event type RelayForge acts on. */
  | { readonly kind: 'unsupported' }
  /** The stored payload no longer matches the provider schema. */
  | { readonly kind: 'invalid'; readonly issues: PayloadIssue[] };
