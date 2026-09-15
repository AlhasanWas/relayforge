import type { Metadata } from 'next';
import { FilterTabs, Pagination } from '@/components/list-controls';
import { StatusBadge } from '@/components/status-badge';
import { Cell, Table } from '@/components/table';
import { EmptyState, Mono, PageHeader, TextLink } from '@/components/ui';
import { listEvents } from '@/lib/api/resources';
import { EVENT_STATUSES } from '@/lib/api/schemas';
import { formatDateTime, humanize } from '@/lib/format';
import { enumParam, type SearchParams, uuidParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Events' };

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = enumParam(params, 'status', EVENT_STATUSES);
  const cursor = uuidParam(params, 'cursor');
  const events = await listEvents({ status, cursor });

  return (
    <>
      <PageHeader
        title="Events"
        description="Webhooks accepted from providers, each stored once per provider event id. Unknown event types are kept as Ignored."
      />
      <FilterTabs pathname="/events" param="status" values={EVENT_STATUSES} current={status} />
      {events.data.length === 0 ? (
        <EmptyState>No events match this filter.</EmptyState>
      ) : (
        <Table
          caption="Incoming events"
          head={['Received', 'Type', 'Provider event', 'Status', 'Attempts', 'Failure']}
        >
          {events.data.map((event) => (
            <tr key={event.id}>
              <Cell className="whitespace-nowrap">
                <TextLink href={`/events/${event.id}`}>{formatDateTime(event.receivedAt)}</TextLink>
              </Cell>
              <Cell>
                <Mono>{event.eventType}</Mono>
              </Cell>
              <Cell>
                <Mono>{event.externalEventId}</Mono>
              </Cell>
              <Cell>
                <StatusBadge status={event.status} />
              </Cell>
              <Cell className="tabular-nums">{event.processingAttempts}</Cell>
              <Cell className="text-muted">
                {event.failureReason === null ? '—' : humanize(event.failureReason)}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
      <Pagination
        pathname="/events"
        filters={{ status }}
        cursor={cursor}
        nextCursor={events.nextCursor}
      />
    </>
  );
}
