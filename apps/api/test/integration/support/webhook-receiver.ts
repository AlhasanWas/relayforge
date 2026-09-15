/** A local HTTP server standing in for a customer webhook endpoint, with scripted responses. */
import {
  createServer,
  type IncomingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  body: string;
}

export type ReceiverBehavior =
  | { kind: 'respond'; status: number; headers?: Record<string, string>; body?: string }
  /** Never answers; the client times out. */
  | { kind: 'hang' }
  /** Holds the request until `release()` is called, then answers with `status`. */
  | { kind: 'hold'; status: number };

export class WebhookReceiver {
  readonly received: ReceivedWebhook[] = [];
  private readonly script: ReceiverBehavior[] = [];
  private readonly held: { response: ServerResponse; status: number }[] = [];
  private readonly waiters: (() => void)[] = [];

  private constructor(private readonly server: Server) {}

  static async start(): Promise<WebhookReceiver> {
    const server = createServer();
    const receiver = new WebhookReceiver(server);
    server.on('request', (request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receiver.handle(
          { headers: request.headers, body: Buffer.concat(chunks).toString('utf8') },
          response,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return receiver;
  }

  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/webhooks`;
  }

  /** Queues behaviours for the next requests; afterwards the receiver answers 200. */
  respondWith(...behaviors: ReceiverBehavior[]): void {
    this.script.push(...behaviors);
  }

  /** Resolves once `count` requests in total have been received. */
  async waitForRequests(count: number): Promise<void> {
    while (this.received.length < count) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  release(): void {
    for (const { response, status } of this.held.splice(0)) {
      response.writeHead(status).end();
    }
  }

  reset(): void {
    this.release();
    this.received.length = 0;
    this.script.length = 0;
  }

  async close(): Promise<void> {
    this.reset();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => {
      this.server.close(() => {
        resolve();
      });
    });
  }

  private handle(webhook: ReceivedWebhook, response: ServerResponse): void {
    this.received.push(webhook);
    for (const wake of this.waiters.splice(0)) wake();

    const behavior = this.script.shift() ?? { kind: 'respond', status: 200 };
    switch (behavior.kind) {
      case 'respond':
        response.writeHead(behavior.status, behavior.headers).end(behavior.body ?? '');
        return;
      case 'hang':
        return;
      case 'hold':
        this.held.push({ response, status: behavior.status });
        return;
    }
  }
}
