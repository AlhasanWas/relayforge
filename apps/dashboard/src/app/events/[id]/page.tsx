import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DeliveriesTable } from '@/components/deliveries-table';
import { StatusBadge } from '@/components/status-badge';
import { DetailList, EmptyState, JsonBlock, Mono, PageHeader, Section } from '@/components/ui';
import { orNotFound } from '@/lib/api/errors';
import { getEndpointUrls, getEvent, listDeliveries } from '@/lib/api/resources';
import { formatDateTime, humanize } from '@/lib/format';
import { isUuid } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Event' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [event, deliveries, endpointUrls] = await Promise.all([
    orNotFound(getEvent(id)),
    listDeliveries({ eventId: id, limit: 100 }),
    getEndpointUrls(),
  ]);

  return (
    <>
      <PageHeader
        title={event.eventType}
        description={
          <>
            Provider event <Mono>{event.externalEventId}</Mono>
          </>
        }
        actions={<StatusBadge status={event.status} />}
      />

      <DetailList
        items={[
          ['Event id', <Mono key="id">{event.id}</Mono>],
          ['Status', <StatusBadge key="status" status={event.status} />],
          ['Received', formatDateTime(event.receivedAt)],
          ['Processed', formatDateTime(event.processedAt)],
          ['Processing attempts', event.processingAttempts],
          ['Failure reason', event.failureReason === null ? '—' : humanize(event.failureReason)],
          ['Signature verified', event.signatureValid ? 'Yes' : 'No'],
          ['Payload SHA-256', <Mono key="hash">{event.payloadHash}</Mono>],
          ['Provider connection', <Mono key="connection">{event.providerConnectionId}</Mono>],
        ]}
      />

      <Section
        title="Deliveries"
        description="Every delivery of this event, including replays, carries the event id as its webhook-id header."
      >
        {deliveries.data.length === 0 ? (
          <EmptyState>No deliveries were created for this event.</EmptyState>
        ) : (
          <DeliveriesTable deliveries={deliveries.data} endpointUrls={endpointUrls} />
        )}
      </Section>

      <Section
        title="Payload"
        description="The immutable payload as received from the provider (shown formatted)."
      >
        <JsonBlock value={event.payload} />
      </Section>
    </>
  );
}
