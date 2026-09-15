/**
 * The subset of the RelayForge HTTP API the dashboard reads. Responses are validated at
 * the boundary, so a contract drift surfaces as a clear error instead of a broken page.
 */
import { z } from 'zod';

const isoDate = z.iso.datetime({ offset: true });
const minorUnits = z.string().regex(/^-?\d+$/);

export const EVENT_STATUSES = ['RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'] as const;
export const DELIVERY_STATUSES = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'DEAD_LETTER'] as const;
export const TRANSACTION_STATUSES = [
  'SUCCEEDED',
  'FAILED',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
] as const;
export const JOURNAL_KINDS = ['PAYMENT_CAPTURED', 'PAYMENT_REFUNDED'] as const;
export const ATTEMPT_OUTCOMES = [
  'SUCCESS',
  'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE',
  'UNKNOWN',
] as const;
export const DEAD_LETTER_REASONS = [
  'MAX_ATTEMPTS_EXHAUSTED',
  'NON_RETRYABLE_RESPONSE',
  'ENDPOINT_UNAVAILABLE',
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];
export type JournalKind = (typeof JOURNAL_KINDS)[number];
export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({ data: z.array(item), nextCursor: z.uuid().nullable() });
}

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});

export const eventSummarySchema = z.object({
  id: z.uuid(),
  providerConnectionId: z.uuid(),
  externalEventId: z.string(),
  eventType: z.string(),
  status: z.enum(EVENT_STATUSES),
  payloadHash: z.string(),
  signatureValid: z.boolean(),
  processingAttempts: z.number().int(),
  failureReason: z.string().nullable(),
  receivedAt: isoDate,
  processedAt: isoDate.nullable(),
});
export const eventDetailSchema = eventSummarySchema.extend({ payload: z.unknown() });

export const deliverySummarySchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  endpointId: z.uuid(),
  replayOfDeliveryId: z.uuid().nullable(),
  status: z.enum(DELIVERY_STATUSES),
  attemptCount: z.number().int(),
  maxAttempts: z.number().int(),
  nextAttemptAt: isoDate.nullable(),
  deliveredAt: isoDate.nullable(),
  deadLetteredAt: isoDate.nullable(),
  deadLetterReason: z.enum(DEAD_LETTER_REASONS).nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export const deliveryAttemptSchema = z.object({
  attemptNumber: z.number().int(),
  outcome: z.enum(ATTEMPT_OUTCOMES),
  responseStatus: z.number().int().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  responseBody: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  startedAt: isoDate.nullable(),
  recordedAt: isoDate,
});
export const deliveryDetailSchema = deliverySummarySchema.extend({
  payload: z.unknown(),
  attempts: z.array(deliveryAttemptSchema),
});
export const replayAcceptedSchema = z.object({
  deliveryId: z.uuid(),
  replayOfDeliveryId: z.uuid(),
});

export const endpointSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  description: z.string().nullable(),
  eventTypes: z.array(z.string()),
  isActive: z.boolean(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export const createdEndpointSchema = endpointSchema.extend({ signingSecret: z.string() });

export const postingSchema = z.object({
  id: z.uuid(),
  accountCode: z.string(),
  direction: z.enum(['DEBIT', 'CREDIT']),
  amountMinor: minorUnits,
});
export const journalSchema = z.object({
  id: z.uuid(),
  transactionId: z.uuid(),
  sourceEventId: z.uuid(),
  kind: z.enum(JOURNAL_KINDS),
  externalReferenceId: z.string(),
  currency: z.string(),
  postings: z.array(postingSchema),
  createdAt: isoDate,
});
export const accountBalanceSchema = z.object({
  code: z.string(),
  type: z.enum(['ASSET', 'LIABILITY']),
  currency: z.string(),
  debitsMinor: minorUnits,
  creditsMinor: minorUnits,
  balanceMinor: minorUnits,
});

export const transactionSchema = z.object({
  id: z.uuid(),
  providerConnectionId: z.uuid(),
  externalPaymentId: z.string(),
  status: z.enum(TRANSACTION_STATUSES),
  currency: z.string(),
  amountMinor: minorUnits,
  refundedAmountMinor: minorUnits,
  createdByEventId: z.uuid(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
export const transactionDetailSchema = transactionSchema.extend({
  journals: z.array(journalSchema),
});

export const providerConnectionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  provider: z.object({ slug: z.string(), displayName: z.string(), adapterType: z.string() }),
  publicIngressKey: z.string(),
  ingressPath: z.string(),
  timestampToleranceSec: z.number().int().nullable(),
  enabled: z.boolean(),
  createdAt: isoDate,
});

export const metricsOverviewSchema = z.object({
  window: z.object({ from: isoDate, to: isoDate, hours: z.number().int() }),
  events: z.object({
    received: z.number().int(),
    processed: z.number().int(),
    failed: z.number().int(),
    ignored: z.number().int(),
  }),
  rejectedWebhooks: z.number().int(),
  deliveries: z.object({
    succeeded: z.number().int(),
    failedAttempts: z.number().int(),
    deadLetter: z.number().int(),
    inProgress: z.number().int(),
  }),
  deliveryLatencyMs: z.object({
    average: z.number().nullable(),
    p95: z.number().nullable(),
    sampleSize: z.number().int(),
  }),
});

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export type EventSummary = z.infer<typeof eventSummarySchema>;
export type EventDetail = z.infer<typeof eventDetailSchema>;
export type DeliverySummary = z.infer<typeof deliverySummarySchema>;
export type DeliveryAttempt = z.infer<typeof deliveryAttemptSchema>;
export type DeliveryDetail = z.infer<typeof deliveryDetailSchema>;
export type Endpoint = z.infer<typeof endpointSchema>;
export type CreatedEndpoint = z.infer<typeof createdEndpointSchema>;
export type Journal = z.infer<typeof journalSchema>;
export type AccountBalance = z.infer<typeof accountBalanceSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type TransactionDetail = z.infer<typeof transactionDetailSchema>;
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;
export type MetricsOverview = z.infer<typeof metricsOverviewSchema>;
