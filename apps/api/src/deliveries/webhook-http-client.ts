import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import type { DeliveryResult } from './delivery-retry-policy';
import { BlockedDestinationError, guardedLookup, isBlockedAddress } from './destination-guard';

export interface OutboundWebhook {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface WebhookHttpClientOptions {
  readonly timeoutMs: number;
  /** Response body bytes kept for diagnostics; the rest is discarded. */
  readonly maxResponseBytes: number;
  /** Disables SSRF protection. Only for local development against a private sink. */
  readonly allowPrivateDestinations: boolean;
}

/**
 * Sends one webhook POST and describes what happened. Never throws: every outcome,
 * including network failures, is returned as a `DeliveryResult` for the retry policy.
 *
 * Redirects are not followed. A hard timeout covers connecting, sending and
 * receiving response headers; once the status is known it is reported even if the
 * body is slow or truncated, so a 2xx is never misreported as a timeout.
 */
export function sendWebhook(
  webhook: OutboundWebhook,
  options: WebhookHttpClientOptions,
): Promise<DeliveryResult> {
  let url: URL;
  try {
    url = new URL(webhook.url);
  } catch {
    return Promise.resolve({
      kind: 'network-error',
      code: 'INVALID_URL',
      message: 'Invalid endpoint URL',
    });
  }

  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !options.allowPrivateDestinations &&
    isIP(literalHost) !== 0 &&
    isBlockedAddress(literalHost)
  ) {
    // IP literals are connected to directly without a DNS lookup, so check them here.
    return Promise.resolve({
      kind: 'blocked-destination',
      message: new BlockedDestinationError(literalHost).message,
    });
  }

  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const signal = AbortSignal.timeout(options.timeoutMs);

  return new Promise<DeliveryResult>((resolve) => {
    let settled = false;
    const settle = (result: DeliveryResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    let finishResponse: (() => void) | undefined;

    const req = send(
      url,
      {
        method: 'POST',
        headers: { ...webhook.headers, 'content-length': Buffer.byteLength(webhook.body) },
        signal,
        ...(options.allowPrivateDestinations ? {} : { lookup: guardedLookup }),
      },
      (response) => {
        finishResponse = collectResponse(response, options.maxResponseBytes, settle);
      },
    );

    req.on('error', (error: NodeJS.ErrnoException) => {
      if (finishResponse !== undefined) {
        // The status line already arrived; a later abort must not turn it into a timeout.
        finishResponse();
        return;
      }
      settle(describeError(error, signal));
    });
    req.end(webhook.body);
  });
}

/** Collects the response and returns a function that reports what has been received so far. */
function collectResponse(
  response: IncomingMessage,
  maxBytes: number,
  settle: (result: DeliveryResult) => void,
): () => void {
  const chunks: Buffer[] = [];
  let received = 0;
  const finish = () => {
    const retryAfter = response.headers['retry-after'];
    settle({
      kind: 'response',
      status: response.statusCode ?? 0,
      retryAfter: typeof retryAfter === 'string' ? retryAfter : null,
      body: Buffer.concat(chunks).toString('utf8'),
    });
  };

  response.on('data', (chunk: Buffer) => {
    if (received < maxBytes) {
      chunks.push(chunk.subarray(0, maxBytes - received));
    }
    received += chunk.length;
    if (received >= maxBytes) {
      // Enough for diagnostics; stop downloading.
      response.destroy();
      finish();
    }
  });
  response.on('end', finish);
  // Aborts or resets after the status line still count as a response.
  response.on('error', finish);
  response.on('close', finish);
  return finish;
}

function describeError(error: NodeJS.ErrnoException, signal: AbortSignal): DeliveryResult {
  if (signal.aborted) {
    return { kind: 'timeout' };
  }
  if (error instanceof BlockedDestinationError) {
    return { kind: 'blocked-destination', message: error.message };
  }
  return {
    kind: 'network-error',
    code: error.code ?? error.name,
    message: error.message.slice(0, 500),
  };
}
