import type { PayloadIssue } from '@relayforge/shared/providers';
import type { ProviderAdapterType } from '../generated/prisma/client';
import type { NormalizedEvent } from './payment-event';
import type { WebhookSignatureVerifier } from './webhook-signature-verifier';

/** Provider-neutral view of an authenticated, schema-valid webhook. */
export interface AcceptedProviderEvent {
  readonly externalEventId: string;
  readonly eventType: string;
  /** The parsed request body, stored verbatim (as JSONB) on the incoming event. */
  readonly payload: Record<string, unknown>;
}

export type ProviderPayloadResult =
  | { readonly ok: true; readonly event: AcceptedProviderEvent }
  | { readonly ok: false; readonly issues: PayloadIssue[] };

/**
 * Everything provider-specific about receiving a webhook: how it is signed, how
 * its body is validated, and which headers are safe to keep for diagnostics.
 */
export interface ProviderAdapter {
  readonly type: ProviderAdapterType;
  readonly verifier: WebhookSignatureVerifier;
  /**
   * Request headers recorded on rejected attempts to help debugging. Must never
   * include signatures or credentials.
   */
  readonly diagnosticHeaderNames: readonly string[];
  /** Validates an authenticated body. Only called after signature verification passed. */
  parsePayload(rawBody: Buffer, signedMessageId: string | null): ProviderPayloadResult;
  /** Maps a stored payload to provider-neutral facts for processing. */
  normalizeEvent(payload: unknown): NormalizedEvent;
}
