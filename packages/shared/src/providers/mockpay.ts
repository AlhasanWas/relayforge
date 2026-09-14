/**
 * MockPay: the simulated payment provider used by the demo and tests.
 *
 * MockPay signs deliveries with the Standard Webhooks scheme. Its `webhook-id`
 * header equals the event `id`. Amounts are positive integers in minor units.
 */
import { z } from 'zod';

export const MOCKPAY_EVENT_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
] as const;

export type MockPayEventType = (typeof MOCKPAY_EVENT_TYPES)[number];

const identifier = z.string().min(1).max(255);
// zod's int() also rejects values outside the safe integer range, where JSON numbers
// silently lose precision.
const amountMinor = z.number().int().positive();
const currency = z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as "USD"');

const envelopeSchema = z.object({
  id: identifier,
  type: z.string().min(1).max(100),
  created_at: z.iso.datetime({ offset: true }),
  data: z.record(z.string(), z.unknown()),
});

const paymentSucceededData = z.object({
  payment_id: identifier,
  amount: amountMinor,
  currency,
  customer_id: identifier.optional(),
});

const paymentFailedData = z.object({
  payment_id: identifier,
  amount: amountMinor,
  currency,
  failure_code: z.string().min(1).max(100),
});

const paymentRefundedData = z.object({
  refund_id: identifier,
  payment_id: identifier,
  amount: amountMinor,
  currency,
});

const dataSchemas = {
  'payment.succeeded': paymentSucceededData,
  'payment.failed': paymentFailedData,
  'payment.refunded': paymentRefundedData,
} satisfies Record<MockPayEventType, z.ZodType>;

interface EventBase {
  id: string;
  createdAt: string;
}

export type MockPayEvent =
  | (EventBase & { type: 'payment.succeeded'; data: z.infer<typeof paymentSucceededData> })
  | (EventBase & { type: 'payment.failed'; data: z.infer<typeof paymentFailedData> })
  | (EventBase & { type: 'payment.refunded'; data: z.infer<typeof paymentRefundedData> })
  /** A well-formed event of a type RelayForge does not process. */
  | (EventBase & { type: string & {}; data: Record<string, unknown>; known: false });

export interface PayloadIssue {
  /** Dotted path to the offending field, e.g. `data.amount`. Never contains values. */
  path: string;
  message: string;
}

export type MockPayParseResult =
  | { ok: true; event: MockPayEvent; json: Record<string, unknown> }
  | { ok: false; issues: PayloadIssue[] };

export function isKnownMockPayEventType(type: string): type is MockPayEventType {
  return (MOCKPAY_EVENT_TYPES as readonly string[]).includes(type);
}

/** Parses a raw MockPay request body: JSON syntax, envelope, then type-specific data. */
export function parseMockPayEvent(rawBody: string | Uint8Array): MockPayParseResult {
  let json: unknown;
  try {
    json = JSON.parse(
      typeof rawBody === 'string' ? rawBody : Buffer.from(rawBody).toString('utf8'),
    );
  } catch {
    return { ok: false, issues: [{ path: '', message: 'Body is not valid JSON' }] };
  }

  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    return { ok: false, issues: toIssues(envelope.error) };
  }
  const { id, type, created_at: createdAt, data } = envelope.data;
  const body = json as Record<string, unknown>;

  if (!isKnownMockPayEventType(type)) {
    return { ok: true, json: body, event: { id, type, createdAt, data, known: false } };
  }

  const parsedData = dataSchemas[type].safeParse(data);
  if (!parsedData.success) {
    return { ok: false, issues: toIssues(parsedData.error, 'data') };
  }
  return {
    ok: true,
    json: body,
    event: { id, type, createdAt, data: parsedData.data } as MockPayEvent,
  };
}

function toIssues(error: z.ZodError, prefix?: string): PayloadIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].filter((part) => part !== undefined).join('.'),
    message: issue.message,
  }));
}
