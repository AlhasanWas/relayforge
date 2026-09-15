import 'server-only';
import { z } from 'zod';
import {
  accountBalanceSchema,
  createdEndpointSchema,
  type DeliveryStatus,
  deliveryDetailSchema,
  deliverySummarySchema,
  endpointSchema,
  type EventStatus,
  eventDetailSchema,
  eventSummarySchema,
  type JournalKind,
  journalSchema,
  metricsOverviewSchema,
  pageOf,
  providerConnectionSchema,
  replayAcceptedSchema,
  type TransactionStatus,
  transactionDetailSchema,
  transactionSchema,
} from './schemas';
import { api } from './server';

export interface PageQuery {
  readonly cursor?: string;
  readonly limit?: number;
}

export const DEFAULT_PAGE_LIMIT = 25;

const page = (query: PageQuery) => ({
  cursor: query.cursor,
  limit: query.limit ?? DEFAULT_PAGE_LIMIT,
});

export const getMetricsOverview = (windowHours: number) =>
  api().get('/v1/metrics/overview', metricsOverviewSchema, { windowHours });

export const listProviderConnections = () =>
  api().get('/v1/provider-connections', pageOf(providerConnectionSchema), { limit: 100 });

export const listEvents = (query: PageQuery & { status?: EventStatus }) =>
  api().get('/v1/events', pageOf(eventSummarySchema), { ...page(query), status: query.status });

export const getEvent = (id: string) => api().get(`/v1/events/${id}`, eventDetailSchema);

export const listDeliveries = (
  query: PageQuery & { status?: DeliveryStatus; eventId?: string; endpointId?: string },
) =>
  api().get('/v1/deliveries', pageOf(deliverySummarySchema), {
    ...page(query),
    status: query.status,
    eventId: query.eventId,
    endpointId: query.endpointId,
  });

export const getDelivery = (id: string) => api().get(`/v1/deliveries/${id}`, deliveryDetailSchema);

export const replayDelivery = (id: string) =>
  api().send('POST', `/v1/deliveries/${id}/replay`, replayAcceptedSchema);

export const listEndpoints = () =>
  api().get('/v1/endpoints', pageOf(endpointSchema), { limit: 100 });

export const createEndpoint = (input: {
  url: string;
  description?: string;
  eventTypes: string[];
}) => api().send('POST', '/v1/endpoints', createdEndpointSchema, input);

export const setEndpointActive = (id: string, isActive: boolean) =>
  api().send('PATCH', `/v1/endpoints/${id}`, endpointSchema, { isActive });

export const listTransactions = (query: PageQuery & { status?: TransactionStatus }) =>
  api().get('/v1/transactions', pageOf(transactionSchema), {
    ...page(query),
    status: query.status,
  });

export const getTransaction = (id: string) =>
  api().get(`/v1/transactions/${id}`, transactionDetailSchema);

export const listJournals = (query: PageQuery & { kind?: JournalKind }) =>
  api().get('/v1/ledger', pageOf(journalSchema), { ...page(query), kind: query.kind });

export const getAccountBalances = () =>
  api().get('/v1/ledger/balances', z.array(accountBalanceSchema));

/** Endpoint URLs by id, for labelling deliveries; ids not listed are shown by their id. */
export async function getEndpointUrls(): Promise<ReadonlyMap<string, string>> {
  const endpoints = await listEndpoints();
  return new Map(endpoints.data.map((endpoint) => [endpoint.id, endpoint.url]));
}
