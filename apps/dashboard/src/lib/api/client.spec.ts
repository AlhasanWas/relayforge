import { z } from 'zod';
import { ApiError, ApiUnavailableError, createApiClient } from './client';

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(respond: () => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(respond());
  };
  return { requests, fetch: fetchImpl };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const itemSchema = z.object({ id: z.string() });

function clientWith(respond: () => Response | Promise<Response>) {
  const fake = fakeFetch(respond);
  const client = createApiClient({
    baseUrl: 'http://api.test:3000/',
    apiKey: 'rf_0123456789abcdef_secret',
    timeoutMs: 1_000,
    fetch: fake.fetch,
  });
  return { client, requests: fake.requests };
}

describe('createApiClient', () => {
  it('authenticates, drops empty query values and validates the response', async () => {
    const { client, requests } = clientWith(() => json(200, { id: 'evt_1' }));

    await expect(
      client.get('/v1/events', itemSchema, { status: 'FAILED', cursor: undefined, limit: 25 }),
    ).resolves.toEqual({ id: 'evt_1' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://api.test:3000/v1/events?status=FAILED&limit=25');
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: 'Bearer rf_0123456789abcdef_secret',
    });
    expect(requests[0]?.init?.cache).toBe('no-store');
  });

  it('sends JSON bodies for mutations', async () => {
    const { client, requests } = clientWith(() => json(200, { id: 'ep_1' }));

    await client.send('PATCH', '/v1/endpoints/ep_1', itemSchema, { isActive: false });

    expect(requests[0]?.init).toMatchObject({
      method: 'PATCH',
      body: '{"isActive":false}',
      headers: { 'content-type': 'application/json' },
    });
  });

  it('turns the error envelope into an ApiError', async () => {
    const { client } = clientWith(() =>
      json(409, {
        error: { code: 'CONFLICT', message: 'Already replayed', requestId: 'req-1' },
      }),
    );

    const failure = client.send('POST', '/v1/deliveries/d/replay', itemSchema);

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'Already replayed',
      requestId: 'req-1',
    });
  });

  it('reports an error without an envelope as the API being unavailable', async () => {
    const { client } = clientWith(() => new Response('Bad Gateway', { status: 502 }));

    await expect(client.get('/v1/events', itemSchema)).rejects.toBeInstanceOf(ApiUnavailableError);
  });

  it('reports network failures as the API being unavailable', async () => {
    const { client } = clientWith(() => Promise.reject(new TypeError('fetch failed')));

    await expect(client.get('/v1/events', itemSchema)).rejects.toThrow(
      'The RelayForge API at http://api.test:3000 could not be reached',
    );
  });

  it('rejects a response that does not match the contract', async () => {
    const { client } = clientWith(() => json(200, { id: 42 }));

    await expect(client.get('/v1/events', itemSchema)).rejects.toThrow(
      'Unexpected response from GET /v1/events',
    );
  });
});
