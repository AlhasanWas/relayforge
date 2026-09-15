import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSinkServer } from './server';
import { SinkState } from './sink-state';

describe('webhook sink server', () => {
  let server: Server;
  let state: SinkState;
  let baseUrl: string;

  beforeEach(async () => {
    state = new SinkState('SUCCESS', 0.5);
    server = createSinkServer({
      state,
      timeoutHoldMs: 200,
      random: () => 0.1,
      log: () => undefined,
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });

  const deliver = (webhookId: string) =>
    fetch(`${baseUrl}/webhooks/relayforge`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': webhookId,
        'relayforge-attempt': '1',
      },
      body: '{"id":"evt_1"}',
    });

  it('accepts webhooks and flags repeated webhook ids as duplicates', async () => {
    expect((await deliver('evt_1')).status).toBe(200);
    expect(await (await deliver('evt_1')).json()).toEqual({ received: true, duplicate: true });

    const received = (await (await fetch(`${baseUrl}/received`)).json()) as {
      data: { webhookId: string; duplicate: boolean; outcome: number }[];
    };
    expect(received.data.map((w) => [w.webhookId, w.duplicate, w.outcome])).toEqual([
      ['evt_1', true, 200],
      ['evt_1', false, 200],
    ]);
  });

  it('switches mode at runtime', async () => {
    const update = await fetch(`${baseUrl}/mode`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'FAIL_500' }),
    });

    expect(await update.json()).toEqual({ mode: 'FAIL_500', failureRate: 0.5 });
    expect((await deliver('evt_2')).status).toBe(500);
  });

  it('rejects unknown modes and invalid failure rates', async () => {
    const put = (body: unknown) =>
      fetch(`${baseUrl}/mode`, { method: 'PUT', body: JSON.stringify(body) });

    expect((await put({ mode: 'EXPLODE' })).status).toBe(400);
    expect((await put({ mode: 'RANDOM_FAILURE', failureRate: 2 })).status).toBe(400);
    expect(state.mode).toBe('SUCCESS');
  });

  it('holds the request open in TIMEOUT mode, then drops the connection', async () => {
    state.mode = 'TIMEOUT';

    await expect(deliver('evt_3')).rejects.toThrow();
    expect(state.received(1)[0]).toMatchObject({ webhookId: 'evt_3', outcome: 'TIMEOUT' });
  });
});
