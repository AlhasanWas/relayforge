/** Shared helpers for the MockPay demo scripts. They talk to RelayForge only over HTTP. */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWebhookHeaders, toUnixSeconds } from '@relayforge/shared/webhooks';

export interface DemoConfig {
  readonly apiUrl: string;
  readonly sinkUrl: string;
  readonly ingressKey: string;
  readonly signingSecret: string;
  readonly adminApiKey: string;
}

export function loadDemoConfig(): DemoConfig {
  const envFile = resolve(__dirname, '..', '..', '.env');
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const required = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is not set. Copy .env.example to .env first.`);
    }
    return value;
  };
  return {
    apiUrl: (process.env.RELAYFORGE_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    sinkUrl: (process.env.WEBHOOK_SINK_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
    ingressKey: required('DEMO_MOCKPAY_INGRESS_KEY'),
    signingSecret: required('DEMO_MOCKPAY_SIGNING_SECRET'),
    adminApiKey: required('SEED_ADMIN_API_KEY'),
  };
}

export interface MockPayPayment {
  id: string;
  type: 'payment.succeeded';
  created_at: string;
  data: { payment_id: string; amount: number; currency: string; customer_id: string };
}

export function paymentSucceeded(amountMinor: number): MockPayPayment {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  return {
    id: `evt_${suffix}`,
    type: 'payment.succeeded',
    created_at: new Date().toISOString(),
    data: {
      payment_id: `pay_${suffix}`,
      amount: amountMinor,
      currency: 'USD',
      customer_id: 'cus_demo',
    },
  };
}

export interface SignedWebhook {
  readonly body: string;
  readonly headers: Record<string, string>;
}

/** Signs the exact bytes that will be sent, as a real provider does. */
export function signAsMockPay(config: DemoConfig, event: MockPayPayment): SignedWebhook {
  const body = JSON.stringify(event);
  return {
    body,
    headers: {
      'content-type': 'application/json',
      ...createWebhookHeaders({
        secret: config.signingSecret,
        messageId: event.id,
        timestamp: toUnixSeconds(new Date()),
        body,
      }),
    },
  };
}

export async function postWebhook(
  config: DemoConfig,
  webhook: SignedWebhook,
): Promise<{ status: number; body: unknown }> {
  const response = await request(`${config.apiUrl}/v1/webhooks/${config.ingressKey}`, {
    method: 'POST',
    headers: webhook.headers,
    body: webhook.body,
  });
  return { status: response.status, body: await response.json() };
}

export async function getJson<T>(config: DemoConfig, path: string): Promise<T> {
  const response = await request(`${config.apiUrl}${path}`, {
    headers: { authorization: `Bearer ${config.adminApiKey}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${path} failed with ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error: unknown) {
    throw new Error(
      `Could not reach ${new URL(url).origin}. Is the stack running (docker compose up)? ${String(error)}`,
      { cause: error },
    );
  }
}

/** Polls until `probe` returns a value, or gives up after `timeoutMs`. */
export async function waitFor<T>(
  probe: () => Promise<T | undefined>,
  timeoutMs = 30_000,
  intervalMs = 250,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, intervalMs));
  }
  return undefined;
}

export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

/** Runs a demo and reports failures with a non-zero exit code. */
export function runDemo(demo: () => Promise<void>): void {
  demo().catch((error: unknown) => {
    process.stderr.write(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export interface EventSummary {
  id: string;
  status: string;
  externalEventId: string;
  failureReason: string | null;
}

export interface TransactionDetail {
  id: string;
  status: string;
  amountMinor: string;
  currency: string;
  journals: {
    kind: string;
    postings: { accountCode: string; direction: string; amountMinor: string }[];
  }[];
}

export interface DeliverySummary {
  id: string;
  status: string;
  attemptCount: number;
  deadLetterReason: string | null;
}

export interface Page<T> {
  data: T[];
}
