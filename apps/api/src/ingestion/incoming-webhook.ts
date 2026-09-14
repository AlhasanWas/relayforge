import { createHash } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { Prisma } from '../generated/prisma/client';

/** Transport-independent description of a received webhook request. */
export interface IncomingWebhook {
  readonly ingressKey: string;
  readonly rawBody: Buffer;
  readonly headers: IncomingHttpHeaders;
  readonly requestId: string | null;
  readonly sourceIp: string | null;
}

const MAX_HEADER_CHARS = 256;

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isJsonContentType(contentType: string | undefined): boolean {
  const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

/**
 * Request details kept on a rejected attempt: selected headers (truncated) and
 * extra context. Signature headers, credentials and the body are never included.
 */
export function rejectionMetadata(
  webhook: IncomingWebhook,
  diagnosticHeaderNames: readonly string[],
  extra: Prisma.InputJsonObject = {},
): Prisma.InputJsonObject {
  const headers: Record<string, string> = {};
  for (const name of [...diagnosticHeaderNames, 'content-type', 'user-agent']) {
    const value = webhook.headers[name];
    if (typeof value === 'string') {
      headers[name] = value.slice(0, MAX_HEADER_CHARS);
    }
  }
  return { headers, bodyBytes: webhook.rawBody.length, ...extra };
}
