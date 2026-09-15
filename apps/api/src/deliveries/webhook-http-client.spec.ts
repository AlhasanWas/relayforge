import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { sendWebhook } from './webhook-http-client';

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

describe('sendWebhook', () => {
  let server: Server;
  let handler: Handler;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        handler(request, response, Buffer.concat(chunks).toString('utf8'));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const options = { timeoutMs: 1_000, maxResponseBytes: 16, allowPrivateDestinations: true };
  const webhook = (path = '/hook') => ({
    url: `${baseUrl}${path}`,
    headers: { 'content-type': 'application/json', 'webhook-id': 'evt_1' },
    body: '{"hello":"world"}',
  });

  it('POSTs the body and headers and reports the status and a truncated body', async () => {
    let seen: { method?: string; body?: string; id?: string } = {};
    handler = (request, response, body) => {
      seen = { method: request.method, body, id: request.headers['webhook-id'] as string };
      response.writeHead(200).end('a response body longer than sixteen bytes');
    };

    const result = await sendWebhook(webhook(), options);

    expect(seen).toEqual({ method: 'POST', body: '{"hello":"world"}', id: 'evt_1' });
    expect(result).toEqual({
      kind: 'response',
      status: 200,
      retryAfter: null,
      body: 'a response body ',
    });
  });

  it('reports Retry-After headers', async () => {
    handler = (_request, response) => {
      response.writeHead(429, { 'retry-after': '120' }).end();
    };

    expect(await sendWebhook(webhook(), options)).toMatchObject({ status: 429, retryAfter: '120' });
  });

  it('does not follow redirects', async () => {
    handler = (_request, response) => {
      response.writeHead(307, { location: 'http://169.254.169.254/latest/meta-data' }).end();
    };

    expect(await sendWebhook(webhook(), options)).toMatchObject({ kind: 'response', status: 307 });
  });

  it('reports a timeout when the receiver never answers', async () => {
    handler = () => {
      // Never respond.
    };

    expect(await sendWebhook(webhook(), { ...options, timeoutMs: 100 })).toEqual({
      kind: 'timeout',
    });
  });

  it('reports a status received before the body stalls as a response, not a timeout', async () => {
    handler = (_request, response) => {
      response.writeHead(200);
      response.write('partial');
      // The body never completes.
    };

    expect(
      await sendWebhook(webhook(), { ...options, timeoutMs: 200, maxResponseBytes: 1024 }),
    ).toEqual({
      kind: 'response',
      status: 200,
      retryAfter: null,
      body: 'partial',
    });
  });

  it('reports connection failures as network errors', async () => {
    const result = await sendWebhook({ ...webhook(), url: 'http://127.0.0.1:1/hook' }, options);

    expect(result).toMatchObject({ kind: 'network-error', code: 'ECONNREFUSED' });
  });

  it('blocks private destinations when protection is enabled, for IP literals and resolved hostnames', async () => {
    const protectedOptions = { ...options, allowPrivateDestinations: false };

    expect(await sendWebhook(webhook(), protectedOptions)).toMatchObject({
      kind: 'blocked-destination',
    });
    expect(
      await sendWebhook(
        { ...webhook(), url: webhook().url.replace('127.0.0.1', 'localhost') },
        protectedOptions,
      ),
    ).toMatchObject({ kind: 'blocked-destination' });
    expect(
      await sendWebhook({ ...webhook(), url: 'http://[::1]:8080/hook' }, protectedOptions),
    ).toMatchObject({ kind: 'blocked-destination' });
  });
});
