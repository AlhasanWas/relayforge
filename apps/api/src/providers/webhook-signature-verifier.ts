import type { IncomingHttpHeaders } from 'node:http';

/** Why a signature check failed. These values are also `RejectionReason` values. */
export type SignatureFailureReason =
  | 'MISSING_SIGNATURE_HEADERS'
  | 'MALFORMED_SIGNATURE_HEADERS'
  | 'INVALID_SIGNATURE'
  | 'TIMESTAMP_OUTSIDE_TOLERANCE';

export interface SignatureVerificationInput {
  /** The exact bytes received. Signatures are never computed over re-serialised JSON. */
  readonly rawBody: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly secret: string;
  readonly now: Date;
  /** Maximum clock skew in seconds, or null when the connection disables the check. */
  readonly toleranceSeconds: number | null;
}

export type SignatureVerificationResult =
  | {
      readonly valid: true;
      /** Message id bound into the signature, when the scheme has one. */
      readonly messageId: string | null;
    }
  | { readonly valid: false; readonly reason: SignatureFailureReason };

/**
 * Extension point for provider signature schemes. Providers sign webhooks in
 * different ways (Standard Webhooks, `t=…,v1=…` headers, and so on); each scheme
 * is one implementation. The ingestion pipeline depends only on this interface.
 */
export interface WebhookSignatureVerifier {
  verify(input: SignatureVerificationInput): SignatureVerificationResult;
}
