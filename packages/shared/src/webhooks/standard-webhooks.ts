/**
 * HMAC-SHA256 signing and verification following the Standard Webhooks
 * specification (https://www.standardwebhooks.com/).
 *
 * Signed content is `${webhook-id}.${webhook-timestamp}.${body}` and the
 * signature header is a space-delimited list of `v1,<base64>` entries, which
 * allows a sender to sign with several secrets during rotation.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_HEADERS = {
  id: 'webhook-id',
  timestamp: 'webhook-timestamp',
  signature: 'webhook-signature',
} as const;

const SECRET_PREFIX = 'whsec_';
const SIGNATURE_VERSION = 'v1';
const SIGNATURE_BYTES = 32;
const GENERATED_SECRET_BYTES = 32;
const MIN_SECRET_BYTES = 24;
const MAX_SECRET_BYTES = 64;
const MAX_MESSAGE_ID_LENGTH = 255;
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export class InvalidWebhookSecretError extends Error {
  constructor(reason: string) {
    super(`Invalid webhook secret: ${reason}`);
    this.name = 'InvalidWebhookSecretError';
  }
}

export function generateWebhookSecret(): string {
  return SECRET_PREFIX + randomBytes(GENERATED_SECRET_BYTES).toString('base64');
}

export function decodeWebhookSecret(secret: string): Buffer {
  if (!secret.startsWith(SECRET_PREFIX)) {
    throw new InvalidWebhookSecretError(`expected "${SECRET_PREFIX}" prefix`);
  }
  const encoded = secret.slice(SECRET_PREFIX.length);
  if (encoded.length === 0 || !BASE64_PATTERN.test(encoded)) {
    throw new InvalidWebhookSecretError('key is not valid base64');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length < MIN_SECRET_BYTES || key.length > MAX_SECRET_BYTES) {
    throw new InvalidWebhookSecretError(
      `key must be between ${MIN_SECRET_BYTES} and ${MAX_SECRET_BYTES} bytes`,
    );
  }
  return key;
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export interface SignWebhookInput {
  secret: string;
  messageId: string;
  /** Unix time in seconds. */
  timestamp: number;
  body: string | Uint8Array;
}

/** Returns a single `v1,<base64>` signature entry. */
export function signWebhook(input: SignWebhookInput): string {
  const key = decodeWebhookSecret(input.secret);
  const signature = computeSignature(key, input.messageId, input.timestamp, input.body);
  return `${SIGNATURE_VERSION},${signature.toString('base64')}`;
}

export type WebhookHeaders = Record<(typeof WEBHOOK_HEADERS)[keyof typeof WEBHOOK_HEADERS], string>;

export function createWebhookHeaders(input: SignWebhookInput): WebhookHeaders {
  return {
    [WEBHOOK_HEADERS.id]: input.messageId,
    [WEBHOOK_HEADERS.timestamp]: String(input.timestamp),
    [WEBHOOK_HEADERS.signature]: signWebhook(input),
  };
}

export type WebhookVerificationFailureReason =
  'MISSING_HEADERS' | 'MALFORMED_HEADERS' | 'INVALID_SIGNATURE' | 'TIMESTAMP_OUTSIDE_TOLERANCE';

export interface VerifyWebhookInput {
  secret: string;
  headers: {
    id: string | undefined;
    timestamp: string | undefined;
    signature: string | undefined;
  };
  body: string | Uint8Array;
  now: Date;
  /** Maximum allowed clock difference in seconds, or `null` to skip the check. */
  toleranceSeconds: number | null;
}

export type WebhookVerificationResult =
  | { valid: true; messageId: string; timestamp: number }
  | { valid: false; reason: WebhookVerificationFailureReason };

/**
 * Verifies a signed webhook. The signature is checked before the timestamp so
 * that a forged request is reported as `INVALID_SIGNATURE` and only an
 * authentic-but-stale request (a replay) is reported as outside tolerance.
 */
export function verifyWebhook(input: VerifyWebhookInput): WebhookVerificationResult {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: 'MISSING_HEADERS' };
  }
  if (id.length > MAX_MESSAGE_ID_LENGTH || !TIMESTAMP_PATTERN.test(timestamp)) {
    return { valid: false, reason: 'MALFORMED_HEADERS' };
  }

  const timestampSeconds = Number(timestamp);
  const key = decodeWebhookSecret(input.secret);
  const expected = computeSignature(key, id, timestampSeconds, input.body);

  if (!parseSignatures(signature).some((candidate) => timingSafeMatch(expected, candidate))) {
    return { valid: false, reason: 'INVALID_SIGNATURE' };
  }

  if (input.toleranceSeconds !== null) {
    const skew = Math.abs(toUnixSeconds(input.now) - timestampSeconds);
    if (skew > input.toleranceSeconds) {
      return { valid: false, reason: 'TIMESTAMP_OUTSIDE_TOLERANCE' };
    }
  }

  return { valid: true, messageId: id, timestamp: timestampSeconds };
}

function computeSignature(
  key: Buffer,
  messageId: string,
  timestamp: number,
  body: string | Uint8Array,
): Buffer {
  return createHmac('sha256', key).update(`${messageId}.${timestamp}.`).update(body).digest();
}

function parseSignatures(header: string): Buffer[] {
  const signatures: Buffer[] = [];
  for (const entry of header.trim().split(/\s+/)) {
    const separator = entry.indexOf(',');
    if (separator === -1 || entry.slice(0, separator) !== SIGNATURE_VERSION) {
      continue;
    }
    const encoded = entry.slice(separator + 1);
    if (BASE64_PATTERN.test(encoded)) {
      signatures.push(Buffer.from(encoded, 'base64'));
    }
  }
  return signatures;
}

function timingSafeMatch(expected: Buffer, candidate: Buffer): boolean {
  return candidate.length === SIGNATURE_BYTES && timingSafeEqual(expected, candidate);
}
