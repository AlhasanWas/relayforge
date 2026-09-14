import type { IncomingHttpHeaders } from 'node:http';
import {
  verifyWebhook,
  WEBHOOK_HEADERS,
  type WebhookVerificationFailureReason,
} from '@relayforge/shared/webhooks';
import type {
  SignatureFailureReason,
  SignatureVerificationInput,
  SignatureVerificationResult,
  WebhookSignatureVerifier,
} from './webhook-signature-verifier';

const FAILURE_REASONS: Record<WebhookVerificationFailureReason, SignatureFailureReason> = {
  MISSING_HEADERS: 'MISSING_SIGNATURE_HEADERS',
  MALFORMED_HEADERS: 'MALFORMED_SIGNATURE_HEADERS',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  TIMESTAMP_OUTSIDE_TOLERANCE: 'TIMESTAMP_OUTSIDE_TOLERANCE',
};

/** Verifies HMAC-SHA256 signatures in the Standard Webhooks format. */
export class StandardWebhooksVerifier implements WebhookSignatureVerifier {
  verify(input: SignatureVerificationInput): SignatureVerificationResult {
    const headers = {
      id: singleHeader(input.headers, WEBHOOK_HEADERS.id),
      timestamp: singleHeader(input.headers, WEBHOOK_HEADERS.timestamp),
      signature: singleHeader(input.headers, WEBHOOK_HEADERS.signature),
    };
    if (Object.values(headers).includes(null)) {
      // A repeated signature header is ambiguous; refuse to guess which one counts.
      return { valid: false, reason: 'MALFORMED_SIGNATURE_HEADERS' };
    }

    const result = verifyWebhook({
      secret: input.secret,
      headers: {
        id: headers.id ?? undefined,
        timestamp: headers.timestamp ?? undefined,
        signature: headers.signature ?? undefined,
      },
      body: input.rawBody,
      now: input.now,
      toleranceSeconds: input.toleranceSeconds,
    });

    return result.valid
      ? { valid: true, messageId: result.messageId }
      : { valid: false, reason: FAILURE_REASONS[result.reason] };
  }
}

/** The header value, undefined when absent, or null when it was sent more than once. */
function singleHeader(headers: IncomingHttpHeaders, name: string): string | undefined | null {
  const value = headers[name];
  return Array.isArray(value) ? null : value;
}
