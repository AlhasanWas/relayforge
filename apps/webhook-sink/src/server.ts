import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { decide, isSinkMode, SINK_MODES } from './sink-mode';
import type { ReceivedWebhook, SinkState } from './sink-state';

export interface SinkServerOptions {
  readonly state: SinkState;
  /** How long TIMEOUT mode holds a request open before dropping the connection. */
  readonly timeoutHoldMs: number;
  readonly random: () => number;
  readonly log: (entry: Record<string, unknown>) => void;
}

const MAX_BODY_BYTES = 1_048_576;

/**
 * Routes:
 * - `POST /webhooks[/*]`: receives a webhook and answers according to the mode.
 * - `GET /mode`, `PUT /mode` `{ "mode": "FAIL_500", "failureRate": 0.3 }`.
 * - `GET /received?limit=50`: most recent webhooks, newest first.
 * - `GET /health`.
 */
export function createSinkServer(options: SinkServerOptions): Server {
  return createServer((request, response) => {
    void route(request, response, options).catch((error: unknown) => {
      options.log({ level: 'error', msg: 'Request handling failed', error: String(error) });
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Internal error' });
      }
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  options: SinkServerOptions,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://sink');
  const { state } = options;

  if (request.method === 'POST' && /^\/webhooks(\/|$)/.test(url.pathname)) {
    await receiveWebhook(request, response, url.pathname, options);
    return;
  }
  if (url.pathname === '/mode' && request.method === 'GET') {
    sendJson(response, 200, {
      mode: state.mode,
      failureRate: state.failureRate,
      modes: SINK_MODES,
    });
    return;
  }
  if (url.pathname === '/mode' && request.method === 'PUT') {
    await updateMode(request, response, options);
    return;
  }
  if (url.pathname === '/received' && request.method === 'GET') {
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50) || 50, 1), 200);
    sendJson(response, 200, { data: state.received(limit) });
    return;
  }
  if (url.pathname === '/health' && request.method === 'GET') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  sendJson(response, 404, { error: 'Not found' });
}

async function receiveWebhook(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  options: SinkServerOptions,
): Promise<void> {
  const body = await readBody(request);
  const { state } = options;
  const webhookId = header(request, 'webhook-id');
  const decision = decide(state.mode, state.failureRate, options.random);
  const webhook: ReceivedWebhook = {
    receivedAt: new Date().toISOString(),
    path,
    webhookId,
    deliveryId: header(request, 'relayforge-delivery-id'),
    attempt: header(request, 'relayforge-attempt'),
    duplicate: state.remember(webhookId),
    bodyBytes: body.length,
    outcome: decision.kind === 'hang' ? 'TIMEOUT' : decision.status,
  };
  state.record(webhook);
  options.log({ level: 'info', msg: 'Webhook received', mode: state.mode, ...webhook });

  if (decision.kind === 'hang') {
    const timer = setTimeout(() => request.socket.destroy(), options.timeoutHoldMs);
    request.socket.once('close', () => {
      clearTimeout(timer);
    });
    return;
  }
  sendJson(response, decision.status, { received: true, duplicate: webhook.duplicate });
}

async function updateMode(
  request: IncomingMessage,
  response: ServerResponse,
  options: SinkServerOptions,
): Promise<void> {
  let input: unknown;
  try {
    input = JSON.parse((await readBody(request)).toString('utf8'));
  } catch {
    sendJson(response, 400, { error: 'Body must be JSON' });
    return;
  }
  const { mode, failureRate } = (
    typeof input === 'object' && input !== null ? input : {}
  ) as Record<string, unknown>;
  if (!isSinkMode(mode)) {
    sendJson(response, 400, { error: `mode must be one of ${SINK_MODES.join(', ')}` });
    return;
  }
  if (
    failureRate !== undefined &&
    (typeof failureRate !== 'number' || failureRate < 0 || failureRate > 1)
  ) {
    sendJson(response, 400, { error: 'failureRate must be a number between 0 and 1' });
    return;
  }
  options.state.mode = mode;
  if (typeof failureRate === 'number') {
    options.state.failureRate = failureRate;
  }
  options.log({ level: 'info', msg: 'Mode changed', mode, failureRate: options.state.failureRate });
  sendJson(response, 200, { mode, failureRate: options.state.failureRate });
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    request.on('error', reject);
  });
}

function header(request: IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  return typeof value === 'string' ? value : null;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}
